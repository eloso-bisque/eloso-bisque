/**
 * Tests for the Postgres-backed Funnel Kanban read path (Prisma Phase 3.6,
 * GH #46).
 *
 * Behavior under test (from GH #46 + the real-prod-data investigation
 * recorded in funnel-read.ts's module doc):
 *
 *   - FunnelStage enum <-> UI label must round-trip losslessly, matching
 *     the exact 7 labels the legacy FUNNEL_STAGES constant (src/lib/
 *     kissinger.ts) already used ("Meeting Booked", "Proposal Sent",
 *     "Closed / Nurture" — note the spaces/slash, which do not match the
 *     PascalCase Prisma enum values directly).
 *   - Every column of FUNNEL_STAGE_ORDER must be present in the grouped
 *     board even when empty (the Kanban UI renders all 7 columns
 *     unconditionally).
 *   - A row without a kissingerId is dropped (never a dead link/broken
 *     PATCH target), matching the established contacts-read.ts contract.
 *   - An unrecognized stage label maps to null (not silently defaulted) —
 *     callers must treat that as "do not write."
 */

import { describe, it, expect } from "vitest";
import {
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGE_ORDER,
  funnelStageToLabel,
  funnelStageLabelToEnum,
  orgRowToFunnelCard,
  groupFunnelCardsByStage,
  type FunnelOrgRow,
} from "../funnel-read";

describe("funnel stage enum <-> label round-trip", () => {
  it("maps every enum value to the legacy FUNNEL_STAGES label exactly", () => {
    expect(FUNNEL_STAGE_LABELS).toEqual({
      Identified: "Identified",
      Researched: "Researched",
      Contacted: "Contacted",
      Engaged: "Engaged",
      MeetingBooked: "Meeting Booked",
      ProposalSent: "Proposal Sent",
      ClosedNurture: "Closed / Nurture",
    });
  });

  it("round-trips label -> enum -> label for every stage", () => {
    for (const stage of FUNNEL_STAGE_ORDER) {
      const label = funnelStageToLabel(stage);
      expect(funnelStageLabelToEnum(label)).toBe(stage);
    }
  });

  it("returns null (never a default) for an unrecognized label", () => {
    expect(funnelStageLabelToEnum("Not A Real Stage")).toBeNull();
  });

  it("defaults an out-of-range enum value defensively to Identified when converting to a label", () => {
    // @ts-expect-error deliberately invalid enum value to exercise the `?? "Identified"` fallback
    expect(funnelStageToLabel("SomethingElse")).toBe("Identified");
  });
});

describe("orgRowToFunnelCard", () => {
  const baseRow: FunnelOrgRow = {
    kissingerId: "kis-org-1",
    name: "Acme Corp",
    industry: "Aerospace",
    hq: "Austin, TX",
    tags: [{ tag: "defense" }],
    fitTier: "high",
    funnelStage: "Contacted",
    updatedAt: new Date("2026-03-01T00:00:00Z"),
  };

  it("maps a row to a FunnelOrgCard, preferring industry as the subtitle", () => {
    expect(orgRowToFunnelCard(baseRow)).toEqual({
      id: "kis-org-1",
      name: "Acme Corp",
      subtitle: "Aerospace",
      tags: ["defense"],
      fitTier: "high",
      funnelStage: "Contacted",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
  });

  it("falls back to hq for the subtitle when industry is absent", () => {
    const row = { ...baseRow, industry: null };
    expect(orgRowToFunnelCard(row)?.subtitle).toBe("Austin, TX");
  });

  it("returns null (dropped from the board) when the org has no kissingerId", () => {
    expect(orgRowToFunnelCard({ ...baseRow, kissingerId: null })).toBeNull();
  });
});

describe("groupFunnelCardsByStage", () => {
  it("includes every FUNNEL_STAGE_ORDER column, even when empty", () => {
    const board = groupFunnelCardsByStage([]);
    expect(Object.keys(board)).toEqual(FUNNEL_STAGE_ORDER.map(funnelStageToLabel));
    for (const key of Object.keys(board)) {
      expect(board[key]).toEqual([]);
    }
  });

  it("buckets each card under its funnelStage label", () => {
    const card = orgRowToFunnelCard({
      kissingerId: "kis-org-1",
      name: "Acme",
      industry: null,
      hq: null,
      tags: [],
      fitTier: null,
      funnelStage: "MeetingBooked",
      updatedAt: new Date(),
    })!;
    const board = groupFunnelCardsByStage([card]);
    expect(board["Meeting Booked"]).toEqual([card]);
    expect(board["Identified"]).toEqual([]);
  });
});
