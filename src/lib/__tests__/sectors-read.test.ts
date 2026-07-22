/**
 * Tests for the Postgres-backed Sectors heatmap read path (GH #44).
 *
 * Behavior under test (from docs/prisma-schema-design.md section 3.4 and
 * the GH #44 issue text), not from the implementation:
 *   - Every Sector row produces a tile, including sectors with zero orgs
 *     (a coverage gap is information, not something to hide).
 *   - orgCount / prospectsWithContacts / avgIcpScore / apolloMarketSize are
 *     computed per-sector from the org rows joined to that sector.
 *   - apolloMarketSize is a SUM across the sector's orgs (matching
 *     Kissinger's live-computed value, not a stored per-sector constant);
 *     avgIcpScore is a mean over only the orgs that have a score set.
 *   - defaultAssigneeForSectorSlug returns a value for sectors with an
 *     unambiguous SECTOR_PREFERENCE match, and null for genuinely ambiguous
 *     ones (ev, chemicals, aerospace) rather than guessing.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateSectorHeatmap,
  defaultAssigneeForSectorSlug,
  type PrimarySectorOrgRow,
} from "../sectors-read";

describe("aggregateSectorHeatmap", () => {
  const sectors = [
    { slug: "defense-aerospace", displayName: "Defense Aerospace", defaultAssignee: "Ben" },
    { slug: "ev", displayName: "Ev", defaultAssignee: null },
  ];

  it("produces a tile for a sector with zero orgs, rather than omitting it", () => {
    const tiles = aggregateSectorHeatmap(sectors, []);
    expect(tiles).toHaveLength(2);
    const evTile = tiles.find((t) => t.slug === "ev");
    expect(evTile).toMatchObject({
      orgCount: 0,
      prospectsWithContacts: 0,
      avgIcpScore: null,
      apolloMarketSize: null,
    });
  });

  it("counts orgCount and prospectsWithContacts per sector from joined org rows", () => {
    const orgRows: PrimarySectorOrgRow[] = [
      { sectorSlug: "defense-aerospace", apolloMarketSize: 100, icpScore: 80, hasProspectContact: true },
      { sectorSlug: "defense-aerospace", apolloMarketSize: 200, icpScore: null, hasProspectContact: false },
      { sectorSlug: "defense-aerospace", apolloMarketSize: null, icpScore: 90, hasProspectContact: true },
    ];
    const tiles = aggregateSectorHeatmap(sectors, orgRows);
    const tile = tiles.find((t) => t.slug === "defense-aerospace")!;
    expect(tile.orgCount).toBe(3);
    expect(tile.prospectsWithContacts).toBe(2);
  });

  it("sums apolloMarketSize across the sector's orgs, ignoring nulls, matching Kissinger's live SUM", () => {
    const orgRows: PrimarySectorOrgRow[] = [
      { sectorSlug: "defense-aerospace", apolloMarketSize: 100, icpScore: null, hasProspectContact: false },
      { sectorSlug: "defense-aerospace", apolloMarketSize: 200, icpScore: null, hasProspectContact: false },
      { sectorSlug: "defense-aerospace", apolloMarketSize: null, icpScore: null, hasProspectContact: false },
    ];
    const tiles = aggregateSectorHeatmap(sectors, orgRows);
    expect(tiles.find((t) => t.slug === "defense-aerospace")!.apolloMarketSize).toBe(300);
  });

  it("returns null apolloMarketSize when no org in the sector has a value set (not 0)", () => {
    const orgRows: PrimarySectorOrgRow[] = [
      { sectorSlug: "defense-aerospace", apolloMarketSize: null, icpScore: null, hasProspectContact: false },
    ];
    const tiles = aggregateSectorHeatmap(sectors, orgRows);
    expect(tiles.find((t) => t.slug === "defense-aerospace")!.apolloMarketSize).toBeNull();
  });

  it("averages icpScore only over orgs that have a score, excluding nulls from the denominator", () => {
    const orgRows: PrimarySectorOrgRow[] = [
      { sectorSlug: "defense-aerospace", apolloMarketSize: null, icpScore: 80, hasProspectContact: false },
      { sectorSlug: "defense-aerospace", apolloMarketSize: null, icpScore: null, hasProspectContact: false },
      { sectorSlug: "defense-aerospace", apolloMarketSize: null, icpScore: 60, hasProspectContact: false },
    ];
    const tiles = aggregateSectorHeatmap(sectors, orgRows);
    // (80 + 60) / 2 = 70, not / 3
    expect(tiles.find((t) => t.slug === "defense-aerospace")!.avgIcpScore).toBe(70);
  });

  it("carries the seeded defaultAssignee through to the tile", () => {
    const tiles = aggregateSectorHeatmap(sectors, []);
    expect(tiles.find((t) => t.slug === "defense-aerospace")!.defaultAssignee).toBe("Ben");
    expect(tiles.find((t) => t.slug === "ev")!.defaultAssignee).toBeNull();
  });
});

describe("defaultAssigneeForSectorSlug", () => {
  it("resolves sectors with an unambiguous SECTOR_PREFERENCE match", () => {
    expect(defaultAssigneeForSectorSlug("defense-aerospace")).toBe("Ben");
    expect(defaultAssigneeForSectorSlug("enterprise-tech")).toBe("Drew");
    expect(defaultAssigneeForSectorSlug("capital-goods")).toBe("Jake");
  });

  // Explicitly called out in GH #44: guessing an ambiguous match would
  // misroute real prospecting work, so these must resolve to null rather
  // than a best-effort guess.
  it("returns null for sectors with 2+ plausible but ambiguous matches", () => {
    expect(defaultAssigneeForSectorSlug("ev")).toBeNull();
    expect(defaultAssigneeForSectorSlug("chemicals")).toBeNull();
    expect(defaultAssigneeForSectorSlug("aerospace")).toBeNull();
  });

  it("returns null for an unknown slug", () => {
    expect(defaultAssigneeForSectorSlug("not-a-real-sector")).toBeNull();
  });
});
