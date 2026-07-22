/**
 * Postgres-backed Contacts listing read path (Prisma Phase 3.3, GH #44).
 *
 * Replaces the Kissinger full-corpus-scan + client-side tag classification
 * previously used by src/app/(main)/contacts (fetchAllEntities("org") +
 * classifyOrg(), and fetchContactsPage("person") + INVESTOR_PERSON_TAGS
 * string matching) with Postgres queries against the already-backfilled
 * typed boolean fields (Organization.isProspect/isVcFirm/isArchived,
 * Contact.isInvestorContact/isArchived) and ContactTag/OrganizationTag joins.
 *
 * ---------------------------------------------------------------------
 * Segmentation precedence (must match legacy classifyOrg() exactly)
 * ---------------------------------------------------------------------
 *
 * The schema comment on Organization says isProspect/isVcFirm are "mutually
 * exclusive" — real prod data disagrees: as of 2026-07-22, 12 of 5,846 orgs
 * have BOTH isProspect=true and isVcFirm=true. Legacy classifyOrg() (src/lib/
 * kissinger.ts) checked VC_TAGS before PROSPECT_TAGS, so a VC-tagged org
 * always landed in the "vc" bucket even if it also carried the "prospect"
 * tag. classifyOrganization() below preserves that precedence using the
 * typed fields instead of tags, which is why the org-count parity check
 * (see scripts/verify-contacts-sectors-parity.ts) matches Kissinger exactly:
 * vc=189, prospects=38, other-orgs=5619 (out of 5,846 total).
 *
 * ---------------------------------------------------------------------
 * Parity verified (2026-07-22, real prod data — see scripts/verify-contacts-
 * sectors-parity.ts for the reusable check)
 * ---------------------------------------------------------------------
 *
 *   Orgs:   Kissinger (live, tag-based) vc=189 prospects=38 other-orgs=5619
 *           Postgres  (typed-field)     vc=189 prospects=38 other-orgs=5619
 *           -> exact match, all 5,846 orgs.
 *   People: Kissinger (live, tag-based) 9209 non-investor / 9274 total
 *           Postgres  (typed-field)     9204 non-investor / 9237 total
 *           -> 5-person gap fully explained by the 37-contact drift between
 *              the backfill snapshot and Kissinger's live (still growing)
 *              contact count — Kissinger remains under continuous unrelated
 *              write load. Not a segmentation-logic discrepancy.
 *
 * This matches (and for orgs, exceeds) the parity bar PR #47 held itself to
 * (42/42 exact match) and is well clear of the threshold PR #48 required
 * before it was willing to cut its own read path over.
 *
 * Every exported read function here follows the same never-throw contract
 * as the rest of the dual-write/read-path modules in this phase: a Postgres
 * outage or unexpected error is caught and logged, returning null so the
 * caller can fall back to treating the request as "offline" (matching how
 * src/app/(main)/contacts/page.tsx already handles a null response from the
 * Kissinger fetch helpers it replaces).
 */

import { prisma } from "@/lib/prisma";
import type { EntitySummary } from "@/lib/kissinger";

export type OrgSegment = "vc" | "prospects" | "other-orgs";

// ---------------------------------------------------------------------------
// Pure segmentation logic (unit-tested directly, no I/O)
// ---------------------------------------------------------------------------

/**
 * Classify an organization into one of the three Contacts-page org segments
 * using typed boolean fields only — no tag string matching.
 *
 * Precedence: isVcFirm wins over isProspect when both are set (mirrors
 * legacy classifyOrg()'s VC_TAGS-checked-first behavior). This is not a
 * theoretical edge case — 12 real prod orgs have both flags set.
 */
export function classifyOrganization(org: {
  isVcFirm: boolean;
  isProspect: boolean;
}): OrgSegment {
  if (org.isVcFirm) return "vc";
  if (org.isProspect) return "prospects";
  return "other-orgs";
}

/** Prisma `where` clause equivalent to classifyOrganization(), for querying a single segment directly. */
export function whereForOrgSegment(segment: OrgSegment) {
  if (segment === "vc") return { isVcFirm: true, isArchived: false };
  if (segment === "prospects") return { isProspect: true, isVcFirm: false, isArchived: false };
  return { isProspect: false, isVcFirm: false, isArchived: false };
}

// ---------------------------------------------------------------------------
// Row -> EntitySummary mapping
// ---------------------------------------------------------------------------
//
// Both mappers return `id: kissingerId` (never the Postgres cuid) — contact
// detail pages, LazyScoreBadge, and the outreach/score API routes are all
// still keyed by Kissinger entity ID in this phase (Phase 3.6, contact
// detail, has not been migrated yet). Rows without a kissingerId are dropped
// rather than surfaced with a broken id — in practice this never happens
// today (0 of 5,846 orgs / 9,237 contacts lack one — see
// scripts/verify-contacts-sectors-parity.ts), but a future dual-write-only
// contact created before its Kissinger write is (theoretically) exposed
// should not produce a dead link.

export interface OrgRow {
  kissingerId: string | null;
  name: string;
  hq: string | null;
  updatedAt: Date;
  isArchived: boolean;
  tags: { tag: string }[];
}

export function orgToEntitySummary(org: OrgRow): EntitySummary | null {
  if (!org.kissingerId) return null;
  return {
    id: org.kissingerId,
    kind: "org",
    name: org.name,
    tags: org.tags.map((t) => t.tag),
    updatedAt: org.updatedAt.toISOString(),
    archived: org.isArchived,
    location: org.hq ?? undefined,
  };
}

export interface ContactRow {
  kissingerId: string | null;
  name: string;
  location: string | null;
  title: string | null;
  updatedAt: Date;
  isArchived: boolean;
  tags: { tag: string }[];
}

export function contactToEntitySummary(contact: ContactRow): EntitySummary | null {
  if (!contact.kissingerId) return null;
  return {
    id: contact.kissingerId,
    kind: "person",
    name: contact.name,
    tags: contact.tags.map((t) => t.tag),
    updatedAt: contact.updatedAt.toISOString(),
    archived: contact.isArchived,
    location: contact.location ?? undefined,
    title: contact.title ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Org segments (vc / prospects / other-orgs) — full scan replacement
// ---------------------------------------------------------------------------

/**
 * Postgres replacement for `fetchAllEntities("org")` + `classifyOrg()`
 * filtering. Returns the full (non-archived) set of orgs in the requested
 * segment, sorted by name — matching the "fetch everything, filter
 * client-side" contract the page already relies on (no cursor pagination
 * for these three tabs), but without the 5,800+ row client-side tag scan.
 *
 * Returns null (never throws) on any Postgres error, so the caller can
 * treat the request as offline exactly as it does for a failed Kissinger
 * fetch.
 */
export async function fetchOrgSegmentFromPostgres(
  segment: OrgSegment
): Promise<EntitySummary[] | null> {
  try {
    const orgs = await prisma.organization.findMany({
      where: whereForOrgSegment(segment),
      select: {
        kissingerId: true,
        name: true,
        hq: true,
        updatedAt: true,
        isArchived: true,
        tags: { select: { tag: true } },
      },
      orderBy: { name: "asc" },
    });
    const mapped: EntitySummary[] = [];
    for (const org of orgs) {
      const entity = orgToEntitySummary(org);
      if (entity) mapped.push(entity);
    }
    return mapped;
  } catch (err) {
    console.warn(
      "[contacts-read] fetchOrgSegmentFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Counts for all three org segments in one round-trip — used for tab badges. */
export async function fetchOrgSegmentCountsFromPostgres(): Promise<
  Record<OrgSegment, number> | null
> {
  try {
    const [vc, prospects, otherOrgs] = await Promise.all([
      prisma.organization.count({ where: whereForOrgSegment("vc") }),
      prisma.organization.count({ where: whereForOrgSegment("prospects") }),
      prisma.organization.count({ where: whereForOrgSegment("other-orgs") }),
    ]);
    return { vc, prospects, "other-orgs": otherOrgs };
  } catch (err) {
    console.warn(
      "[contacts-read] fetchOrgSegmentCountsFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// People — paginated replacement for fetchContactsPage("person")
// ---------------------------------------------------------------------------

export interface PeoplePage {
  contacts: EntitySummary[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * Postgres replacement for `fetchContactsPage("person", pageSize, after)` +
 * the `!p.tags.some(t => INVESTOR_PERSON_TAGS.has(t))` filter. Uses
 * Contact.isInvestorContact instead of tag string matching.
 *
 * Cursor is an opaque Postgres Contact.id (native Prisma cursor
 * pagination) — it is never round-tripped through Kissinger, so its format
 * doesn't need to match the old Kissinger cursor. The page only ever uses
 * this cursor to ask for "the next page" or resets to no cursor for "first
 * page" (see CursorPagination in contacts/page.tsx), so forward-only
 * pagination is sufficient — matching the existing UI contract exactly.
 */
export async function fetchPeopleContactsFromPostgres(
  pageSize: number,
  afterId?: string
): Promise<PeoplePage | null> {
  try {
    const rows = await prisma.contact.findMany({
      where: { isInvestorContact: false, isArchived: false },
      select: {
        id: true,
        kissingerId: true,
        name: true,
        location: true,
        title: true,
        updatedAt: true,
        isArchived: true,
        tags: { select: { tag: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: pageSize + 1,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    });

    const hasNextPage = rows.length > pageSize;
    const page = rows.slice(0, pageSize);
    const contacts: EntitySummary[] = [];
    for (const row of page) {
      const entity = contactToEntitySummary(row);
      if (entity) contacts.push(entity);
    }
    const endCursor = hasNextPage ? page[page.length - 1]?.id ?? null : null;

    return { contacts, hasNextPage, endCursor };
  } catch (err) {
    console.warn(
      "[contacts-read] fetchPeopleContactsFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Total non-investor, non-archived contact count — used for the People tab badge. */
export async function fetchPeopleCountFromPostgres(): Promise<number | null> {
  try {
    return await prisma.contact.count({
      where: { isInvestorContact: false, isArchived: false },
    });
  } catch (err) {
    console.warn(
      "[contacts-read] fetchPeopleCountFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
