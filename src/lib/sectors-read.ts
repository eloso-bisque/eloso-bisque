/**
 * Postgres-backed Sectors heatmap read path (Prisma Phase 3.4, GH #44).
 *
 * Replaces `fetchSectorAggregates()` (src/lib/kissinger.ts, a Kissinger
 * GraphQL `sectorAggregates` resolver call) and `fetchOrgsForSector()`
 * (src/app/(main)/sectors/[sector]/page.tsx, a full org-entity meta scan)
 * with Postgres queries over `Sector` + `OrganizationSector` + `Organization`
 * per docs/prisma-schema-design.md section 3.4.
 *
 * ---------------------------------------------------------------------
 * Data completeness finding (2026-07-22, real prod data) — READ BEFORE
 * touching this file
 * ---------------------------------------------------------------------
 *
 * Only 23 of 5,846 orgs (0.4%) have a primary sector assigned, in BOTH
 * Kissinger and Postgres — this is a pre-existing sparsity in the
 * underlying business data (sector tagging was never done at scale), not a
 * migration/backfill gap. Kissinger's own `sectorAggregates` resolver
 * returns the same 7 sectors with the same 23 total orgs that Postgres's
 * `OrganizationSector` (isPrimary=true) rows show (see
 * scripts/verify-sectors-parity.ts). Cutting the heatmap over to Postgres
 * therefore does not regress the UX below what production already shows
 * today — it is a lateral move onto equally sparse data, not the kind of
 * "only 25%/62% complete" regression that caused PR #43 to defer the
 * Outreach queue read cutover.
 *
 * ---------------------------------------------------------------------
 * Why OrganizationSector, not Organization.sectorPrimary
 * ---------------------------------------------------------------------
 *
 * Organization.sectorPrimary is a raw, unnormalized copy of Kissinger's
 * `sector_primary` meta value (e.g. "defense_aerospace", underscored).
 * Sector.slug is normalized (hyphenated, via normalizeSectorSlug() in
 * scripts/backfill/mappers.ts, e.g. "defense-aerospace") — the two do NOT
 * string-match. The GH #41 backfill correctly built OrganizationSector rows
 * (sectorSlug normalized, isPrimary=true for the org's primary sector) but
 * left Organization.sectorPrimary as the raw un-normalized string. This
 * module therefore joins through OrganizationSector (isPrimary=true), never
 * through Organization.sectorPrimary directly.
 *
 * ---------------------------------------------------------------------
 * Why apolloMarketSize/avgIcpScore are computed live, not read from Sector
 * ---------------------------------------------------------------------
 *
 * Sector.apolloMarketSize is null for all 12 rows in prod — it was never
 * populated by the #41 backfill (which only wrote Sector.slug/displayName).
 * Kissinger's live `sectorAggregates.apolloMarketSize` is actually a SUM of
 * each org's own `apollo_market_size` meta computed at query time, not a
 * stored per-sector value — confirmed by cross-checking scripts/_probe3.ts
 * (Kissinger) against scripts/_probe5.ts (Postgres Organization.apolloMarketSize
 * summed per sector): both produce identical per-sector sums (e.g.
 * defense-aerospace: 625, rail: 29). This module reproduces that same live
 * SUM/AVG computation over Organization rows rather than reading a static
 * Sector column, so the heatmap can never silently go stale in the absence
 * of a dual-write path that keeps a cached Sector aggregate in sync (no
 * such path exists — Organization.apolloMarketSize/icpScore are set once at
 * backfill/enrichment time with no corresponding Sector-level rollup writer).
 *
 * ---------------------------------------------------------------------
 * defaultAssignee seeding (scripts/seed-sector-assignees.ts)
 * ---------------------------------------------------------------------
 *
 * Sector.defaultAssignee is also null for all 12 rows. The issue asks this
 * be derived from SECTOR_PREFERENCE (src/lib/outreach.ts), but that table's
 * keys (e.g. "rail-transportation-equipment", "fluid-control-water-tech")
 * don't exactly match the 12 Sector.slug values (e.g. "rail",
 * "fluid-control") — they're a different, more granular taxonomy that
 * predates the Sector model. SECTOR_SLUG_ASSIGNEE below is a hand-written,
 * explicit mapping (not a fuzzy/prefix match) covering the 9 sectors where a
 * single SECTOR_PREFERENCE entry is an unambiguous match. "ev", "chemicals",
 * and "aerospace" are deliberately left unmapped: each has 2+ plausible
 * SECTOR_PREFERENCE candidates (e.g. "aerospace" could reasonably map to
 * either "aerospace-commercial" (Jake) or "defense-aerospace" (Ben)), and
 * guessing wrong actively misroutes real prospecting work to the wrong
 * teammate — a worse outcome than leaving it null and falling through to
 * the existing round-robin assignment logic, which is exactly what happens
 * for these sectors today (no defaultAssignee exists anywhere currently).
 */

import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Sector -> default assignee (see doc comment above for why this is explicit,
// not derived by fuzzy-matching SECTOR_PREFERENCE keys)
// ---------------------------------------------------------------------------

export type TeamMemberName = "Ben" | "Jake" | "Drew";

export const SECTOR_SLUG_ASSIGNEE: Readonly<Record<string, TeamMemberName>> = {
  defense: "Ben",
  "defense-aerospace": "Ben",
  "enterprise-tech": "Drew",
  "capital-goods": "Jake",
  "fluid-control": "Jake",
  "specialty-chemicals": "Jake",
  rail: "Jake",
  "building-products": "Jake",
  "industrial-mfg": "Jake",
  // "ev", "chemicals", "aerospace" intentionally omitted — see module doc comment.
};

/** Pure: resolves a Sector.slug to its default assignee, or null if unmapped (ambiguous or unknown). */
export function defaultAssigneeForSectorSlug(slug: string): TeamMemberName | null {
  return SECTOR_SLUG_ASSIGNEE[slug] ?? null;
}

// ---------------------------------------------------------------------------
// Pure aggregation (unit-tested directly, no I/O)
// ---------------------------------------------------------------------------

export interface SectorHeatmapTile {
  slug: string;
  displayName: string;
  defaultAssignee: TeamMemberName | null;
  orgCount: number;
  prospectsWithContacts: number;
  avgIcpScore: number | null;
  apolloMarketSize: number | null;
}

/** Row shape produced by the OrganizationSector(isPrimary=true) join query below. */
export interface PrimarySectorOrgRow {
  sectorSlug: string;
  apolloMarketSize: number | null;
  icpScore: number | null;
  hasProspectContact: boolean;
}

/**
 * Pure: groups org rows by sector and computes the four heatmap metrics per
 * sector, for every Sector row (including sectors with 0 orgs — an empty
 * tile surfaces a coverage gap rather than being hidden, consistent with the
 * heatmap's stated purpose).
 */
export function aggregateSectorHeatmap(
  sectors: { slug: string; displayName: string; defaultAssignee: string | null }[],
  orgRows: PrimarySectorOrgRow[]
): SectorHeatmapTile[] {
  const bySlug = new Map<string, PrimarySectorOrgRow[]>();
  for (const row of orgRows) {
    const list = bySlug.get(row.sectorSlug);
    if (list) list.push(row);
    else bySlug.set(row.sectorSlug, [row]);
  }

  return sectors.map((sector) => {
    const rows = bySlug.get(sector.slug) ?? [];
    const orgCount = rows.length;
    const prospectsWithContacts = rows.filter((r) => r.hasProspectContact).length;

    const icpScores = rows
      .map((r) => r.icpScore)
      .filter((v): v is number => v !== null);
    const avgIcpScore =
      icpScores.length > 0 ? icpScores.reduce((sum, v) => sum + v, 0) / icpScores.length : null;

    const apolloValues = rows
      .map((r) => r.apolloMarketSize)
      .filter((v): v is number => v !== null);
    const apolloMarketSize =
      apolloValues.length > 0 ? apolloValues.reduce((sum, v) => sum + v, 0) : null;

    return {
      slug: sector.slug,
      displayName: sector.displayName,
      defaultAssignee: (sector.defaultAssignee as TeamMemberName | null) ?? null,
      orgCount,
      prospectsWithContacts,
      avgIcpScore,
      apolloMarketSize,
    };
  });
}

// ---------------------------------------------------------------------------
// I/O — heatmap tiles for all sectors
// ---------------------------------------------------------------------------

/**
 * Postgres replacement for `fetchSectorAggregates()`. Returns one tile per
 * Sector row (never throws — returns [] on any Postgres error, matching the
 * empty-array-on-offline contract `fetchSectorAggregates()` already has, so
 * src/app/(main)/sectors/page.tsx's existing EmptyState handling needs no
 * change).
 */
export async function fetchSectorHeatmapFromPostgres(): Promise<SectorHeatmapTile[]> {
  try {
    const [sectors, links] = await Promise.all([
      prisma.sector.findMany({
        select: { slug: true, displayName: true, defaultAssignee: true },
        orderBy: { slug: "asc" },
      }),
      prisma.organizationSector.findMany({
        where: { isPrimary: true },
        select: {
          sectorSlug: true,
          organization: {
            select: {
              apolloMarketSize: true,
              icpScore: true,
              contacts: { where: { isProspectContact: true }, select: { id: true }, take: 1 },
            },
          },
        },
      }),
    ]);

    const orgRows: PrimarySectorOrgRow[] = links.map((link) => ({
      sectorSlug: link.sectorSlug,
      apolloMarketSize: link.organization.apolloMarketSize,
      icpScore: link.organization.icpScore,
      hasProspectContact: link.organization.contacts.length > 0,
    }));

    return aggregateSectorHeatmap(sectors, orgRows);
  } catch (err) {
    console.warn(
      "[sectors-read] fetchSectorHeatmapFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// I/O — org list for a single sector (/sectors/[slug])
// ---------------------------------------------------------------------------

export interface SectorOrgListItem {
  id: string;
  name: string;
  tags: string[];
  hq: string | null;
  website: string | null;
}

/** Looks up a Sector's display name by slug, for the /sectors/[slug] page heading. Returns null on error or unknown slug. */
export async function fetchSectorDisplayName(slug: string): Promise<string | null> {
  try {
    const sector = await prisma.sector.findUnique({ where: { slug }, select: { displayName: true } });
    return sector?.displayName ?? null;
  } catch (err) {
    console.warn(
      "[sectors-read] fetchSectorDisplayName failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Postgres replacement for `fetchOrgsForSector()`. Returns the non-archived
 * orgs whose *primary* sector is `slug` (matches the heatmap tile's
 * orgCount exactly, since both use the same isPrimary=true join). Uses the
 * Organization's Postgres id (not kissingerId) for the `id` field's link
 * target — org detail links are still routed by kissingerId, so callers
 * needing that must use OrgRow.kissingerId, not this list function.
 *
 * Returns null (never throws) on any Postgres error.
 */
export async function fetchOrgsForSectorFromPostgres(slug: string): Promise<SectorOrgListItem[] | null> {
  try {
    const orgs = await prisma.organization.findMany({
      where: {
        isArchived: false,
        sectors: { some: { sectorSlug: slug, isPrimary: true } },
      },
      select: {
        kissingerId: true,
        id: true,
        name: true,
        hq: true,
        website: true,
        tags: { select: { tag: true } },
      },
      orderBy: { name: "asc" },
    });

    return orgs.map((org) => ({
      id: org.kissingerId ?? org.id,
      name: org.name,
      tags: org.tags.map((t) => t.tag),
      hq: org.hq,
      website: org.website,
    }));
  } catch (err) {
    console.warn(
      "[sectors-read] fetchOrgsForSectorFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
