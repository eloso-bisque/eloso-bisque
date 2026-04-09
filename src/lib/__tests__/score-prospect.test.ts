/**
 * Unit tests for score-prospect.ts
 *
 * Covers all five ICP scoring factors and end-to-end scenarios.
 * 20+ tests total.
 */

import { describe, it, expect } from "vitest";
import { scoreProspect, parseRevenue } from "../score-prospect";
import type { ScoringProspect } from "../score-prospect";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProspect(overrides: Partial<ScoringProspect> = {}): ScoringProspect {
  return {
    id: "test-org-001",
    name: "Test Manufacturing Co",
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
// Structure tests
// ---------------------------------------------------------------------------

describe("scoreProspect structure", () => {
  it("returns icp_score in 0–100 range", () => {
    const result = scoreProspect({});
    expect(result.icp_score).toBeGreaterThanOrEqual(0);
    expect(result.icp_score).toBeLessThanOrEqual(100);
  });

  it("returns all five breakdown factors", () => {
    const result = scoreProspect(makeProspect());
    const keys = Object.keys(result.breakdown);
    expect(keys).toContain("verticalFit");
    expect(keys).toContain("sizeFit");
    expect(keys).toContain("supplyChainComplexity");
    expect(keys).toContain("buyerAccessibility");
    expect(keys).toContain("warmIntroPath");
  });

  it("each breakdown factor has raw, weight, weighted, label", () => {
    const result = scoreProspect(makeProspect());
    for (const [, v] of Object.entries(result.breakdown)) {
      expect(v.raw).toBeGreaterThanOrEqual(0);
      expect(v.raw).toBeLessThanOrEqual(1);
      expect(v.weight).toBeGreaterThan(0);
      expect(v.weighted).toBeGreaterThanOrEqual(0);
      expect(v.label).toBeTruthy();
    }
  });

  it("weights sum to 1.0", () => {
    const result = scoreProspect(makeProspect());
    const total = Object.values(result.breakdown).reduce((s, v) => s + v.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
  });

  it("score is always 0–100 for all inputs", () => {
    const prospects: ScoringProspect[] = [
      {},
      makeProspect(),
      makeProspect({ tags: ["aerospace"], meta: [{ key: "revenue", value: "$2B" }] }),
      makeProspect({ tags: ["smb"] }),
    ];
    for (const p of prospects) {
      const result = scoreProspect(p);
      expect(result.icp_score).toBeGreaterThanOrEqual(0);
      expect(result.icp_score).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// Vertical fit (30%)
// ---------------------------------------------------------------------------

describe("vertical fit", () => {
  it("aerospace tag = 1.0", () => {
    const p = makeProspect({ tags: ["aerospace"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });

  it("defense tag = 1.0", () => {
    const p = makeProspect({ tags: ["defense"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });

  it("heavy-equipment tag = 1.0", () => {
    const p = makeProspect({ tags: ["heavy-equipment"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });

  it("contract-manufacturing tag = 1.0", () => {
    const p = makeProspect({ tags: ["contract-manufacturing"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });

  it("capital-goods tag = 1.0", () => {
    const p = makeProspect({ tags: ["capital-goods"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });

  it("industry meta 'Aerospace & Defense' = 1.0", () => {
    const p = makeProspect({ meta: [{ key: "industry", value: "Aerospace & Defense" }] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });

  it("rail tag = 0.85", () => {
    const p = makeProspect({ tags: ["rail"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(0.85);
  });

  it("chemicals tag = 0.75", () => {
    const p = makeProspect({ tags: ["chemicals"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(0.75);
  });

  it("manufacturing tag = 0.6", () => {
    const p = makeProspect({ tags: ["manufacturing"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(0.6);
  });

  it("industrial tag = 0.6", () => {
    const p = makeProspect({ tags: ["industrial"] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(0.6);
  });

  it("unrelated vertical = 0.1", () => {
    const p = makeProspect({ tags: ["fintech", "saas"], meta: [{ key: "industry", value: "Financial Services" }] });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(0.1);
  });

  it("notes with 'heavy equipment' = 1.0", () => {
    const p = makeProspect({ notes: "Manufacturer of heavy equipment for mining" });
    expect(scoreProspect(p).breakdown.verticalFit.raw).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Size fit (25%)
// ---------------------------------------------------------------------------

describe("size fit", () => {
  it("$2B revenue = 1.0 enterprise", () => {
    const p = makeProspect({ meta: [{ key: "revenue", value: "$2B" }] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(1.0);
  });

  it("$500M revenue = 0.85 mid-market", () => {
    const p = makeProspect({ meta: [{ key: "revenue", value: "$500M" }] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(0.85);
  });

  it("$100M revenue = 0.85 (lower bound of mid-market)", () => {
    const p = makeProspect({ meta: [{ key: "revenue", value: "$100M" }] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(0.85);
  });

  it("$50M revenue = 0.3 SMB", () => {
    const p = makeProspect({ meta: [{ key: "revenue", value: "$50M" }] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(0.3);
  });

  it("enterprise tag fallback = 1.0", () => {
    const p = makeProspect({ tags: ["enterprise"] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(1.0);
  });

  it("mid-market tag fallback = 0.85", () => {
    const p = makeProspect({ tags: ["mid-market"] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(0.85);
  });

  it("smb tag fallback = 0.3", () => {
    const p = makeProspect({ tags: ["smb"] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(0.3);
  });

  it("5000 employees = 1.0", () => {
    const p = makeProspect({ meta: [{ key: "employees", value: "8000" }] });
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(1.0);
  });

  it("no size signal = 0.5 unknown", () => {
    const p = makeProspect();
    expect(scoreProspect(p).breakdown.sizeFit.raw).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Supply chain complexity (20%)
// ---------------------------------------------------------------------------

describe("supply chain complexity", () => {
  it("supply-chain-complex tag = 1.0", () => {
    const p = makeProspect({ tags: ["supply-chain-complex"] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(1.0);
  });

  it("meta supply_chain_complexity=complex = 1.0", () => {
    const p = makeProspect({ meta: [{ key: "supply_chain_complexity", value: "complex" }] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(1.0);
  });

  it("meta supply_chain_complexity=moderate = 0.7", () => {
    const p = makeProspect({ meta: [{ key: "supply_chain_complexity", value: "moderate" }] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(0.7);
  });

  it("meta supply_chain_complexity=simple = 0.3", () => {
    const p = makeProspect({ meta: [{ key: "supply_chain_complexity", value: "simple" }] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(0.3);
  });

  it("aerospace tag implies complex = 1.0", () => {
    const p = makeProspect({ tags: ["aerospace"] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(1.0);
  });

  it("unknown = 0.5", () => {
    const p = makeProspect({ tags: ["chemicals"] });
    // chemicals doesn't imply complexity
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(0.5);
  });

  it("many known_suppliers + known_customers = 1.0", () => {
    const p = makeProspect({ meta: [{ key: "known_suppliers", value: "8" }, { key: "known_customers", value: "5" }] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(1.0);
  });

  it("a few known suppliers = 0.7", () => {
    const p = makeProspect({ meta: [{ key: "known_suppliers", value: "3" }] });
    expect(scoreProspect(p).breakdown.supplyChainComplexity.raw).toBe(0.7);
  });
});

// ---------------------------------------------------------------------------
// Buyer accessibility (15%)
// ---------------------------------------------------------------------------

describe("buyer accessibility", () => {
  it("no people = 0.2", () => {
    const p = makeProspect({ people: [] });
    expect(scoreProspect(p).breakdown.buyerAccessibility.raw).toBe(0.2);
  });

  it("has contacts but no CSCO = 0.6", () => {
    const p = makeProspect({
      people: [
        { tags: [], meta: [{ key: "title", value: "Sales Manager" }] },
      ],
    });
    expect(scoreProspect(p).breakdown.buyerAccessibility.raw).toBe(0.6);
  });

  it("has CSCO contact = 1.0", () => {
    const p = makeProspect({
      people: [
        { tags: [], meta: [{ key: "title", value: "CSCO" }] },
      ],
    });
    expect(scoreProspect(p).breakdown.buyerAccessibility.raw).toBe(1.0);
  });

  it("has VP Supply Chain contact = 1.0", () => {
    const p = makeProspect({
      people: [
        { tags: [], meta: [{ key: "title", value: "VP Supply Chain" }] },
      ],
    });
    expect(scoreProspect(p).breakdown.buyerAccessibility.raw).toBe(1.0);
  });

  it("has Director of Supply Chain = 1.0", () => {
    const p = makeProspect({
      people: [
        { tags: [], meta: [{ key: "title", value: "Director of Supply Chain" }] },
      ],
    });
    expect(scoreProspect(p).breakdown.buyerAccessibility.raw).toBe(1.0);
  });

  it("has VP Operations = 1.0", () => {
    const p = makeProspect({
      people: [
        { tags: [], meta: [{ key: "title", value: "VP Operations" }] },
      ],
    });
    expect(scoreProspect(p).breakdown.buyerAccessibility.raw).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Warm intro path (10%)
// ---------------------------------------------------------------------------

describe("warm intro path", () => {
  it("warm_intro_path meta set = 1.0", () => {
    const p = makeProspect({ meta: [{ key: "warm_intro_path", value: "via John at Acme" }] });
    expect(scoreProspect(p).breakdown.warmIntroPath.raw).toBe(1.0);
  });

  it("knows edge = 0.7", () => {
    const p = makeProspect({ edges: [{ relation: "knows", strength: 0.8 }] });
    expect(scoreProspect(p).breakdown.warmIntroPath.raw).toBe(0.7);
  });

  it("ally edge = 0.7", () => {
    const p = makeProspect({ edges: [{ relation: "ally", strength: 0.9 }] });
    expect(scoreProspect(p).breakdown.warmIntroPath.raw).toBe(0.7);
  });

  it("warm tag = 0.7", () => {
    const p = makeProspect({ tags: ["warm"] });
    expect(scoreProspect(p).breakdown.warmIntroPath.raw).toBe(0.7);
  });

  it("no warm path = 0.1", () => {
    const p = makeProspect();
    expect(scoreProspect(p).breakdown.warmIntroPath.raw).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// parseRevenue helper
// ---------------------------------------------------------------------------

describe("parseRevenue", () => {
  it("parses $2B", () => {
    expect(parseRevenue("$2B")).toBe(2e9);
  });

  it("parses $500M", () => {
    expect(parseRevenue("$500M")).toBe(500e6);
  });

  it("parses $1.5B", () => {
    expect(parseRevenue("$1.5B")).toBe(1.5e9);
  });

  it("parses $50M", () => {
    expect(parseRevenue("$50M")).toBe(50e6);
  });

  it("parses plain number", () => {
    expect(parseRevenue("2000000000")).toBe(2e9);
  });

  it("returns null for empty string", () => {
    expect(parseRevenue("")).toBeNull();
  });

  it("returns null for unparseable", () => {
    expect(parseRevenue("unknown")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenarios
// ---------------------------------------------------------------------------

describe("end-to-end scoring", () => {
  it("ideal ICP prospect scores 70+", () => {
    const p: ScoringProspect = {
      id: "acme-aerospace-001",
      name: "Acme Aerospace Systems",
      kind: "org",
      tags: ["aerospace", "prospect"],
      notes: "Major Tier 1 supplier for commercial aerospace. Long production runs.",
      meta: [
        { key: "revenue", value: "$3B" },
        { key: "supply_chain_complexity", value: "complex" },
        { key: "warm_intro_path", value: "via Sarah at Boeing" },
        { key: "industry", value: "Aerospace & Defense" },
      ],
      edges: [],
      people: [
        { tags: [], meta: [{ key: "title", value: "Chief Supply Chain Officer" }] },
      ],
    };
    const result = scoreProspect(p);
    expect(result.icp_score).toBeGreaterThanOrEqual(70);
  });

  it("unrelated SMB with no contacts scores under 25", () => {
    const p: ScoringProspect = {
      id: "fintech-startup-001",
      name: "PayQuick Fintech",
      kind: "org",
      tags: ["fintech", "saas"],
      notes: "B2C payments startup",
      meta: [{ key: "revenue", value: "$5M" }],
      edges: [],
      people: [],
    };
    const result = scoreProspect(p);
    expect(result.icp_score).toBeLessThanOrEqual(25);
  });

  it("mid-market contract manufacturer with moderate path scores 50+", () => {
    const p: ScoringProspect = {
      id: "contract-mfg-001",
      name: "Precision Parts Inc",
      kind: "org",
      tags: ["contract-manufacturing"],
      notes: "CNC machining and assembly",
      meta: [
        { key: "revenue", value: "$250M" },
        { key: "supply_chain_complexity", value: "moderate" },
      ],
      edges: [{ relation: "knows", strength: 0.7 }],
      people: [
        { tags: [], meta: [{ key: "title", value: "Director of Operations" }] },
      ],
    };
    const result = scoreProspect(p);
    expect(result.icp_score).toBeGreaterThanOrEqual(50);
  });

  it("defense company with no contacts but warm path scores 55+", () => {
    const p: ScoringProspect = {
      id: "defense-001",
      name: "Shield Defense Systems",
      kind: "org",
      tags: ["defense"],
      meta: [
        { key: "revenue", value: "$800M" },
        { key: "warm_intro_path", value: "ex-colleague is CSCO there" },
      ],
      edges: [],
      people: [],
    };
    const result = scoreProspect(p);
    expect(result.icp_score).toBeGreaterThanOrEqual(55);
  });
});
