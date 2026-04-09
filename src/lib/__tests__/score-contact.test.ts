/**
 * Unit tests for score-contact.ts
 *
 * Covers all six scoring factors and end-to-end scenarios.
 */

import { describe, it, expect } from "vitest";
import { scoreContact } from "../score-contact";
import type { ScoringContact } from "../score-contact";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeContact(overrides: Partial<ScoringContact> = {}): ScoringContact {
  return {
    id: "test-001",
    name: "Test Person",
    kind: "person",
    tags: [],
    notes: "",
    meta: [],
    updatedAt: new Date().toISOString(),
    edges: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("scoreContact structure", () => {
  it("returns score in 0–100 range", () => {
    const result = scoreContact({});
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns all six breakdown factors", () => {
    const result = scoreContact(makeContact());
    const keys = Object.keys(result.breakdown);
    expect(keys).toContain("titleRelevance");
    expect(keys).toContain("seniority");
    expect(keys).toContain("orgType");
    expect(keys).toContain("interactionRecency");
    expect(keys).toContain("networkProximity");
    expect(keys).toContain("recordCompleteness");
  });

  it("each breakdown factor has raw, weight, weighted, label", () => {
    const result = scoreContact(makeContact());
    for (const [, v] of Object.entries(result.breakdown)) {
      expect(v.raw).toBeGreaterThanOrEqual(0);
      expect(v.raw).toBeLessThanOrEqual(1);
      expect(v.weight).toBeGreaterThan(0);
      expect(v.weighted).toBeGreaterThanOrEqual(0);
      expect(v.label).toBeTruthy();
    }
  });

  it("weights sum to 1.0", () => {
    const result = scoreContact(makeContact());
    const total = Object.values(result.breakdown).reduce((s, v) => s + v.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------
// Title relevance
// ---------------------------------------------------------------------------

describe("title relevance", () => {
  const highTitles = [
    "Chief Supply Chain Officer",
    "CSCO",
    "VP Supply Chain",
    "Director of Supply Chain",
    "Demand Planner",
    "Senior Demand Planner",
    "Supply Chain Planner",
    "Head of Procurement",
  ];

  for (const title of highTitles) {
    it(`scores high for title: ${title}`, () => {
      const c = makeContact({ meta: [{ key: "title", value: title }] });
      const result = scoreContact(c);
      expect(result.breakdown.titleRelevance.raw).toBeGreaterThanOrEqual(0.9);
    });
  }

  it("scores medium for CEO", () => {
    const c = makeContact({ meta: [{ key: "title", value: "CEO" }] });
    const result = scoreContact(c);
    expect(result.breakdown.titleRelevance.raw).toBeGreaterThanOrEqual(0.5);
  });

  it("scores zero for Software Engineer", () => {
    const c = makeContact({ meta: [{ key: "title", value: "Software Engineer" }] });
    const result = scoreContact(c);
    expect(result.breakdown.titleRelevance.raw).toBe(0.0);
  });

  it("scores zero for empty title", () => {
    const c = makeContact({ meta: [] });
    const result = scoreContact(c);
    expect(result.breakdown.titleRelevance.raw).toBe(0.0);
  });

  it("picks up supply-chain tag", () => {
    const c = makeContact({ tags: ["supply-chain"] });
    expect(scoreContact(c).breakdown.titleRelevance.raw).toBeGreaterThanOrEqual(0.9);
  });
});

// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

describe("seniority", () => {
  it("C-level = 1.0", () => {
    const c = makeContact({ meta: [{ key: "title", value: "CEO" }] });
    expect(scoreContact(c).breakdown.seniority.raw).toBe(1.0);
  });

  it("CSCO = 1.0", () => {
    const c = makeContact({ meta: [{ key: "title", value: "CSCO" }] });
    expect(scoreContact(c).breakdown.seniority.raw).toBe(1.0);
  });

  it("VP = 0.80", () => {
    const c = makeContact({ meta: [{ key: "title", value: "VP Supply Chain" }] });
    expect(scoreContact(c).breakdown.seniority.raw).toBe(0.80);
  });

  it("Director = 0.65", () => {
    const c = makeContact({ meta: [{ key: "title", value: "Director of Operations" }] });
    expect(scoreContact(c).breakdown.seniority.raw).toBe(0.65);
  });

  it("Manager/Lead = 0.40", () => {
    const c = makeContact({ meta: [{ key: "title", value: "Lead Planner" }] });
    expect(scoreContact(c).breakdown.seniority.raw).toBe(0.40);
  });

  it("No title = 0.0", () => {
    const c = makeContact({ meta: [] });
    expect(scoreContact(c).breakdown.seniority.raw).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// Org type
// ---------------------------------------------------------------------------

describe("org type", () => {
  it("prospect tag = 1.0", () => {
    const c = makeContact({ tags: ["prospect"] });
    expect(scoreContact(c).breakdown.orgType.raw).toBe(1.0);
  });

  it("eloso tag = 1.0", () => {
    const c = makeContact({ tags: ["eloso"] });
    expect(scoreContact(c).breakdown.orgType.raw).toBe(1.0);
  });

  it("ally tag = 0.70", () => {
    const c = makeContact({ tags: ["ally"] });
    expect(scoreContact(c).breakdown.orgType.raw).toBe(0.70);
  });

  it("vc tag = 0.45", () => {
    const c = makeContact({ tags: ["vc"] });
    expect(scoreContact(c).breakdown.orgType.raw).toBe(0.45);
  });

  it("unknown = 0.15", () => {
    const c = makeContact({ tags: ["linkedin"] });
    expect(scoreContact(c).breakdown.orgType.raw).toBe(0.15);
  });

  it("org_tags enrichment works", () => {
    const c = makeContact({ tags: [], org_tags: ["prospect"] });
    expect(scoreContact(c).breakdown.orgType.raw).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Interaction recency
// ---------------------------------------------------------------------------

describe("interaction recency", () => {
  it("very recent (<30 days) = 1.0", () => {
    const c = makeContact({ last_interaction_at: daysAgo(10) });
    expect(scoreContact(c).breakdown.interactionRecency.raw).toBe(1.0);
  });

  it("recent (30–90 days) is between 0.65 and 1.0", () => {
    const c = makeContact({ last_interaction_at: daysAgo(60) });
    const raw = scoreContact(c).breakdown.interactionRecency.raw;
    expect(raw).toBeGreaterThanOrEqual(0.65);
    expect(raw).toBeLessThanOrEqual(1.0);
  });

  it("stale (90–180 days) is between 0.30 and 0.75", () => {
    const c = makeContact({ last_interaction_at: daysAgo(150) });
    const raw = scoreContact(c).breakdown.interactionRecency.raw;
    expect(raw).toBeGreaterThanOrEqual(0.30);
    expect(raw).toBeLessThanOrEqual(0.75);
  });

  it("ancient (>365 days) = 0.05", () => {
    const c = makeContact({ last_interaction_at: daysAgo(500) });
    expect(scoreContact(c).breakdown.interactionRecency.raw).toBeLessThanOrEqual(0.10);
  });

  it("fallback to updatedAt is capped at 0.6", () => {
    const c = makeContact({ updatedAt: daysAgo(5), last_interaction_at: undefined });
    expect(scoreContact(c).breakdown.interactionRecency.raw).toBeLessThanOrEqual(0.6);
  });

  it("no dates = 0.1", () => {
    const c = makeContact({ updatedAt: undefined, last_interaction_at: undefined });
    expect(scoreContact(c).breakdown.interactionRecency.raw).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// Network proximity
// ---------------------------------------------------------------------------

describe("network proximity", () => {
  it("no edges = 0.1", () => {
    const c = makeContact({ edges: [] });
    expect(scoreContact(c).breakdown.networkProximity.raw).toBe(0.1);
  });

  it("ally relation = high score", () => {
    const c = makeContact({
      edges: [{ relation: "ally", strength: 0.8, target_tags: [] }],
    });
    expect(scoreContact(c).breakdown.networkProximity.raw).toBeGreaterThanOrEqual(0.85);
  });

  it("works_at prospect = meaningful score", () => {
    const c = makeContact({
      edges: [{ relation: "works_at", strength: 0.9, target_tags: ["prospect"] }],
    });
    expect(scoreContact(c).breakdown.networkProximity.raw).toBeGreaterThanOrEqual(0.60);
  });
});

// ---------------------------------------------------------------------------
// Record completeness
// ---------------------------------------------------------------------------

describe("record completeness", () => {
  it("full record = 1.0", () => {
    const c = makeContact({
      meta: [
        { key: "email", value: "alice@co.com" },
        { key: "title", value: "VP Supply Chain" },
        { key: "company", value: "Acme" },
        { key: "linkedin_url", value: "https://linkedin.com/in/alice" },
      ],
      notes: "Important contact",
    });
    expect(scoreContact(c).breakdown.recordCompleteness.raw).toBe(1.0);
  });

  it("no data = 0.0", () => {
    const c = makeContact({ meta: [], notes: "" });
    expect(scoreContact(c).breakdown.recordCompleteness.raw).toBe(0.0);
  });

  it("email only = 0.35", () => {
    const c = makeContact({ meta: [{ key: "email", value: "bob@co.com" }] });
    expect(scoreContact(c).breakdown.recordCompleteness.raw).toBeCloseTo(0.35);
  });
});

// ---------------------------------------------------------------------------
// End-to-end
// ---------------------------------------------------------------------------

describe("end-to-end scoring", () => {
  it("CSCO at prospect org with recent interaction scores 70+", () => {
    const c: ScoringContact = {
      id: "csco-001",
      name: "Alice Chen",
      kind: "person",
      tags: ["eloso", "prospect-contact"],
      notes: "Spoke at SCC conference. Very interested in backlog mgmt.",
      meta: [
        { key: "email", value: "alice@heavymfg.com" },
        { key: "title", value: "Chief Supply Chain Officer" },
        { key: "company", value: "Heavy Mfg Co" },
        { key: "linkedin_url", value: "https://linkedin.com/in/alicechen" },
      ],
      last_interaction_at: daysAgo(15),
      edges: [{ relation: "works_at", strength: 1.0, target_tags: ["prospect"] }],
      org_tags: ["prospect"],
      updatedAt: daysAgo(15),
    };
    const result = scoreContact(c);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("stale unknown contact scores under 30", () => {
    const c: ScoringContact = {
      id: "anon-001",
      name: "John Doe",
      kind: "person",
      tags: ["linkedin"],
      notes: "",
      meta: [{ key: "title", value: "Software Engineer" }],
      updatedAt: daysAgo(400),
      edges: [],
      org_tags: [],
    };
    expect(scoreContact(c).score).toBeLessThan(30);
  });

  it("Demand Planner at prospect scores 55+", () => {
    const c: ScoringContact = {
      id: "dp-001",
      name: "Bob Smith",
      kind: "person",
      tags: ["prospect-contact"],
      notes: "",
      meta: [
        { key: "email", value: "bob@mfg.com" },
        { key: "title", value: "Senior Demand Planner" },
        { key: "company", value: "Mfg Corp" },
      ],
      last_interaction_at: daysAgo(45),
      edges: [{ relation: "works_at", strength: 0.8, target_tags: ["prospect"] }],
      org_tags: ["prospect"],
      updatedAt: daysAgo(45),
    };
    expect(scoreContact(c).score).toBeGreaterThanOrEqual(55);
  });

  it("score is always 0–100 for all contact types", () => {
    const contacts: ScoringContact[] = [
      {},
      makeContact(),
      makeContact({ tags: ["prospect"], meta: [{ key: "title", value: "CEO" }] }),
      makeContact({ tags: ["vc"] }),
    ];
    for (const c of contacts) {
      const result = scoreContact(c);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });
});
