import { describe, it, expect } from "vitest";
import {
  buildOrganizationPlan,
  buildContactPlan,
  buildSignalPlan,
  buildGeneratedMessagePlan,
  metaToRecord,
} from "../build-plan";
import { SENDER_TO_ANGLE } from "../constants";
import type { KissingerEntity } from "../kissinger-client";

function entity(overrides: Partial<KissingerEntity>): KissingerEntity {
  return {
    id: "kiss-id-1",
    kind: "person",
    name: "Test Entity",
    tags: [],
    notes: "",
    meta: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    archived: false,
    ...overrides,
  };
}

// Fixtures below are shaped after real records observed against the live
// Kissinger instance (see PR description for the full data survey).

describe("buildOrganizationPlan", () => {
  it("maps a VC firm that is also tagged prospect (real-world overlap)", () => {
    const plan = buildOrganizationPlan(
      entity({
        kind: "org",
        name: "Cowboy Ventures",
        tags: ["investor", "prospect", "pre-seed", "vc"],
        meta: [
          { key: "check_size", value: "$1-15M" },
          { key: "stage", value: "Seed" },
          { key: "pipeline_stage", value: "research" },
        ],
      })
    );

    expect(plan.isProspect).toBe(true);
    expect(plan.isVcFirm).toBe(true);
    expect(plan.investorPipeline).toBe("Research");
    expect(plan.tags).toEqual(["pre-seed"]);
  });

  it("derives sectors from vertical: tags and sector_primary/secondary meta without duplicating an overlapping slug", () => {
    const plan = buildOrganizationPlan(
      entity({
        kind: "org",
        name: "Some Defense Co",
        tags: ["vertical:defense"],
        meta: [{ key: "sector_primary", value: "defense" }],
      })
    );

    expect(plan.sectors).toEqual([{ slug: "defense", isPrimary: true }]);
  });

  it("preserves org-level `priority` meta as a synthetic tag (no schema column exists)", () => {
    const plan = buildOrganizationPlan(
      entity({
        kind: "org",
        name: "Acme Capital",
        tags: ["vc"],
        meta: [{ key: "priority", value: "very_high" }],
      })
    );

    expect(plan.tags).toContain("priority:very_high");
  });

  it("parses messy revenue_estimate and employee_count meta", () => {
    const plan = buildOrganizationPlan(
      entity({
        kind: "org",
        name: "Widget Co",
        meta: [
          { key: "revenue_estimate", value: "$400M-$600M" },
          { key: "employee_count", value: "~1,800-2,200" },
        ],
      })
    );

    expect(plan.revenueUsd).toBe(500_000_000);
    expect(plan.employees).toBe(2000);
  });

  it("leaves a single-occurrence tag like eloso-prospect as a plain tag, not isProspect", () => {
    const plan = buildOrganizationPlan(
      entity({
        kind: "org",
        name: "Trinity Industries",
        tags: ["supply-chain", "railcar-manufacturing", "eloso-prospect"],
      })
    );

    expect(plan.isProspect).toBe(false);
    expect(plan.tags).toEqual(["supply-chain", "railcar-manufacturing", "eloso-prospect"]);
  });
});

describe("buildContactPlan", () => {
  it("maps a queued, already-sent contact (Erle Shepard fixture)", () => {
    const plan = buildContactPlan(
      entity({
        kind: "person",
        name: "Erle Shepard",
        tags: ["linkedin", "source:human", "queue:ben", "outreach-sent"],
        meta: [
          { key: "title", value: "Director Supply Chain Logistics" },
          { key: "outreach_stage", value: "touched_1" },
          { key: "linkedin_url", value: "https://www.linkedin.com/in/erle-shepard-87bb9697" },
          { key: "company", value: "Centra Health" },
          { key: "source", value: "linkedin" },
        ],
      })
    );

    expect(plan.queueUserId).toBe("usr_ben");
    expect(plan.outreachSent).toBe(true);
    expect(plan.outreachStage).toBe("touched_1");
    expect(plan.metaCompanyName).toBe("Centra Health");
    expect(plan.tags).toEqual(["linkedin", "source:human"]);
  });

  it("aliases the real-world 'new' outreach_stage value to cold", () => {
    const plan = buildContactPlan(
      entity({
        meta: [{ key: "outreach_stage", value: "new" }],
      })
    );
    expect(plan.outreachStage).toBe("cold");
    expect(plan.warnings).toEqual([]);
  });

  it("flags a malformed outreach_stage instead of silently guessing", () => {
    const plan = buildContactPlan(
      entity({
        meta: [{ key: "outreach_stage", value: "touuched_1" }],
      })
    );
    expect(plan.outreachStage).toBe("cold");
    expect(plan.warnings.length).toBe(1);
  });
});

describe("buildSignalPlan", () => {
  it("builds a signal from last_signal_date + keyword", () => {
    const meta = metaToRecord([
      { key: "last_signal_date", value: "2026-05-04T07:00:33.541864+00:00" },
    ]);
    const plan = buildSignalPlan(meta);
    expect(plan).toEqual({
      keyword: "",
      postUrl: null,
      signalDate: "2026-05-04T07:00:33.541864+00:00",
      action: null,
      snoozedUntil: null,
    });
  });

  it("returns null when there is no last_signal_date", () => {
    expect(buildSignalPlan({})).toBeNull();
  });

  it("marks dismissed signals via signal_dismissed=true", () => {
    const meta = { last_signal_date: "2026-01-01T00:00:00Z", signal_dismissed: "true" };
    expect(buildSignalPlan(meta)?.action).toBe("dismissed");
  });
});

describe("buildGeneratedMessagePlan", () => {
  it("maps outreach_message_sender to the correct MessageAngle", () => {
    const meta = {
      outreach_message: "Hi there...",
      outreach_message_sender: "drew",
    };
    const result = buildGeneratedMessagePlan(meta, SENDER_TO_ANGLE);
    expect(result.plan?.angle).toBe("technical");
    expect(result.warning).toBeUndefined();
  });

  it("skips and warns when the sender is unrecognized", () => {
    const meta = { outreach_message: "Hi there...", outreach_message_sender: "intern" };
    const result = buildGeneratedMessagePlan(meta, SENDER_TO_ANGLE);
    expect(result.plan).toBeNull();
    expect(result.warning).toContain("intern");
  });

  it("returns null (no warning) when there is no outreach_message at all", () => {
    const result = buildGeneratedMessagePlan({}, SENDER_TO_ANGLE);
    expect(result.plan).toBeNull();
    expect(result.warning).toBeUndefined();
  });
});
