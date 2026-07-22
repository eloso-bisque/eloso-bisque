/**
 * Tests for the Postgres-backed Investors section read path
 * (Prisma Phase 3.5, GH #45).
 *
 * Behavior under test (from GH #45 / docs/prisma-schema-design.md section
 * 4.1 item 5), not from the implementation:
 *
 *   - Investor firm classification: an Organization row qualifies as an
 *     investor firm iff `isVcFirm=true` (mirrors `isInvestorFirm()` in
 *     src/lib/kissinger.ts, which treats "vc" and "investor" tags
 *     equivalently — see WHERE_INVESTOR_FIRMS test below for the literal
 *     Prisma predicate).
 *   - Investor person classification: a Contact row qualifies iff
 *     `isInvestorContact=true`.
 *   - Field mapping correctness: every investor-specific column
 *     (investmentStage, checkSize, thesis, sectorFit, investorPipeline,
 *     priority-via-synthetic-tag for Organization; incentive, warmIntroPath,
 *     priority for Contact) must round-trip into the exact shape the
 *     existing /investors pages already render (InvestorFirm / InvestorPerson
 *     from src/lib/kissinger.ts) so the page components need no behavioral
 *     changes beyond swapping the data source.
 *   - Organization has no `priority` column (schema judgment call recorded in
 *     scripts/backfill/build-plan.ts) — firm priority is carried as a
 *     synthetic `priority:<value>` OrganizationTag row instead, and must be
 *     parsed back out correctly (and not treated as a "real" tag elsewhere).
 *   - InvestorPipelineStage enum values (Research/WarmIntro/FirstMeeting/...)
 *     must round-trip losslessly to/from the human-readable UI stage labels
 *     ("Research"/"Warm Intro"/"First Meeting"/...) already used throughout
 *     the /investors pages and the pipeline-stage API route's VALID_STAGES.
 *   - Rows missing a `kissingerId` must be dropped (never surfaced with a
 *     dead link), matching the established contacts-read.ts /
 *     sectors-read.ts contract from GH #44.
 *   - The synthetic `meta` array built for `scoreInvestor()` (src/lib/
 *     score-contact.ts) from Postgres-typed fields must reproduce the same
 *     scoring behavior as the original Kissinger-meta-driven inputs, so
 *     migrating the data source does not silently change fit scores.
 */

import { describe, it, expect } from "vitest";
import {
  INVESTOR_FIRM_WHERE,
  INVESTOR_PERSON_WHERE,
  parseOrgPriorityTag,
  PIPELINE_STAGE_LABELS,
  pipelineStageEnumToLabel,
  pipelineStageLabelToEnum,
  orgRowToInvestorFirm,
  contactRowToInvestorPerson,
  buildFirmScoringInput,
  buildPersonScoringInput,
  overrideFirmMetaWithPostgres,
  overridePersonMetaWithPostgres,
} from "../investors-read";
import { scoreInvestor } from "../score-contact";

// ---------------------------------------------------------------------------
// Classification predicates
// ---------------------------------------------------------------------------

describe("investor classification predicates", () => {
  it("firm predicate matches isVcFirm=true, non-archived (mirrors isInvestorFirm() in kissinger.ts)", () => {
    expect(INVESTOR_FIRM_WHERE).toEqual({ isVcFirm: true, isArchived: false });
  });

  it("person predicate matches isInvestorContact=true, non-archived", () => {
    expect(INVESTOR_PERSON_WHERE).toEqual({ isInvestorContact: true, isArchived: false });
  });
});

// ---------------------------------------------------------------------------
// Synthetic priority tag (Organization has no `priority` column)
// ---------------------------------------------------------------------------

describe("parseOrgPriorityTag", () => {
  it("extracts the value from a priority:<value> synthetic tag", () => {
    expect(parseOrgPriorityTag(["seed", "priority:high", "vc"])).toBe("high");
  });

  it("returns empty string when no priority tag is present", () => {
    expect(parseOrgPriorityTag(["seed", "vc"])).toBe("");
  });

  it("returns empty string for an empty tag list", () => {
    expect(parseOrgPriorityTag([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// InvestorPipelineStage enum <-> UI label round-trip
// ---------------------------------------------------------------------------

describe("pipeline stage enum/label mapping", () => {
  it("maps every enum value to its exact UI label used by PipelineStageSelector/VALID_STAGES", () => {
    expect(PIPELINE_STAGE_LABELS).toEqual({
      Research: "Research",
      WarmIntro: "Warm Intro",
      FirstMeeting: "First Meeting",
      PartnerMeeting: "Partner Meeting",
      TermSheet: "Term Sheet",
      Closed: "Closed",
      Passed: "Passed",
    });
  });

  it("pipelineStageEnumToLabel converts every enum value correctly", () => {
    expect(pipelineStageEnumToLabel("Research")).toBe("Research");
    expect(pipelineStageEnumToLabel("WarmIntro")).toBe("Warm Intro");
    expect(pipelineStageEnumToLabel("FirstMeeting")).toBe("First Meeting");
    expect(pipelineStageEnumToLabel("PartnerMeeting")).toBe("Partner Meeting");
    expect(pipelineStageEnumToLabel("TermSheet")).toBe("Term Sheet");
    expect(pipelineStageEnumToLabel("Closed")).toBe("Closed");
    expect(pipelineStageEnumToLabel("Passed")).toBe("Passed");
  });

  it("pipelineStageLabelToEnum is the exact inverse of pipelineStageEnumToLabel", () => {
    for (const [enumValue, label] of Object.entries(PIPELINE_STAGE_LABELS)) {
      expect(pipelineStageLabelToEnum(label)).toBe(enumValue);
    }
  });

  it("pipelineStageLabelToEnum returns null for an unrecognized label instead of guessing", () => {
    expect(pipelineStageLabelToEnum("Not A Real Stage")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Organization row -> InvestorFirm mapping
// ---------------------------------------------------------------------------

describe("orgRowToInvestorFirm", () => {
  const baseRow = {
    kissingerId: "kis-firm-1",
    name: "Acme Ventures",
    hq: "San Francisco, CA",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    isArchived: false,
    investmentStage: "seed",
    checkSize: "$500K–$3M",
    thesis: "Supply chain and logistics software",
    sectorFit: "supply_chain",
    investorPipeline: "WarmIntro" as const,
    website: "acme.vc",
    tags: [{ tag: "vc" }, { tag: "priority:high" }],
  };

  it("maps every investor-specific field to the InvestorFirm shape the pages already render", () => {
    const result = orgRowToInvestorFirm(baseRow);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("kis-firm-1");
    expect(result?.kind).toBe("org");
    expect(result?.stage).toBe("seed");
    expect(result?.checkSize).toBe("$500K–$3M");
    expect(result?.thesis).toBe("Supply chain and logistics software");
    expect(result?.sectorFit).toBe("supply_chain");
    expect(result?.pipelineStage).toBe("Warm Intro");
    expect(result?.website).toBe("acme.vc");
    expect(result?.priority).toBe("high");
    expect(result?.location).toBe("San Francisco, CA");
    expect(result?.tags).toEqual(["vc", "priority:high"]);
  });

  it("returns null when kissingerId is missing, rather than surfacing a dead link", () => {
    expect(orgRowToInvestorFirm({ ...baseRow, kissingerId: null })).toBeNull();
  });

  it("maps null investor fields to empty strings so the UI's `{field && (...)}` guards hide them", () => {
    const result = orgRowToInvestorFirm({
      ...baseRow,
      investmentStage: null,
      checkSize: null,
      thesis: null,
      sectorFit: null,
      website: null,
      investorPipeline: "Research" as const,
      tags: [],
    });
    expect(result?.stage).toBe("");
    expect(result?.checkSize).toBe("");
    expect(result?.thesis).toBe("");
    expect(result?.sectorFit).toBe("");
    expect(result?.website).toBe("");
    expect(result?.priority).toBe("");
    // Default pipeline stage (schema default) still renders correctly.
    expect(result?.pipelineStage).toBe("Research");
  });
});

// ---------------------------------------------------------------------------
// Contact row -> InvestorPerson mapping
// ---------------------------------------------------------------------------

describe("contactRowToInvestorPerson", () => {
  const baseRow = {
    kissingerId: "kis-person-1",
    name: "Jamie Rivera",
    location: "Austin, TX",
    title: "Partner",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    isArchived: false,
    incentive: "Deal sourcing, portfolio company success, carry",
    warmIntroPath: "Introduced via Drew's LinkedIn network",
    priority: "high",
    linkedinUrl: "linkedin.com/in/jamierivera",
    tags: [{ tag: "vc" }, { tag: "seed" }],
    organization: { kissingerId: "kis-firm-1", name: "Acme Ventures" },
  };

  it("maps every investor-specific field to the InvestorPerson shape the pages already render", () => {
    const result = contactRowToInvestorPerson(baseRow);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("kis-person-1");
    expect(result?.kind).toBe("person");
    expect(result?.incentive).toBe("Deal sourcing, portfolio company success, carry");
    expect(result?.priority).toBe("high");
    expect(result?.firmName).toBe("Acme Ventures");
    expect(result?.firmId).toBe("kis-firm-1");
    expect(result?.title).toBe("Partner");
  });

  it("returns null when kissingerId is missing", () => {
    expect(contactRowToInvestorPerson({ ...baseRow, kissingerId: null })).toBeNull();
  });

  it("handles a person with no resolved organization gracefully", () => {
    const result = contactRowToInvestorPerson({ ...baseRow, organization: null });
    expect(result?.firmName).toBe("");
    expect(result?.firmId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scoring input construction — field mapping correctness for scoreInvestor()
// ---------------------------------------------------------------------------

describe("buildFirmScoringInput", () => {
  it("builds a synthetic meta array that reproduces the same score scoreInvestor gave the Kissinger-meta version", () => {
    const firm = orgRowToInvestorFirm({
      kissingerId: "kis-firm-2",
      name: "Deep Tech Capital",
      hq: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      isArchived: false,
      investmentStage: "seed",
      checkSize: "$1M–$5M",
      thesis: "supply chain, logistics, manufacturing AI",
      sectorFit: "industrial",
      investorPipeline: "Research" as const,
      website: null,
      tags: ["supply-chain", "logistics", "manufacturing", "vc"].map((t) => ({ tag: t })),
    })!;

    const scoringInput = buildFirmScoringInput(firm, "Backs supply chain and logistics startups");
    const viaPostgres = scoreInvestor(scoringInput);

    // Equivalent legacy Kissinger-meta shaped input for the same underlying values.
    const viaKissingerMeta = scoreInvestor({
      id: firm.id,
      name: firm.name,
      kind: firm.kind,
      tags: firm.tags,
      notes: "Backs supply chain and logistics startups",
      meta: [
        { key: "stage", value: "seed" },
        { key: "thesis", value: "supply chain, logistics, manufacturing AI" },
        { key: "sector_fit", value: "industrial" },
        { key: "check_size", value: "$1M–$5M" },
      ],
      updatedAt: firm.updatedAt,
      edges: [],
      isInvestor: true,
    });

    expect(viaPostgres.score).toBe(viaKissingerMeta.score);
  });

  it("omits empty-string fields from the synthetic meta array rather than passing empty values through", () => {
    const firm = orgRowToInvestorFirm({
      kissingerId: "kis-firm-3",
      name: "Unknown Fund",
      hq: null,
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      isArchived: false,
      investmentStage: null,
      checkSize: null,
      thesis: null,
      sectorFit: null,
      investorPipeline: "Research" as const,
      website: null,
      tags: [{ tag: "vc" }],
    })!;
    const scoringInput = buildFirmScoringInput(firm, "");
    expect(scoringInput.meta).toEqual([]);
  });
});

describe("buildPersonScoringInput", () => {
  it("builds a synthetic meta array carrying warm_intro_path and priority for scoreInvestor", () => {
    const person = contactRowToInvestorPerson({
      kissingerId: "kis-person-2",
      name: "Alex Kim",
      location: null,
      title: "Principal",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      isArchived: false,
      incentive: "Deal origination",
      warmIntroPath: "Met at conference",
      priority: "medium",
      linkedinUrl: null,
      tags: [{ tag: "vc" }],
      organization: null,
    })!;

    const scoringInput = buildPersonScoringInput(person, "Met at conference", "");
    expect(scoringInput.meta).toEqual(
      expect.arrayContaining([
        { key: "warm_intro_path", value: "Met at conference" },
        { key: "priority", value: "medium" },
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// Detail-page meta override (Postgres investor fields take precedence over
// stale/absent Kissinger meta, without disturbing non-investor meta keys
// like location/website/source that remain Kissinger-sourced in this phase)
// ---------------------------------------------------------------------------

describe("overrideFirmMetaWithPostgres", () => {
  const kissingerMeta = [
    { key: "location", value: "San Francisco, CA" },
    { key: "website", value: "acme.vc" },
    { key: "source", value: "manual" },
    { key: "stage", value: "STALE_KISSINGER_VALUE" },
  ];

  it("overrides investor-specific keys with Postgres values and leaves other keys untouched", () => {
    const merged = overrideFirmMetaWithPostgres(kissingerMeta, {
      stage: "seed",
      checkSize: "$500K–$3M",
      thesis: "Supply chain",
      sectorFit: "industrial",
      priority: "high",
      pipelineStage: "Warm Intro",
      website: "acme.vc",
    });
    const asRecord = Object.fromEntries(merged.map((m) => [m.key, m.value]));
    expect(asRecord.stage).toBe("seed");
    expect(asRecord.check_size).toBe("$500K–$3M");
    expect(asRecord.thesis).toBe("Supply chain");
    expect(asRecord.sector_fit).toBe("industrial");
    expect(asRecord.priority).toBe("high");
    expect(asRecord.pipeline_stage).toBe("Warm Intro");
    // Untouched Kissinger-only keys survive the merge.
    expect(asRecord.location).toBe("San Francisco, CA");
    expect(asRecord.source).toBe("manual");
  });

  it("falls back to the original Kissinger meta unchanged when the Postgres lookup returned null", () => {
    expect(overrideFirmMetaWithPostgres(kissingerMeta, null)).toEqual(kissingerMeta);
  });

  it("drops an override key entirely (rather than writing an empty value) when the Postgres field is empty", () => {
    const merged = overrideFirmMetaWithPostgres(kissingerMeta, {
      stage: "",
      checkSize: "",
      thesis: "",
      sectorFit: "",
      priority: "",
      pipelineStage: "Research",
      website: "",
    });
    const asRecord = Object.fromEntries(merged.map((m) => [m.key, m.value]));
    expect(asRecord.stage).toBeUndefined();
    expect(asRecord.check_size).toBeUndefined();
  });
});

describe("overridePersonMetaWithPostgres", () => {
  it("overrides incentive/warm_intro_path/priority and leaves other keys untouched", () => {
    const kissingerMeta = [
      { key: "title", value: "Partner" },
      { key: "linkedin_url", value: "linkedin.com/in/x" },
      { key: "incentive", value: "STALE" },
    ];
    const merged = overridePersonMetaWithPostgres(kissingerMeta, {
      incentive: "Deal sourcing",
      warmIntroPath: "Met at demo day",
      priority: "high",
    });
    const asRecord = Object.fromEntries(merged.map((m) => [m.key, m.value]));
    expect(asRecord.incentive).toBe("Deal sourcing");
    expect(asRecord.warm_intro_path).toBe("Met at demo day");
    expect(asRecord.priority).toBe("high");
    expect(asRecord.title).toBe("Partner");
  });

  it("falls back to the original Kissinger meta unchanged when the Postgres lookup returned null", () => {
    const kissingerMeta = [{ key: "title", value: "Partner" }];
    expect(overridePersonMetaWithPostgres(kissingerMeta, null)).toEqual(kissingerMeta);
  });
});
