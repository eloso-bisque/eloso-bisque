/**
 * Tests for Slice 2 (BIS-340) prospect UI logic.
 *
 * Covers:
 *   - Filter logic (vertical + stage)
 *   - Sort by ICP score
 *   - Score badge color logic
 *   - Supply chain connections derivation
 *   - Quick stats calculation
 */

import { describe, it, expect } from "vitest";
import { scoreProspect } from "../score-prospect";
import type { ScoringProspect } from "../score-prospect";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProspect(
  id: string,
  overrides: Partial<ScoringProspect> = {}
): ScoringProspect & { id: string } {
  return {
    id,
    name: `Company ${id}`,
    kind: "org",
    tags: [],
    notes: "",
    meta: [],
    edges: [],
    people: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vertical filter logic
// ---------------------------------------------------------------------------

describe("vertical filter logic", () => {
  const VERTICAL_FILTER_OPTIONS = [
    { value: "aerospace-defense", tags: ["aerospace", "defense", "aerospace-defense"] },
    { value: "heavy-equipment", tags: ["heavy-equipment", "heavy_equipment"] },
    { value: "contract-manufacturing", tags: ["contract-manufacturing", "contract_manufacturing"] },
    { value: "capital-goods", tags: ["capital-goods", "capital_goods"] },
    { value: "rail", tags: ["rail", "railroad", "railway"] },
    { value: "chemicals", tags: ["chemicals", "chemical"] },
    { value: "manufacturing", tags: ["manufacturing"] },
    { value: "industrial", tags: ["industrial"] },
  ];

  function filterByVertical(prospects: ScoringProspect[], verticalValue: string): ScoringProspect[] {
    const option = VERTICAL_FILTER_OPTIONS.find((o) => o.value === verticalValue);
    if (!option) return prospects;
    return prospects.filter((c) =>
      option.tags.some((tag) => (c.tags ?? []).includes(tag)) ||
      (c.meta ?? []).some((m) =>
        m.key === "industry" &&
        option.tags.some((t) => m.value.toLowerCase().includes(t.replace(/-/g, " ")))
      )
    );
  }

  it("aerospace filter matches aerospace tag", () => {
    const prospects = [
      makeProspect("1", { tags: ["aerospace"] }),
      makeProspect("2", { tags: ["chemicals"] }),
      makeProspect("3", { tags: ["manufacturing"] }),
    ];
    const filtered = filterByVertical(prospects, "aerospace-defense");
    expect(filtered.map((p) => p.id)).toEqual(["1"]);
  });

  it("aerospace filter matches defense tag", () => {
    const prospects = [
      makeProspect("1", { tags: ["defense"] }),
      makeProspect("2", { tags: ["manufacturing"] }),
    ];
    const filtered = filterByVertical(prospects, "aerospace-defense");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("aerospace filter matches industry meta", () => {
    const prospects = [
      makeProspect("1", { meta: [{ key: "industry", value: "Aerospace & Defense" }] }),
      makeProspect("2", { meta: [{ key: "industry", value: "Chemicals" }] }),
    ];
    const filtered = filterByVertical(prospects, "aerospace-defense");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("rail filter matches rail tag", () => {
    const prospects = [
      makeProspect("1", { tags: ["rail"] }),
      makeProspect("2", { tags: ["railroad"] }),
      makeProspect("3", { tags: ["aerospace"] }),
    ];
    const filtered = filterByVertical(prospects, "rail");
    expect(filtered.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("chemicals filter matches chemicals tag", () => {
    const prospects = [
      makeProspect("1", { tags: ["chemicals"] }),
      makeProspect("2", { tags: ["chemical"] }),
      makeProspect("3", { tags: ["aerospace"] }),
    ];
    const filtered = filterByVertical(prospects, "chemicals");
    expect(filtered.map((p) => p.id)).toEqual(["1", "2"]);
  });

  it("no filter returns all prospects", () => {
    const prospects = [
      makeProspect("1", { tags: ["aerospace"] }),
      makeProspect("2", { tags: ["manufacturing"] }),
      makeProspect("3", { tags: ["chemicals"] }),
    ];
    const filtered = filterByVertical(prospects, "");
    expect(filtered).toHaveLength(3);
  });

  it("unknown vertical value returns all prospects", () => {
    const prospects = [makeProspect("1"), makeProspect("2")];
    const filtered = filterByVertical(prospects, "nonexistent-vertical");
    expect(filtered).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Stage filter logic
// ---------------------------------------------------------------------------

describe("stage filter logic", () => {
  function filterByStage(prospects: ScoringProspect[], stage: string): ScoringProspect[] {
    if (!stage) return prospects;
    return prospects.filter((c) => (c.tags ?? []).includes(stage));
  }

  it("filters by research stage", () => {
    const prospects = [
      makeProspect("1", { tags: ["research"] }),
      makeProspect("2", { tags: ["contacted"] }),
      makeProspect("3", { tags: ["qualified"] }),
    ];
    const filtered = filterByStage(prospects, "research");
    expect(filtered.map((p) => p.id)).toEqual(["1"]);
  });

  it("filters by contacted stage", () => {
    const prospects = [
      makeProspect("1", { tags: ["research"] }),
      makeProspect("2", { tags: ["contacted"] }),
    ];
    const filtered = filterByStage(prospects, "contacted");
    expect(filtered.map((p) => p.id)).toEqual(["2"]);
  });

  it("filters by engaged stage", () => {
    const prospects = [
      makeProspect("1", { tags: ["engaged", "aerospace"] }),
      makeProspect("2", { tags: ["research"] }),
    ];
    const filtered = filterByStage(prospects, "engaged");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("empty stage filter returns all", () => {
    const prospects = [makeProspect("1"), makeProspect("2"), makeProspect("3")];
    const filtered = filterByStage(prospects, "");
    expect(filtered).toHaveLength(3);
  });

  it("stage filter returns empty when no matches", () => {
    const prospects = [
      makeProspect("1", { tags: ["research"] }),
      makeProspect("2", { tags: ["contacted"] }),
    ];
    const filtered = filterByStage(prospects, "qualified");
    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sort by ICP score
// ---------------------------------------------------------------------------

describe("sort by ICP score", () => {
  it("sorts prospects descending by icp_score", () => {
    const prospects = [
      makeProspect("low", { tags: ["smb"] }),
      makeProspect("high", { tags: ["aerospace"], meta: [{ key: "revenue", value: "$2B" }, { key: "warm_intro_path", value: "yes" }] }),
      makeProspect("mid", { tags: ["manufacturing"], meta: [{ key: "revenue", value: "$200M" }] }),
    ];

    const scored = prospects.map((p) => ({
      ...p,
      icp_score: scoreProspect(p).icp_score,
    }));

    const sorted = [...scored].sort((a, b) => b.icp_score - a.icp_score);
    expect(sorted[0].id).toBe("high");
    expect(sorted[sorted.length - 1].id).toBe("low");
  });

  it("ICP score is stable for identical prospects", () => {
    const p = makeProspect("stable", { tags: ["aerospace"], meta: [{ key: "revenue", value: "$1B" }] });
    const score1 = scoreProspect(p).icp_score;
    const score2 = scoreProspect(p).icp_score;
    expect(score1).toBe(score2);
  });
});

// ---------------------------------------------------------------------------
// ICP score badge color logic
// ---------------------------------------------------------------------------

describe("ICP score badge colors", () => {
  function getBadgeClass(score: number): string {
    if (score >= 70) return "green";
    if (score >= 40) return "yellow";
    return "red";
  }

  it("score 70+ gets green badge", () => {
    expect(getBadgeClass(70)).toBe("green");
    expect(getBadgeClass(85)).toBe("green");
    expect(getBadgeClass(100)).toBe("green");
  });

  it("score 40-69 gets yellow badge", () => {
    expect(getBadgeClass(40)).toBe("yellow");
    expect(getBadgeClass(55)).toBe("yellow");
    expect(getBadgeClass(69)).toBe("yellow");
  });

  it("score below 40 gets red badge", () => {
    expect(getBadgeClass(0)).toBe("red");
    expect(getBadgeClass(20)).toBe("red");
    expect(getBadgeClass(39)).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// Supply chain connections
// ---------------------------------------------------------------------------

describe("supply chain connections", () => {
  function getScConnections(meta: { key: string; value: string }[]): number {
    const suppliers = parseInt(meta.find((m) => m.key === "known_suppliers")?.value ?? "0", 10) || 0;
    const customers = parseInt(meta.find((m) => m.key === "known_customers")?.value ?? "0", 10) || 0;
    return suppliers + customers;
  }

  it("returns sum of known_suppliers + known_customers", () => {
    const meta = [
      { key: "known_suppliers", value: "5" },
      { key: "known_customers", value: "3" },
    ];
    expect(getScConnections(meta)).toBe(8);
  });

  it("returns 0 when no SC meta", () => {
    expect(getScConnections([])).toBe(0);
  });

  it("works with only suppliers", () => {
    const meta = [{ key: "known_suppliers", value: "7" }];
    expect(getScConnections(meta)).toBe(7);
  });

  it("works with only customers", () => {
    const meta = [{ key: "known_customers", value: "4" }];
    expect(getScConnections(meta)).toBe(4);
  });

  it("handles non-numeric values gracefully", () => {
    const meta = [
      { key: "known_suppliers", value: "unknown" },
      { key: "known_customers", value: "3" },
    ];
    expect(getScConnections(meta)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Quick stats calculation
// ---------------------------------------------------------------------------

describe("quick stats calculation", () => {
  const VERTICAL_FILTER_OPTIONS = [
    { value: "aerospace-defense", tags: ["aerospace", "defense", "aerospace-defense"] },
    { value: "manufacturing", tags: ["manufacturing"] },
    { value: "chemicals", tags: ["chemicals", "chemical"] },
  ];

  interface ProspectLike {
    tags: string[];
    meta: { key: string; value: string }[];
  }

  function computeQuickStats(prospects: ProspectLike[]) {
    return {
      total: prospects.length,
      classified: prospects.filter((c) =>
        VERTICAL_FILTER_OPTIONS.some((opt) =>
          opt.tags.some((t) => c.tags.includes(t)) ||
          c.meta.some((m) =>
            m.key === "industry" &&
            opt.tags.some((tag) => m.value.toLowerCase().includes(tag.replace(/-/g, " ")))
          )
        )
      ).length,
      withSupplyChainData: prospects.filter((c) => {
        const suppliers = parseInt(c.meta.find((m) => m.key === "known_suppliers")?.value ?? "0", 10);
        const customers = parseInt(c.meta.find((m) => m.key === "known_customers")?.value ?? "0", 10);
        return suppliers + customers > 0;
      }).length,
    };
  }

  it("counts total correctly", () => {
    const prospects = [
      { tags: ["aerospace"], meta: [] },
      { tags: ["chemicals"], meta: [] },
      { tags: ["saas"], meta: [] },
    ];
    expect(computeQuickStats(prospects).total).toBe(3);
  });

  it("counts classified correctly", () => {
    const prospects = [
      { tags: ["aerospace"], meta: [] },
      { tags: ["chemicals"], meta: [] },
      { tags: ["saas"], meta: [] }, // not classified
    ];
    expect(computeQuickStats(prospects).classified).toBe(2);
  });

  it("counts with supply chain data correctly", () => {
    const prospects = [
      { tags: [], meta: [{ key: "known_suppliers", value: "3" }] },
      { tags: [], meta: [{ key: "known_customers", value: "2" }] },
      { tags: [], meta: [] },
    ];
    expect(computeQuickStats(prospects).withSupplyChainData).toBe(2);
  });

  it("returns zeros for empty prospects", () => {
    const stats = computeQuickStats([]);
    expect(stats.total).toBe(0);
    expect(stats.classified).toBe(0);
    expect(stats.withSupplyChainData).toBe(0);
  });
});
