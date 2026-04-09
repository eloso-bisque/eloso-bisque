/**
 * Unit tests for investor fit scoring (BIS-331)
 *
 * Tests scoreInvestor() with all five investor-specific factors:
 *   stageFit, thesisAlignment, checkSizeFit, warmIntroPath, portfolioOverlap
 */

import { describe, it, expect } from "vitest";
import { scoreInvestor } from "../score-contact";
import type { InvestorScoringContact } from "../score-contact";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvestor(overrides: Partial<InvestorScoringContact> = {}): InvestorScoringContact {
  return {
    id: "inv-001",
    name: "Test VC Fund",
    kind: "org",
    tags: ["vc"],
    notes: "",
    meta: [],
    updatedAt: new Date().toISOString(),
    edges: [],
    isInvestor: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("scoreInvestor structure", () => {
  it("returns score in 0–100 range", () => {
    const result = scoreInvestor(makeInvestor());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns all five investor breakdown factors", () => {
    const result = scoreInvestor(makeInvestor());
    const keys = Object.keys(result.breakdown);
    expect(keys).toContain("stageFit");
    expect(keys).toContain("thesisAlignment");
    expect(keys).toContain("checkSizeFit");
    expect(keys).toContain("warmIntroPath");
    expect(keys).toContain("portfolioOverlap");
    expect(keys).toHaveLength(5);
  });

  it("breakdown weights sum to 1.0", () => {
    const result = scoreInvestor(makeInvestor());
    const totalWeight = Object.values(result.breakdown).reduce((s, f) => s + f.weight, 0);
    expect(Math.abs(totalWeight - 1.0)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// Stage fit
// ---------------------------------------------------------------------------

describe("stageFit", () => {
  it("scores high for seed-stage tag", () => {
    const r = scoreInvestor(makeInvestor({ tags: ["vc", "seed"] }));
    expect(r.breakdown.stageFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores high for pre-seed tag", () => {
    const r = scoreInvestor(makeInvestor({ tags: ["vc", "pre-seed"] }));
    expect(r.breakdown.stageFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores high for series-a tag", () => {
    const r = scoreInvestor(makeInvestor({ tags: ["vc", "series-a"] }));
    expect(r.breakdown.stageFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores high for series-b tag (Eloso's near-term target round)", () => {
    // Series-B is in ELOSO_STAGE_TAGS because it's part of our fundraising target window
    const r = scoreInvestor(makeInvestor({ tags: ["vc", "series-b"] }));
    expect(r.breakdown.stageFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores high for Seed in meta stage field", () => {
    const r = scoreInvestor(makeInvestor({
      meta: [{ key: "stage", value: "Pre-seed/Seed" }],
    }));
    expect(r.breakdown.stageFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores low for late-stage fund", () => {
    const r = scoreInvestor(makeInvestor({
      tags: ["vc", "growth"],
      meta: [{ key: "stage", value: "Late stage" }],
    }));
    expect(r.breakdown.stageFit.raw).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Thesis alignment
// ---------------------------------------------------------------------------

describe("thesisAlignment", () => {
  it("scores very high for supply chain focused fund", () => {
    const r = scoreInvestor(makeInvestor({
      tags: ["vc", "supply-chain", "logistics", "manufacturing"],
    }));
    expect(r.breakdown.thesisAlignment.raw).toBeGreaterThanOrEqual(0.8);
  });

  it("scores moderate for single relevant tag", () => {
    const r = scoreInvestor(makeInvestor({ tags: ["vc", "enterprise"] }));
    expect(r.breakdown.thesisAlignment.raw).toBeGreaterThanOrEqual(0.5);
  });

  it("scores lower for generalist fund", () => {
    const r = scoreInvestor(makeInvestor({
      tags: ["vc", "b2b"],
      meta: [{ key: "sector_fit", value: "generalist_b2b" }],
    }));
    // generalist still gets some credit
    expect(r.breakdown.thesisAlignment.raw).toBeGreaterThan(0.0);
  });

  it("scores high when supply chain is in notes", () => {
    const r = scoreInvestor(makeInvestor({
      notes: "We invest in supply chain and enterprise software companies.",
    }));
    expect(r.breakdown.thesisAlignment.raw).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// Check size fit
// ---------------------------------------------------------------------------

describe("checkSizeFit", () => {
  it("scores high for check size in Eloso range ($500K–$5M)", () => {
    const r = scoreInvestor(makeInvestor({
      meta: [{ key: "check_size", value: "$500K–$3M" }],
    }));
    expect(r.breakdown.checkSizeFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores high for check size that overlaps with range", () => {
    const r = scoreInvestor(makeInvestor({
      meta: [{ key: "check_size", value: "$1M–$5M" }],
    }));
    expect(r.breakdown.checkSizeFit.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores low for very large fund (too big)", () => {
    const r = scoreInvestor(makeInvestor({
      meta: [{ key: "check_size", value: "$10M–$50M" }],
    }));
    expect(r.breakdown.checkSizeFit.raw).toBeLessThan(0.5);
  });

  it("scores moderate for unknown check size", () => {
    const r = scoreInvestor(makeInvestor({ meta: [] }));
    expect(r.breakdown.checkSizeFit.raw).toBeGreaterThan(0.0);
    expect(r.breakdown.checkSizeFit.raw).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// Warm intro path
// ---------------------------------------------------------------------------

describe("warmIntroPath", () => {
  it("scores highest when warm_intro_path meta is present", () => {
    const r = scoreInvestor(makeInvestor({
      meta: [{ key: "warm_intro_path", value: "Via John Smith at Andreessen" }],
    }));
    expect(r.breakdown.warmIntroPath.raw).toBe(1.0);
  });

  it("scores higher for high priority", () => {
    const r = scoreInvestor(makeInvestor({
      meta: [{ key: "priority", value: "high" }],
    }));
    expect(r.breakdown.warmIntroPath.raw).toBeGreaterThan(0.3);
  });

  it("scores low when no path info", () => {
    const r = scoreInvestor(makeInvestor({ meta: [], edges: [] }));
    expect(r.breakdown.warmIntroPath.raw).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Portfolio overlap
// ---------------------------------------------------------------------------

describe("portfolioOverlap", () => {
  it("scores high for supply-chain portfolio focus", () => {
    const r = scoreInvestor(makeInvestor({
      tags: ["vc", "supply-chain", "logistics"],
    }));
    expect(r.breakdown.portfolioOverlap.raw).toBeGreaterThanOrEqual(0.9);
  });

  it("scores moderate for single overlap tag", () => {
    const r = scoreInvestor(makeInvestor({ tags: ["vc", "enterprise"] }));
    expect(r.breakdown.portfolioOverlap.raw).toBeGreaterThan(0.3);
  });

  it("scores low for no overlap tags", () => {
    const r = scoreInvestor(makeInvestor({ tags: ["vc"] }));
    expect(r.breakdown.portfolioOverlap.raw).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// End-to-end scenarios
// ---------------------------------------------------------------------------

describe("scoreInvestor end-to-end", () => {
  it("gives high score to ideal supply chain seed fund", () => {
    const ideal = makeInvestor({
      name: "Dynamo Ventures",
      tags: ["vc", "seed", "supply-chain", "logistics", "manufacturing", "enterprise"],
      meta: [
        { key: "stage", value: "Pre-seed/Seed" },
        { key: "check_size", value: "$500K–$3M" },
        { key: "priority", value: "high" },
        { key: "warm_intro_path", value: "Via Sarah at Ironspring" },
        { key: "thesis", value: "Supply chain technology for enterprise manufacturers" },
      ],
    });
    const r = scoreInvestor(ideal);
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("gives low score to misaligned consumer late-stage fund", () => {
    const poor = makeInvestor({
      name: "Consumer Growth Fund",
      tags: ["vc", "consumer", "growth"],
      meta: [
        { key: "stage", value: "Series D/E" },
        { key: "check_size", value: "$30M–$100M" },
      ],
    });
    const r = scoreInvestor(poor);
    expect(r.score).toBeLessThan(40);
  });

  it("investor person also scores correctly", () => {
    const person = makeInvestor({
      kind: "person",
      tags: ["vc", "partner", "supply-chain"],
      meta: [
        { key: "title", value: "General Partner" },
        { key: "priority", value: "high" },
      ],
    });
    const r = scoreInvestor(person);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
