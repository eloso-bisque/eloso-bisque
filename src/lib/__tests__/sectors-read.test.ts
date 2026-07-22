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
 *   - icpColor/icpLabel treat Organization.icpScore as a 0-100 value (the
 *     Postgres convention used everywhere else in the app), not the 0-1
 *     fraction the old Kissinger-backed page assumed. An org with
 *     icpScore=80 must render as "80", not "8000%" or "0.8%" (independent
 *     review of PR #50, finding #1: reverting this fix locally left all 500
 *     other tests passing, i.e. zero regression protection existed).
 *   - fetchSectorHeatmapFromPostgres excludes archived organizations from
 *     the heatmap tile counts/averages, matching the isArchived filter
 *     fetchOrgsForSectorFromPostgres already applies (independent review of
 *     PR #50, finding #2: without this, the tile and its own detail page
 *     silently disagree once any sector org is archived).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sectorFindManyMock = vi.fn();
const organizationSectorFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sector: {
      findMany: (...args: unknown[]) => sectorFindManyMock(...args),
    },
    organizationSector: {
      findMany: (...args: unknown[]) => organizationSectorFindManyMock(...args),
    },
  },
}));

import {
  aggregateSectorHeatmap,
  defaultAssigneeForSectorSlug,
  fetchSectorHeatmapFromPostgres,
  icpColor,
  icpLabel,
  type PrimarySectorOrgRow,
} from "../sectors-read";

beforeEach(() => {
  vi.clearAllMocks();
});

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

// ---------------------------------------------------------------------------
// icpColor / icpLabel — independent review of PR #50, finding #1.
//
// Postgres stores Organization.icpScore 0-100; the pre-fix Sectors page
// assumed the 0-1 fraction Kissinger's (always-null) sectorAggregates value
// would have used. These were previously private, untested helpers — the
// reviewer reverted them to the 0-1 assumption and all 500 other tests still
// passed. The assertions below are chosen so the pre-fix (0-1) logic
// produces a visibly different, wrong result for each one.
// ---------------------------------------------------------------------------

describe("icpLabel", () => {
  it("renders a 0-100 icpScore as a plain rounded integer, not a percent-scaled fraction", () => {
    // Pre-fix (0-1 assumption) code computed `(score*100).toFixed(0)+"%"`,
    // which would render icpScore=80 as "8000%" instead of "80".
    expect(icpLabel(80)).toBe("80");
  });

  it("rounds a fractional score to the nearest integer", () => {
    expect(icpLabel(77.6)).toBe("78");
  });

  it("renders a null score as an em dash", () => {
    expect(icpLabel(null)).toBe("—");
  });
});

describe("icpColor", () => {
  it("colors a mediocre 0-100 score yellow, not green", () => {
    // Pre-fix (0-1 assumption) code checked `score > 0.7`, which is true for
    // almost any real 0-100 score (including 50) — so a middling score would
    // have been shown as green instead of yellow.
    expect(icpColor(50)).toBe("bg-yellow-100 text-yellow-800");
  });

  it("colors a poor 0-100 score red, not green", () => {
    expect(icpColor(30)).toBe("bg-red-100 text-red-800");
  });

  it("colors a strong 0-100 score green", () => {
    expect(icpColor(85)).toBe("bg-green-100 text-green-800");
  });

  it("colors a null score gray", () => {
    expect(icpColor(null)).toBe("bg-gray-100 text-gray-500");
  });
});

// ---------------------------------------------------------------------------
// fetchSectorHeatmapFromPostgres — independent review of PR #50, finding #2.
//
// fetchOrgsForSectorFromPostgres (the /sectors/[sector] detail page) filters
// out archived orgs; the heatmap tile query did not, so the next org
// archived out of a sector would make the tile disagree with its own detail
// page. The mock below simulates real Postgres findMany behavior: it only
// applies the isArchived filter if the query's `where` clause actually
// requests it, so this test fails if the isArchived filter is ever dropped
// from the query, exactly like reverting the fix would fail it.
// ---------------------------------------------------------------------------

describe("fetchSectorHeatmapFromPostgres", () => {
  const ICP_SCORE_NON_ARCHIVED = 80;
  const ICP_SCORE_ARCHIVED = 20;

  const rawLinks = [
    {
      sectorSlug: "defense-aerospace",
      isPrimary: true,
      organization: {
        isArchived: false,
        apolloMarketSize: 100,
        icpScore: ICP_SCORE_NON_ARCHIVED,
        contacts: [],
      },
    },
    {
      sectorSlug: "defense-aerospace",
      isPrimary: true,
      organization: {
        isArchived: true,
        apolloMarketSize: 900,
        icpScore: ICP_SCORE_ARCHIVED,
        contacts: [],
      },
    },
  ];

  beforeEach(() => {
    sectorFindManyMock.mockResolvedValue([
      { slug: "defense-aerospace", displayName: "Defense Aerospace", defaultAssignee: null },
    ]);

    organizationSectorFindManyMock.mockImplementation(
      async ({ where }: { where: { isPrimary?: boolean; organization?: { isArchived?: boolean } } }) => {
        const orgWhere = where.organization ?? {};
        return rawLinks.filter((link) => {
          if (where.isPrimary !== undefined && link.isPrimary !== where.isPrimary) return false;
          if (orgWhere.isArchived !== undefined && link.organization.isArchived !== orgWhere.isArchived) {
            return false;
          }
          return true;
        });
      }
    );
  });

  it("excludes archived orgs from a sector's orgCount and avgIcpScore, matching fetchOrgsForSectorFromPostgres's isArchived filter", async () => {
    const tiles = await fetchSectorHeatmapFromPostgres();
    const tile = tiles.find((t) => t.slug === "defense-aerospace")!;
    // Both orgs would be counted (orgCount=2, avgIcpScore=(80+20)/2=50) if
    // the isArchived filter were missing or reverted.
    expect(tile.orgCount).toBe(1);
    expect(tile.avgIcpScore).toBe(ICP_SCORE_NON_ARCHIVED);
  });
});
