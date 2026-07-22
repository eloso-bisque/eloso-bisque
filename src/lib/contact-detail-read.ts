/**
 * Postgres-backed Contact detail read path (Prisma Phase 3.6, GH #46 — the
 * final read-path migration in the Kissinger -> Postgres project, beads
 * `eloso-bisque-qzu`).
 *
 * Replaces `fetchContactDetail()` (src/lib/kissinger.ts) — which fetched a
 * Kissinger entity plus `edgesFrom`/`edgesTo` and resolved each edge's
 * target name/kind with a separate GraphQL round-trip per edge — with a
 * single Postgres query per entity, joining relationships already backfilled
 * by GH #41.
 *
 * `fetchContactDetail()` is reused by three pages, all switched over here:
 *   - src/app/(main)/contacts/[id]/page.tsx        (person OR org)
 *   - src/app/(main)/investors/firms/[id]/page.tsx  (org, via fetchInvestorFirmDetail)
 *   - src/app/(main)/investors/people/[id]/page.tsx (person, via fetchInvestorPersonDetail)
 * so this module looks up a Contact row first, then an Organization row,
 * and returns the *same* `{ contact, edges, peopleAtOrg }` shape the
 * Kissinger version did (using the same `ContactDetail`/`ResolvedEdge`/
 * `PersonAtOrg` types from kissinger.ts) so none of the three pages need
 * structural changes beyond the import.
 *
 * ---------------------------------------------------------------------
 * Employer edge completeness gap (verified against real prod data, 2026-07-22)
 * ---------------------------------------------------------------------
 * The GH #41 backfill resolves a Contact's employer two ways (see
 * scripts/backfill/relationships.ts: resolveContactOrganization):
 *   1. An explicit `works_at` Kissinger edge -> both `Contact.organizationId`
 *      AND a `RelationshipFrom(relationType: works_at)` row are written.
 *   2. A fallback case-insensitive match of the contact's `company` meta
 *      against a known Organization name, when no edge exists -> ONLY
 *      `Contact.organizationId` is set; no RelationshipFrom row exists.
 *
 * Querying real prod Postgres: 7,355 of 9,237 contacts (79.6%) have
 * `organizationId` set. Of those, 7,218 have a matching `works_at`
 * RelationshipFrom row and 137 (1.9%) do not — case 2 above. If `edges`
 * were built from RelationshipFrom rows alone, those 137 contacts' detail
 * pages would render an empty "Organisation" section despite having a
 * known employer. `synthesizeEmployerEdge()` below closes that gap by
 * always deriving a `works_at` edge from `Contact.organizationId` directly
 * when no matching RelationshipFrom row is already present in the result.
 *
 * ---------------------------------------------------------------------
 * `peopleAtOrg` — org -> reverse-employee lookup
 * ---------------------------------------------------------------------
 * The legacy Kissinger path resolved this via reverse `edgesTo` filtered to
 * `works_at`. Postgres instead queries `Contact.organizationId = org.id`
 * directly — this is a superset of the reverse-`RelationshipFrom` query
 * (it also covers the 137 fallback-matched contacts above), and is a
 * single indexed query (`@@index([organizationId])`) instead of a graph
 * traversal.
 *
 * ---------------------------------------------------------------------
 * Deliberately NOT eagerly joined: touches / responses / generatedMessages / signals
 * ---------------------------------------------------------------------
 * The GH #46 issue text describes the target Prisma query as including
 * touches/responses/generatedMessages/signals/events. `events` (ContactEvent)
 * and `touches` (OutreachTouch) are included here because they feed
 * `mostRecentInteractionAt` (see below) — the one piece of Kissinger-sourced
 * data the contact-detail page's *scoring* computation needed
 * (`interactionsForEntity`, previously a second Kissinger round-trip made
 * directly in contacts/[id]/page.tsx). `responses` and `generatedMessages`
 * have zero consumers on the contact-detail Overview/Events/Signals/
 * Intro-Path tabs today (they're rendered elsewhere, e.g. the Outreach
 * queue) — joining them here would be a pure cost with no UI benefit, so
 * they are left out. If a future page needs them, add the join there.
 */

import { prisma } from "@/lib/prisma";
import type {
  ContactDetail,
  EntityEdge,
  PersonAtOrg,
  ResolvedEdge,
} from "@/lib/kissinger";
import type { RelationType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested directly, no I/O)
// ---------------------------------------------------------------------------

/**
 * Formats a raw USD revenue float the way the Kissinger `revenue` meta
 * field was always already-formatted-as-a-string (e.g. "$1.2B"). Postgres
 * stores the raw number (`Organization.revenueUsd`), so detail pages need
 * this to reproduce the same display.
 */
export function formatRevenueUsd(revenueUsd: number | null | undefined): string {
  if (revenueUsd === null || revenueUsd === undefined || Number.isNaN(revenueUsd)) return "";
  if (revenueUsd <= 0) return "";
  const abs = Math.abs(revenueUsd);
  if (abs >= 1_000_000_000) return `$${trimZeros(revenueUsd / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${trimZeros(revenueUsd / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trimZeros(revenueUsd / 1_000)}K`;
  return `$${trimZeros(revenueUsd)}`;
}

function trimZeros(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export interface ContactMetaSourceRow {
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  linkedinConnectedOn: string | null;
  incentive: string | null;
  warmIntroPath: string | null;
  priority: string | null;
}

/**
 * Builds the synthetic `meta` array a Contact detail page reads (title,
 * email, connected_on, company/org, linkedin_url, incentive,
 * warm_intro_path, priority) from typed Postgres columns. Several of these
 * keys (incentive, warm_intro_path, priority) are unconditionally
 * overwritten downstream by investors-read.ts's
 * `overridePersonMetaWithPostgres` on the investor person page — they're
 * populated here too so the plain /contacts/[id] page (which does not call
 * that override) still gets a sensible base value.
 */
export function buildContactMeta(
  contact: ContactMetaSourceRow,
  employerOrgName: string | null
): { key: string; value: string }[] {
  const entries: [string, string | null][] = [
    ["title", contact.title],
    ["email", contact.email],
    ["connected_on", contact.linkedinConnectedOn],
    ["company", employerOrgName],
    ["org", employerOrgName],
    ["linkedin_url", contact.linkedinUrl],
    ["incentive", contact.incentive],
    ["warm_intro_path", contact.warmIntroPath],
    ["priority", contact.priority],
  ];
  return entries
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => ({ key, value }));
}

export interface OrgMetaSourceRow {
  hq: string | null;
  employees: number | null;
  revenueUsd: number | null;
  industry: string | null;
  website: string | null;
  thesis: string | null;
  checkSize: string | null;
  investmentStage: string | null;
  sectorFit: string | null;
}

/**
 * Builds the synthetic `meta` array an Organization detail page reads (hq,
 * location, revenue, employees, industry, website, thesis, check_size,
 * stage, sector_fit). `stage`/`check_size`/`thesis`/`sector_fit`/`website`
 * are unconditionally overwritten by investors-read.ts's
 * `overrideFirmMetaWithPostgres` on the investor firm page — populated
 * here too for the base case (and so a Postgres lookup failure there falls
 * back to a real value instead of blank).
 *
 * Not populated: `source` (freeform Kissinger provenance note — no Postgres
 * column exists for it; the firm/person detail pages already render this
 * conditionally and degrade gracefully when absent, same as any other
 * missing field, per the #45 precedent).
 */
export function buildOrgMeta(org: OrgMetaSourceRow): { key: string; value: string }[] {
  const entries: [string, string | null][] = [
    ["hq", org.hq],
    ["location", org.hq],
    ["revenue", formatRevenueUsd(org.revenueUsd) || null],
    ["employees", org.employees != null ? String(org.employees) : null],
    ["industry", org.industry],
    ["website", org.website],
    ["thesis", org.thesis],
    ["check_size", org.checkSize],
    ["stage", org.investmentStage],
    ["sector_fit", org.sectorFit],
  ];
  return entries
    .filter((entry): entry is [string, string] => !!entry[1])
    .map(([key, value]) => ({ key, value }));
}

// ---------------------------------------------------------------------------
// RelationshipFrom row -> ResolvedEdge
// ---------------------------------------------------------------------------

export interface RelationshipEndpoint {
  kissingerId: string | null;
  name: string;
}

export interface RelationshipRow {
  relationType: RelationType;
  strength: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  sourcePerson: RelationshipEndpoint | null;
  sourceOrg: RelationshipEndpoint | null;
  targetPerson: RelationshipEndpoint | null;
  targetOrg: RelationshipEndpoint | null;
}

/**
 * Maps one RelationshipFrom row (with source/target Contact|Organization
 * sub-selects) into the legacy `ResolvedEdge` shape. Returns null if either
 * endpoint lacks a `kissingerId` (not yet surfaceable as a link — see the
 * same judgment call documented in contacts-read.ts's row mappers) or if
 * the row is malformed (should not happen given the schema's FK
 * constraints, but defensive since this is a boundary function).
 *
 * `valueFrame` has no Postgres equivalent and is not read anywhere in the
 * UI (verified: no `.valueFrame` reference outside its own type
 * declaration in kissinger.ts) — always returned as `""`.
 */
export function relationshipRowToResolvedEdge(
  row: RelationshipRow,
  selfKissingerId: string
): ResolvedEdge | null {
  const source = row.sourcePerson ?? row.sourceOrg;
  const target = row.targetPerson ?? row.targetOrg;
  if (!source?.kissingerId || !target?.kissingerId) return null;

  const targetKind: "person" | "org" = row.targetPerson ? "person" : "org";

  const edge: EntityEdge = {
    source: source.kissingerId,
    target: target.kissingerId,
    relation: row.relationType,
    valueFrame: "",
    strength: row.strength,
    notes: row.notes ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  // Defensive: only include edges actually originating from this entity —
  // RelationshipFrom rows are directional and callers query by source id,
  // but guard against a mismatched row being passed in by mistake.
  if (source.kissingerId !== selfKissingerId) return null;

  return { ...edge, targetName: target.name, targetKind };
}

/**
 * Synthesizes the `works_at` edge for a Contact's denormalized employer
 * (`Contact.organizationId`) when no matching RelationshipFrom row exists
 * — closes the 137-contact gap documented at the top of this file.
 */
export function synthesizeEmployerEdge(params: {
  contactKissingerId: string;
  organizationKissingerId: string;
  organizationName: string;
  roleAtOrg: string | null;
  orgStrength: number | null;
  updatedAt: Date;
}): ResolvedEdge {
  const {
    contactKissingerId,
    organizationKissingerId,
    organizationName,
    roleAtOrg,
    orgStrength,
    updatedAt,
  } = params;
  return {
    source: contactKissingerId,
    target: organizationKissingerId,
    relation: "works_at",
    valueFrame: "",
    strength: orgStrength ?? 0.5,
    notes: roleAtOrg ?? "",
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    targetName: organizationName,
    targetKind: "org",
  };
}

/**
 * Appends the synthesized employer edge to `edges` unless an equivalent
 * works_at edge to the same org already exists (avoids duplicating the
 * "Organisation" section for the ~98% of employed contacts whose employer
 * IS already represented by a real RelationshipFrom row).
 */
export function withSynthesizedEmployerEdge(
  edges: ResolvedEdge[],
  employer: Parameters<typeof synthesizeEmployerEdge>[0] | null
): ResolvedEdge[] {
  if (!employer) return edges;
  const alreadyPresent = edges.some(
    (e) => e.relation === "works_at" && e.target === employer.organizationKissingerId
  );
  if (alreadyPresent) return edges;
  return [...edges, synthesizeEmployerEdge(employer)];
}

// ---------------------------------------------------------------------------
// Contact row -> PersonAtOrg (reverse employer lookup for an org's detail page)
// ---------------------------------------------------------------------------

export interface EmployeeRow {
  kissingerId: string | null;
  name: string;
  roleAtOrg: string | null;
  orgStrength: number | null;
}

export function employeeRowToPersonAtOrg(row: EmployeeRow): PersonAtOrg | null {
  if (!row.kissingerId) return null;
  return {
    id: row.kissingerId,
    name: row.name,
    role: row.roleAtOrg ?? "",
    strength: row.orgStrength ?? 0,
    edgeNotes: row.roleAtOrg ?? "",
  };
}

// ---------------------------------------------------------------------------
// Imperative shell — Postgres queries
// ---------------------------------------------------------------------------

const RELATIONSHIP_ENDPOINT_SELECT = { kissingerId: true, name: true } as const;

const RELATIONSHIP_INCLUDE = {
  sourcePerson: { select: RELATIONSHIP_ENDPOINT_SELECT },
  sourceOrg: { select: RELATIONSHIP_ENDPOINT_SELECT },
  targetPerson: { select: RELATIONSHIP_ENDPOINT_SELECT },
  targetOrg: { select: RELATIONSHIP_ENDPOINT_SELECT },
} as const;

export interface ContactDetailResult {
  contact: ContactDetail;
  edges: ResolvedEdge[];
  peopleAtOrg: PersonAtOrg[];
  /** Most recent ContactEvent/OutreachTouch timestamp — feeds scoreContact's `last_interaction_at`. Person-only. */
  mostRecentInteractionAt: string | null;
  /** kissingerId -> tag list, for every org appearing as a `works_at` edge target. Feeds scoreContact's per-edge `target_tags`. */
  orgTagsByKissingerId: Record<string, string[]>;
}

async function fetchPersonDetail(kissingerId: string): Promise<ContactDetailResult | null> {
  const contact = await prisma.contact.findUnique({
    where: { kissingerId },
    include: {
      organization: { select: { kissingerId: true, name: true, tags: { select: { tag: true } } } },
      tags: { select: { tag: true } },
      relationshipsFrom: { include: RELATIONSHIP_INCLUDE },
      events: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 1 },
      touches: { select: { sentAt: true }, orderBy: { sentAt: "desc" }, take: 1 },
    },
  });
  if (!contact) return null;

  const rawEdges = contact.relationshipsFrom
    .map((row) => relationshipRowToResolvedEdge(row, kissingerId))
    .filter((e): e is ResolvedEdge => e !== null);

  const employer = contact.organization?.kissingerId
    ? {
        contactKissingerId: kissingerId,
        organizationKissingerId: contact.organization.kissingerId,
        organizationName: contact.organization.name,
        roleAtOrg: contact.roleAtOrg,
        orgStrength: contact.orgStrength,
        updatedAt: contact.updatedAt,
      }
    : null;
  const edges = withSynthesizedEmployerEdge(rawEdges, employer);

  const orgTagsByKissingerId: Record<string, string[]> = {};
  if (contact.organization?.kissingerId) {
    orgTagsByKissingerId[contact.organization.kissingerId] = contact.organization.tags.map((t) => t.tag);
  }

  const eventLatest = contact.events[0]?.occurredAt ?? null;
  const touchLatest = contact.touches[0]?.sentAt ?? null;
  const mostRecentInteractionAt =
    eventLatest && touchLatest
      ? (eventLatest > touchLatest ? eventLatest : touchLatest).toISOString()
      : (eventLatest ?? touchLatest)?.toISOString() ?? null;

  const contactDetail: ContactDetail = {
    id: kissingerId,
    kind: "person",
    name: contact.name,
    tags: contact.tags.map((t) => t.tag),
    notes: contact.notes ?? "",
    meta: buildContactMeta(contact, contact.organization?.name ?? null),
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
    archived: contact.isArchived,
  };

  return {
    contact: contactDetail,
    edges,
    peopleAtOrg: [],
    mostRecentInteractionAt,
    orgTagsByKissingerId,
  };
}

async function fetchOrgDetail(kissingerId: string): Promise<ContactDetailResult | null> {
  const org = await prisma.organization.findUnique({
    where: { kissingerId },
    include: {
      tags: { select: { tag: true } },
      relationshipsFrom: { include: RELATIONSHIP_INCLUDE },
      contacts: {
        select: { kissingerId: true, name: true, roleAtOrg: true, orgStrength: true },
        orderBy: { orgStrength: "desc" },
      },
    },
  });
  if (!org) return null;

  const edges = org.relationshipsFrom
    .map((row) => relationshipRowToResolvedEdge(row, kissingerId))
    .filter((e): e is ResolvedEdge => e !== null);

  const peopleAtOrg = org.contacts
    .map(employeeRowToPersonAtOrg)
    .filter((p): p is PersonAtOrg => p !== null);

  const contactDetail: ContactDetail = {
    id: kissingerId,
    kind: "org",
    name: org.name,
    tags: org.tags.map((t) => t.tag),
    notes: org.notes ?? "",
    meta: buildOrgMeta(org),
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
    archived: org.isArchived,
  };

  return {
    contact: contactDetail,
    edges,
    peopleAtOrg,
    mostRecentInteractionAt: null,
    orgTagsByKissingerId: {},
  };
}

/**
 * Postgres replacement for `fetchContactDetail()`. Tries Contact first
 * (people are the more frequent lookup — Outreach/Contacts/Investors-people
 * all key off Contact), then Organization. Returns null (never throws) if
 * neither matches or on any Postgres error, matching the exact
 * fail-closed contract `fetchContactDetail()` already had (its try/catch
 * wraps the whole function and returns null on any error) so `notFound()`
 * behavior in all three calling pages is unchanged.
 */
export async function fetchContactDetailFromPostgres(
  kissingerId: string
): Promise<ContactDetailResult | null> {
  try {
    const person = await fetchPersonDetail(kissingerId);
    if (person) return person;
    return await fetchOrgDetail(kissingerId);
  } catch (err) {
    console.warn(
      `[contact-detail-read] fetchContactDetailFromPostgres failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
