/**
 * Postgres-backed Investors section read path (Prisma Phase 3.5, GH #45).
 *
 * Replaces `fetchInvestorData()` / `fetchInvestorFirmDetail()` /
 * `fetchInvestorPersonDetail()` (src/lib/kissinger.ts) — which scanned the
 * full Kissinger entity corpus and classified investors via
 * INVESTOR_FIRM_TAGS/INVESTOR_PERSON_TAGS string matching — with Postgres
 * queries against the already-backfilled typed fields:
 * `Organization.isVcFirm` / `Contact.isInvestorContact`, plus the
 * investor-specific columns (investmentStage, checkSize, thesis, sectorFit,
 * investorPipeline for Organization; incentive, warmIntroPath, priority for
 * Contact).
 *
 * ---------------------------------------------------------------------
 * Scope boundary (matches docs/prisma-schema-design.md 4.1: "Contact detail
 * / Funnel Kanban — migrates last (requires relationship data to be fully
 * populated)", GH #46)
 * ---------------------------------------------------------------------
 *
 * The firm/person *detail* pages still call Kissinger's fetchContactDetail()
 * for org-chart edges (peopleAtOrg), portfolio edges, notes, tags, location,
 * website, and source — relationship-graph data that GH #46 owns. This
 * module only supplies the investor-specific scalar fields named in GH #45's
 * scope, via `overrideFirmMetaWithPostgres` / `overridePersonMetaWithPostgres`,
 * which splice Postgres-sourced values into the existing Kissinger meta
 * array so the detail pages' `metaVal()` extraction keeps working unchanged.
 *
 * ---------------------------------------------------------------------
 * Parity verified (2026-07-22, real prod data — see
 * scripts/verify-investors-parity.ts)
 * ---------------------------------------------------------------------
 *
 *   Firms:  Kissinger (live, tag-based) vc=189   Postgres (typed-field) vc=189  -> exact match.
 *   People: Kissinger (live, tag-based) vc=65    Postgres (typed-field) vc=65   -> exact match,
 *           after the one-time correction in scripts/fix-investor-contact-classification.ts
 *           (see that file's header for the #41 backfill classification bug this fixes).
 *
 * Every exported read function here follows the same never-throw contract as
 * contacts-read.ts / sectors-read.ts: a Postgres outage or unexpected error
 * is caught and logged, returning null so the caller can fall back to
 * treating the request as "offline" (matching how the pages already handle
 * a null response from the Kissinger fetch helpers they replace).
 */

import { prisma } from "@/lib/prisma";
import type { InvestorPipelineStage } from "@prisma/client";
import type { InvestorFirm, InvestorPerson } from "@/lib/kissinger";
import type { InvestorScoringContact } from "@/lib/score-contact";

// ---------------------------------------------------------------------------
// Classification predicates
// ---------------------------------------------------------------------------

/** Prisma `where` clause for the investor-firms segment (Organization.isVcFirm=true). */
export const INVESTOR_FIRM_WHERE = { isVcFirm: true, isArchived: false } as const;

/** Prisma `where` clause for the investor-people segment (Contact.isInvestorContact=true). */
export const INVESTOR_PERSON_WHERE = { isInvestorContact: true, isArchived: false } as const;

// ---------------------------------------------------------------------------
// Synthetic priority tag — Organization has no `priority` column (see
// scripts/backfill/build-plan.ts's judgment call comment); firm priority is
// carried as a `priority:<value>` OrganizationTag row instead.
// ---------------------------------------------------------------------------

const PRIORITY_TAG_PREFIX = "priority:";

/** Parses the `priority:<value>` synthetic tag out of a firm's plain tag list, or "" if absent. */
export function parseOrgPriorityTag(tags: string[]): string {
  const tag = tags.find((t) => t.startsWith(PRIORITY_TAG_PREFIX));
  return tag ? tag.slice(PRIORITY_TAG_PREFIX.length) : "";
}

// ---------------------------------------------------------------------------
// InvestorPipelineStage enum <-> UI label (used by PipelineStageSelector,
// StageBadge, and the pipeline-stage API route's VALID_STAGES)
// ---------------------------------------------------------------------------

export const PIPELINE_STAGE_LABELS: Record<InvestorPipelineStage, string> = {
  Research: "Research",
  WarmIntro: "Warm Intro",
  FirstMeeting: "First Meeting",
  PartnerMeeting: "Partner Meeting",
  TermSheet: "Term Sheet",
  Closed: "Closed",
  Passed: "Passed",
};

const LABEL_TO_ENUM: Record<string, InvestorPipelineStage> = Object.fromEntries(
  Object.entries(PIPELINE_STAGE_LABELS).map(([enumValue, label]) => [label, enumValue as InvestorPipelineStage])
);

export function pipelineStageEnumToLabel(stage: InvestorPipelineStage): string {
  return PIPELINE_STAGE_LABELS[stage] ?? "Research";
}

/** Returns null (rather than defaulting) for an unrecognized label — callers must treat that as "do not write." */
export function pipelineStageLabelToEnum(label: string): InvestorPipelineStage | null {
  return LABEL_TO_ENUM[label] ?? null;
}

// ---------------------------------------------------------------------------
// Row -> InvestorFirm / InvestorPerson mapping
// ---------------------------------------------------------------------------

export interface InvestorFirmRow {
  kissingerId: string | null;
  name: string;
  hq: string | null;
  updatedAt: Date;
  isArchived: boolean;
  investmentStage: string | null;
  checkSize: string | null;
  thesis: string | null;
  sectorFit: string | null;
  investorPipeline: InvestorPipelineStage;
  website: string | null;
  tags: { tag: string }[];
}

/** Maps a Postgres Organization row to the exact InvestorFirm shape the /investors pages already render. */
export function orgRowToInvestorFirm(row: InvestorFirmRow): InvestorFirm | null {
  if (!row.kissingerId) return null;
  const tagList = row.tags.map((t) => t.tag);
  return {
    id: row.kissingerId,
    kind: "org",
    name: row.name,
    tags: tagList,
    updatedAt: row.updatedAt.toISOString(),
    archived: row.isArchived,
    location: row.hq ?? "",
    stage: row.investmentStage ?? "",
    checkSize: row.checkSize ?? "",
    thesis: row.thesis ?? "",
    priority: parseOrgPriorityTag(tagList),
    pipelineStage: pipelineStageEnumToLabel(row.investorPipeline),
    website: row.website ?? "",
    sectorFit: row.sectorFit ?? "",
  };
}

export interface InvestorPersonRow {
  kissingerId: string | null;
  name: string;
  location: string | null;
  title: string | null;
  updatedAt: Date;
  isArchived: boolean;
  incentive: string | null;
  warmIntroPath: string | null;
  priority: string | null;
  linkedinUrl: string | null;
  tags: { tag: string }[];
  organization: { kissingerId: string | null; name: string } | null;
}

/** Maps a Postgres Contact row to the exact InvestorPerson shape the /investors pages already render. */
export function contactRowToInvestorPerson(row: InvestorPersonRow): InvestorPerson | null {
  if (!row.kissingerId) return null;
  return {
    id: row.kissingerId,
    kind: "person",
    name: row.name,
    tags: row.tags.map((t) => t.tag),
    updatedAt: row.updatedAt.toISOString(),
    archived: row.isArchived,
    location: row.location ?? undefined,
    title: row.title ?? "",
    firmName: row.organization?.name ?? "",
    firmId: row.organization?.kissingerId ?? undefined,
    incentive: row.incentive ?? "",
    linkedinUrl: row.linkedinUrl ?? "",
    priority: row.priority ?? "",
  };
}

// ---------------------------------------------------------------------------
// Scoring input construction — feeds the unchanged, pure scoreInvestor()
// (src/lib/score-contact.ts) with a synthetic Kissinger-meta-shaped array
// built from typed Postgres fields, so scores are computed identically
// regardless of data source.
// ---------------------------------------------------------------------------

function metaEntries(pairs: [string, string][]): { key: string; value: string }[] {
  return pairs.filter(([, value]) => value !== "").map(([key, value]) => ({ key, value }));
}

export function buildFirmScoringInput(firm: InvestorFirm, notes: string): InvestorScoringContact {
  return {
    id: firm.id,
    name: firm.name,
    kind: firm.kind,
    tags: firm.tags,
    notes,
    meta: metaEntries([
      ["stage", firm.stage],
      ["thesis", firm.thesis],
      ["sector_fit", firm.sectorFit],
      ["check_size", firm.checkSize],
      ["priority", firm.priority],
    ]),
    updatedAt: firm.updatedAt,
    edges: [],
    isInvestor: true,
  };
}

/**
 * `warmIntroPath` is passed separately (not read off `person`) because it is
 * not part of the `InvestorPerson` shape rendered by the listing page (only
 * the detail page fetches it, via `fetchInvestorPersonFieldsByKissingerId`).
 */
export function buildPersonScoringInput(
  person: InvestorPerson,
  warmIntroPath: string,
  notes: string
): InvestorScoringContact {
  return {
    id: person.id,
    name: person.name,
    kind: person.kind,
    tags: person.tags,
    notes,
    meta: metaEntries([
      ["warm_intro_path", warmIntroPath],
      ["priority", person.priority],
    ]),
    updatedAt: person.updatedAt,
    edges: [],
    isInvestor: true,
  };
}

// ---------------------------------------------------------------------------
// Detail-page meta override — splices Postgres-sourced investor fields into
// the existing Kissinger meta array (see module-level scope-boundary note).
// ---------------------------------------------------------------------------

export interface InvestorFirmDetailFields {
  stage: string;
  checkSize: string;
  thesis: string;
  sectorFit: string;
  priority: string;
  pipelineStage: string;
  website: string;
}

/**
 * Returns a new meta array where investor-specific keys (stage, check_size,
 * thesis, sector_fit, priority, pipeline_stage) are replaced by the Postgres
 * values, dropping the key entirely when the Postgres value is "" so the
 * pages' `{field && (...)}` guards keep hiding empty fields correctly. Keys
 * not covered by `pgFields` (location, website's non-investor callers,
 * source, etc.) pass through untouched. Returns `meta` unchanged if
 * `pgFields` is null (Postgres lookup failed or row not found).
 */
export function overrideFirmMetaWithPostgres(
  meta: { key: string; value: string }[],
  pgFields: InvestorFirmDetailFields | null
): { key: string; value: string }[] {
  if (!pgFields) return meta;
  const overrides: Record<string, string> = {
    stage: pgFields.stage,
    check_size: pgFields.checkSize,
    thesis: pgFields.thesis,
    sector_fit: pgFields.sectorFit,
    priority: pgFields.priority,
    pipeline_stage: pgFields.pipelineStage,
    website: pgFields.website,
  };
  const overriddenKeys = new Set(Object.keys(overrides));
  const filtered = meta.filter((m) => !overriddenKeys.has(m.key));
  const added = Object.entries(overrides)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => ({ key, value }));
  return [...filtered, ...added];
}

export interface InvestorPersonDetailFields {
  incentive: string;
  warmIntroPath: string;
  priority: string;
}

export function overridePersonMetaWithPostgres(
  meta: { key: string; value: string }[],
  pgFields: InvestorPersonDetailFields | null
): { key: string; value: string }[] {
  if (!pgFields) return meta;
  const overrides: Record<string, string> = {
    incentive: pgFields.incentive,
    warm_intro_path: pgFields.warmIntroPath,
    priority: pgFields.priority,
  };
  const overriddenKeys = new Set(Object.keys(overrides));
  const filtered = meta.filter((m) => !overriddenKeys.has(m.key));
  const added = Object.entries(overrides)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => ({ key, value }));
  return [...filtered, ...added];
}

// ---------------------------------------------------------------------------
// Postgres queries — full-corpus replacement for fetchInvestorData()
// ---------------------------------------------------------------------------

const INVESTOR_FIRM_SELECT = {
  kissingerId: true,
  name: true,
  hq: true,
  notes: true,
  updatedAt: true,
  isArchived: true,
  investmentStage: true,
  checkSize: true,
  thesis: true,
  sectorFit: true,
  investorPipeline: true,
  website: true,
  tags: { select: { tag: true } },
} as const;

export interface InvestorFirmWithNotes {
  firm: InvestorFirm;
  notes: string;
}

/**
 * Postgres replacement for the firm half of `fetchInvestorData()`. Returns
 * null (never throws) on any Postgres error, matching the "offline" fallback
 * the /investors page already implements for a failed Kissinger fetch.
 */
export async function fetchInvestorFirmsFromPostgres(): Promise<InvestorFirmWithNotes[] | null> {
  try {
    const rows = await prisma.organization.findMany({
      where: INVESTOR_FIRM_WHERE,
      select: INVESTOR_FIRM_SELECT,
      orderBy: { name: "asc" },
    });
    const out: InvestorFirmWithNotes[] = [];
    for (const row of rows) {
      const firm = orgRowToInvestorFirm(row);
      if (firm) out.push({ firm, notes: row.notes ?? "" });
    }
    return out;
  } catch (err) {
    console.warn(
      "[investors-read] fetchInvestorFirmsFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

const INVESTOR_PERSON_SELECT = {
  kissingerId: true,
  name: true,
  location: true,
  title: true,
  updatedAt: true,
  isArchived: true,
  incentive: true,
  warmIntroPath: true,
  priority: true,
  linkedinUrl: true,
  tags: { select: { tag: true } },
  organization: { select: { kissingerId: true, name: true } },
} as const;

/**
 * Postgres replacement for the people half of `fetchInvestorData()`. Returns
 * null (never throws) on any Postgres error.
 */
export async function fetchInvestorPeopleFromPostgres(): Promise<InvestorPerson[] | null> {
  try {
    const rows = await prisma.contact.findMany({
      where: INVESTOR_PERSON_WHERE,
      select: INVESTOR_PERSON_SELECT,
      orderBy: { name: "asc" },
    });
    const out: InvestorPerson[] = [];
    for (const row of rows) {
      const person = contactRowToInvestorPerson(row);
      if (person) out.push(person);
    }
    return out;
  } catch (err) {
    console.warn(
      "[investors-read] fetchInvestorPeopleFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Single-row detail lookups (by kissingerId) — used to override the
// Kissinger-sourced meta array on the firm/person detail pages.
// ---------------------------------------------------------------------------

/** Returns null (never throws) if the org isn't found in Postgres yet or the lookup fails. */
export async function fetchInvestorFirmFieldsByKissingerId(
  kissingerId: string
): Promise<InvestorFirmDetailFields | null> {
  try {
    const row = await prisma.organization.findUnique({
      where: { kissingerId },
      select: {
        investmentStage: true,
        checkSize: true,
        thesis: true,
        sectorFit: true,
        investorPipeline: true,
        website: true,
        tags: { select: { tag: true } },
      },
    });
    if (!row) return null;
    const tagList = row.tags.map((t) => t.tag);
    return {
      stage: row.investmentStage ?? "",
      checkSize: row.checkSize ?? "",
      thesis: row.thesis ?? "",
      sectorFit: row.sectorFit ?? "",
      priority: parseOrgPriorityTag(tagList),
      pipelineStage: pipelineStageEnumToLabel(row.investorPipeline),
      website: row.website ?? "",
    };
  } catch (err) {
    console.warn(
      `[investors-read] fetchInvestorFirmFieldsByKissingerId failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/** Returns null (never throws) if the contact isn't found in Postgres yet or the lookup fails. */
export async function fetchInvestorPersonFieldsByKissingerId(
  kissingerId: string
): Promise<InvestorPersonDetailFields | null> {
  try {
    const row = await prisma.contact.findUnique({
      where: { kissingerId },
      select: { incentive: true, warmIntroPath: true, priority: true },
    });
    if (!row) return null;
    return {
      incentive: row.incentive ?? "",
      warmIntroPath: row.warmIntroPath ?? "",
      priority: row.priority ?? "",
    };
  } catch (err) {
    console.warn(
      `[investors-read] fetchInvestorPersonFieldsByKissingerId failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
