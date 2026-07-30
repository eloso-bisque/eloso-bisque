/**
 * Postgres-backed full-text search for the Contacts page search box
 * (issue #59), replacing `searchKissinger()` (`src/lib/kissinger.ts`) — the
 * last remaining Kissinger call in the Contacts search path.
 *
 * Uses the generated, GIN-indexed `searchVector` tsvector columns added on
 * `Contact` (name/title/notes) and `Organization` (name/notes) by
 * prisma/migrations/20260730205436_add_fulltext_search. Each field is
 * weight-tagged (name='A', title='B', notes='C') so `ts_rank()` naturally
 * scores a name match above a notes-only match for the same term.
 *
 * `websearch_to_tsquery` is used (not `to_tsquery`) so free-text user input
 * — including quoted phrases, `-exclude`, `or` — never raises a syntax
 * error; malformed/empty input just yields a tsquery that matches nothing.
 *
 * Output shape matches `EntitySummary` (`src/lib/kissinger.ts`), the same
 * contract `src/lib/contacts-read.ts` already established for the
 * Postgres-backed segment tabs:
 *   - `id` is the Kissinger id (`kissingerId`), never the Postgres cuid —
 *     contact detail pages and score/outreach API routes are still keyed by
 *     Kissinger id in this phase. Rows without one are dropped.
 *   - Classification booleans (`isVcFirm`, `isProspect`, `isInvestorContact`)
 *     are folded back into synthetic tags ("vc", "prospect", "investor") so
 *     `classifyOrg()` / `INVESTOR_PERSON_TAGS` tag-matching in
 *     contacts/page.tsx keeps working unchanged against search results —
 *     those classification tags were converted to typed booleans during the
 *     Postgres migration and are no longer present in ContactTag/
 *     OrganizationTag rows (see docs/prisma-schema-design.md section 4.3).
 *
 * Never throws: any Postgres error is caught and logged, returning `[]` —
 * matching the exact contract `searchKissinger()` already had at this call
 * site (page.tsx uses the result directly with no offline/null check).
 */

import { prisma } from "@/lib/prisma";
import type { EntitySummary } from "@/lib/kissinger";

const DEFAULT_LIMIT = 200;

export interface OrgSearchRow {
  id: string;
  kissingerId: string | null;
  name: string;
  isVcFirm: boolean;
  isProspect: boolean;
  isArchived: boolean;
  updatedAt: Date;
  rank: number;
  tags: string[];
}

export interface ContactSearchRow {
  id: string;
  kissingerId: string | null;
  name: string;
  title: string | null;
  location: string | null;
  isInvestorContact: boolean;
  isArchived: boolean;
  updatedAt: Date;
  rank: number;
  tags: string[];
}

export interface RankedHit {
  entity: EntitySummary;
  rank: number;
}

// ---------------------------------------------------------------------------
// Pure row -> EntitySummary mappers (unit-tested directly, no I/O)
// ---------------------------------------------------------------------------

export function organizationRowToEntitySummary(row: OrgSearchRow): EntitySummary | null {
  if (!row.kissingerId) return null;
  const tags = [...row.tags];
  if (row.isVcFirm) tags.push("vc");
  if (row.isProspect) tags.push("prospect");
  return {
    id: row.kissingerId,
    kind: "org",
    name: row.name,
    tags,
    updatedAt: row.updatedAt.toISOString(),
    archived: row.isArchived,
  };
}

export function contactRowToEntitySummary(row: ContactSearchRow): EntitySummary | null {
  if (!row.kissingerId) return null;
  const tags = [...row.tags];
  if (row.isInvestorContact) tags.push("investor");
  return {
    id: row.kissingerId,
    kind: "person",
    name: row.name,
    tags,
    updatedAt: row.updatedAt.toISOString(),
    archived: row.isArchived,
    location: row.location ?? undefined,
    title: row.title ?? undefined,
  };
}

/** Merge ranked hits from both tables into a single list, highest rank first, capped at `limit`. */
export function mergeRankedHits(
  orgHits: RankedHit[],
  contactHits: RankedHit[],
  limit: number
): EntitySummary[] {
  return [...orgHits, ...contactHits]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((h) => h.entity);
}

// ---------------------------------------------------------------------------
// Raw-SQL ranked search per table
// ---------------------------------------------------------------------------

async function searchOrganizations(query: string, limit: number): Promise<RankedHit[]> {
  const rows = await prisma.$queryRaw<OrgSearchRow[]>`
    SELECT o.id, o."kissingerId", o.name, o."isVcFirm", o."isProspect", o."isArchived", o."updatedAt",
           ts_rank(o."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
           coalesce(array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
    FROM "Organization" o
    LEFT JOIN "OrganizationTag" t ON t."organizationId" = o.id
    WHERE o."searchVector" @@ websearch_to_tsquery('english', ${query})
      AND o."isArchived" = false
    GROUP BY o.id
    ORDER BY rank DESC
    LIMIT ${limit}
  `;
  const hits: RankedHit[] = [];
  for (const row of rows) {
    const entity = organizationRowToEntitySummary(row);
    if (entity) hits.push({ entity, rank: row.rank });
  }
  return hits;
}

async function searchContacts(query: string, limit: number): Promise<RankedHit[]> {
  const rows = await prisma.$queryRaw<ContactSearchRow[]>`
    SELECT c.id, c."kissingerId", c.name, c.title, c.location, c."isInvestorContact", c."isArchived", c."updatedAt",
           ts_rank(c."searchVector", websearch_to_tsquery('english', ${query})) AS rank,
           coalesce(array_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '{}') AS tags
    FROM "Contact" c
    LEFT JOIN "ContactTag" t ON t."contactId" = c.id
    WHERE c."searchVector" @@ websearch_to_tsquery('english', ${query})
      AND c."isArchived" = false
    GROUP BY c.id
    ORDER BY rank DESC
    LIMIT ${limit}
  `;
  const hits: RankedHit[] = [];
  for (const row of rows) {
    const entity = contactRowToEntitySummary(row);
    if (entity) hits.push({ entity, rank: row.rank });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ranked full-text search across Contact + Organization, replacing
 * `searchKissinger()` for the Contacts page search box.
 *
 * Returns `[]` (never throws) on a blank query or any Postgres error.
 */
export async function searchContactsPostgres(
  query: string,
  limit = DEFAULT_LIMIT
): Promise<EntitySummary[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const [orgHits, contactHits] = await Promise.all([
      searchOrganizations(trimmed, limit),
      searchContacts(trimmed, limit),
    ]);
    return mergeRankedHits(orgHits, contactHits, limit);
  } catch (err) {
    console.warn(
      "[contacts-search] searchContactsPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
