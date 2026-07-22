import { describe, it, expect } from "vitest";
import {
  mapOutreachStage,
  mapInvestorPipelineStage,
  mapFunnelStage,
  parseEmployeeCount,
  parseRevenueEstimate,
  classifyOrgTags,
  classifyPersonTags,
  resolveHq,
  mapContactEventKind,
  extractRoleFromEdgeNotes,
  normalizeSectorSlug,
} from "../mappers";

describe("mapOutreachStage", () => {
  it("passes through exact enum values unchanged", () => {
    expect(mapOutreachStage("cold").value).toBe("cold");
    expect(mapOutreachStage("touched_1").value).toBe("touched_1");
    expect(mapOutreachStage("touched_2").value).toBe("touched_2");
    expect(mapOutreachStage("touched_3").value).toBe("touched_3");
    expect(mapOutreachStage("responded").value).toBe("responded");
  });

  it("maps the real-world 'new' value to cold via the documented alias", () => {
    const result = mapOutreachStage("new");
    expect(result.value).toBe("cold");
    expect(result.warning).toBeUndefined();
  });

  it("defaults unrecognized values to cold and flags a warning", () => {
    const result = mapOutreachStage("touuched_1");
    expect(result.value).toBe("cold");
    expect(result.warning).toContain("touuched_1");
  });

  it("defaults missing values to cold without a warning", () => {
    const result = mapOutreachStage(undefined);
    expect(result.value).toBe("cold");
    expect(result.warning).toBeUndefined();
  });
});

describe("mapInvestorPipelineStage", () => {
  it("passes through exact enum values", () => {
    expect(mapInvestorPipelineStage("WarmIntro").value).toBe("WarmIntro");
  });

  it("is case-insensitive against real data ('research' / 'Research')", () => {
    expect(mapInvestorPipelineStage("research").value).toBe("Research");
    expect(mapInvestorPipelineStage("Research").value).toBe("Research");
  });

  it("defaults unrecognized values to Research and flags a warning", () => {
    const result = mapInvestorPipelineStage("negotiating");
    expect(result.value).toBe("Research");
    expect(result.warning).toContain("negotiating");
  });

  it("defaults missing values to Research without a warning", () => {
    expect(mapInvestorPipelineStage(undefined).warning).toBeUndefined();
  });
});

describe("mapFunnelStage", () => {
  it("passes through exact enum values", () => {
    expect(mapFunnelStage("MeetingBooked").value).toBe("MeetingBooked");
  });

  it("defaults unrecognized values to Identified and flags a warning", () => {
    const result = mapFunnelStage("bogus_stage");
    expect(result.value).toBe("Identified");
    expect(result.warning).toContain("bogus_stage");
  });
});

describe("parseEmployeeCount", () => {
  it("parses a single approximate value", () => {
    expect(parseEmployeeCount("~1,200")).toBe(1200);
  });

  it("averages a range", () => {
    expect(parseEmployeeCount("~400-600")).toBe(500);
  });

  it("averages a range with thousands separators", () => {
    expect(parseEmployeeCount("~1,800-2,200")).toBe(2000);
  });

  it("returns null for unparseable input", () => {
    expect(parseEmployeeCount("unknown")).toBeNull();
    expect(parseEmployeeCount(undefined)).toBeNull();
  });
});

describe("parseRevenueEstimate", () => {
  it("parses a clean range and averages, converting M to a raw dollar float", () => {
    expect(parseRevenueEstimate("$400M-$600M")).toBe(500_000_000);
  });

  it("parses a range with a trailing qualifier in parens", () => {
    expect(parseRevenueEstimate("$200M-$400M (Haws segment est.)")).toBe(300_000_000);
  });

  it("parses a single amount with a '+' suffix (ignoring the plus)", () => {
    expect(parseRevenueEstimate("$2B+ (est., private)")).toBe(2_000_000_000);
  });

  it("takes only the leading amount when a range-break is followed by unrelated text", () => {
    // "revenue" is $0; the "~$800M raised" clause is capital raised, not revenue,
    // and must NOT be averaged in.
    expect(parseRevenueEstimate("$0 revenue (pre-revenue); ~$800M raised")).toBe(0);
  });

  it("returns null for unparseable input", () => {
    expect(parseRevenueEstimate("n/a")).toBeNull();
    expect(parseRevenueEstimate(undefined)).toBeNull();
  });
});

describe("classifyOrgTags", () => {
  it("classifies prospect vs vc/investor independently (not mutually exclusive)", () => {
    // Real data: orgs like "Cowboy Ventures" carry both prospect and vc tags.
    const result = classifyOrgTags(["investor", "prospect", "pre-seed", "vc"]);
    expect(result.isProspect).toBe(true);
    expect(result.isVcFirm).toBe(true);
    expect(result.plainTags).toEqual(["pre-seed"]);
  });

  it("extracts vertical: tags as sector tags and normalizes the slug", () => {
    const result = classifyOrgTags(["vertical:defense", "fit-high"]);
    expect(result.sectorSlugs).toEqual(["defense"]);
    expect(result.fitTier).toBe("high");
    expect(result.plainTags).toEqual([]);
  });

  it("leaves unrecognized tags (including single-occurrence ones) as plain tags", () => {
    const result = classifyOrgTags(["eloso-prospect", "railcar-manufacturing"]);
    expect(result.isProspect).toBe(false);
    expect(result.plainTags).toEqual(["eloso-prospect", "railcar-manufacturing"]);
  });
});

describe("classifyPersonTags", () => {
  it("resolves queue assignment and outreach-sent status", () => {
    const result = classifyPersonTags(["linkedin", "source:human", "queue:ben", "outreach-sent"]);
    expect(result.queueUserId).toBe("usr_ben");
    expect(result.outreachSent).toBe(true);
    expect(result.plainTags).toEqual(["linkedin", "source:human"]);
  });

  it("flags an unrecognized queue name instead of silently dropping it", () => {
    const result = classifyPersonTags(["queue:intern"]);
    expect(result.queueUserId).toBeNull();
    expect(result.warning).toContain("queue:intern");
    expect(result.plainTags).toContain("queue:intern");
  });

  it("maps prospect-contact and investor tags to booleans", () => {
    const result = classifyPersonTags(["prospect-contact", "investor"]);
    expect(result.isProspectContact).toBe(true);
    expect(result.isInvestorContact).toBe(true);
  });

  // Regression test for GH #45: a person tagged only "vc" (no "investor"
  // tag) must still classify as an investor contact. Real prod data has 65
  // live Kissinger person entities tagged "vc" this way (e.g. VC partners/
  // founders) — before this fix, all 65 fell through to isInvestorContact
  // =false, a 49% false-negative rate against Kissinger's own
  // INVESTOR_PERSON_TAGS = new Set(["vc", "investor"]) definition of an
  // investor person (src/lib/kissinger.ts).
  it("classifies a person tagged only 'vc' (no 'investor' tag) as an investor contact", () => {
    const result = classifyPersonTags(["vc", "partner", "seed"]);
    expect(result.isInvestorContact).toBe(true);
  });

  it("strips the 'vc' tag out of plainTags the same way 'investor' is stripped", () => {
    const result = classifyPersonTags(["vc", "partner"]);
    expect(result.plainTags).toEqual(["partner"]);
  });
});

describe("resolveHq", () => {
  it("prefers hq over hq_location over location", () => {
    expect(resolveHq({ hq: "A", hq_location: "B", location: "C" })).toBe("A");
    expect(resolveHq({ hq_location: "B", location: "C" })).toBe("B");
    expect(resolveHq({ location: "C" })).toBe("C");
    expect(resolveHq({})).toBeNull();
  });
});

describe("mapContactEventKind", () => {
  it("maps known kinds case-insensitively", () => {
    expect(mapContactEventKind("meeting")).toBe("Meeting");
    expect(mapContactEventKind("Call")).toBe("Call");
    expect(mapContactEventKind("EMAIL")).toBe("Email");
    expect(mapContactEventKind("note")).toBe("Note");
  });

  it("maps unrecognized/outreach-touch kinds to Custom", () => {
    expect(mapContactEventKind("outreach_touch_1")).toBe("Custom");
    expect(mapContactEventKind("outreach_touch_2")).toBe("Custom");
    expect(mapContactEventKind("anything_else")).toBe("Custom");
  });
});

describe("extractRoleFromEdgeNotes", () => {
  it("strips the trailing ' at <Org>' suffix", () => {
    expect(extractRoleFromEdgeNotes("Co-Founder & COO at Anduril Industries")).toBe("Co-Founder & COO");
  });

  it("returns the notes unchanged when there is no ' at ' suffix", () => {
    expect(extractRoleFromEdgeNotes("Supply Chain Lead")).toBe("Supply Chain Lead");
  });

  it("returns null for empty notes", () => {
    expect(extractRoleFromEdgeNotes("")).toBeNull();
  });
});

describe("normalizeSectorSlug", () => {
  it("converts snake_case meta values to hyphenated slugs with a title-cased display name", () => {
    expect(normalizeSectorSlug("defense_aerospace")).toEqual({
      slug: "defense-aerospace",
      displayName: "Defense Aerospace",
    });
  });

  it("passes through already-hyphenated slugs", () => {
    expect(normalizeSectorSlug("defense")).toEqual({ slug: "defense", displayName: "Defense" });
  });
});
