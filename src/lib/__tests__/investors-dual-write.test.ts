/**
 * Tests for the Investors pipeline-stage dual-write helper (Prisma Phase 3.5,
 * GH #45).
 *
 * Behavior under test (from GH #45's dual-write requirement — POST
 * /api/investors/pipeline-stage currently only calls Kissinger's
 * `updatePipelineStage(firmId, stage)`, which writes `meta.pipeline_stage`;
 * this must ALSO update `Organization.investorPipeline` +
 * `investorPipelineUpdatedAt` in Postgres, looked up via `kissingerId`, per
 * the exact dual-write pattern established in outreach-dual-write.ts
 * (GH #43)):
 *
 *   - Resolves the firm by `kissingerId` and updates `investorPipeline` to
 *     the enum value matching the UI stage label ("Warm Intro" -> WarmIntro).
 *   - Also stamps `investorPipelineUpdatedAt` with the current time.
 *   - An unrecognized stage label is skipped (logged), never guessed into a
 *     default enum value or allowed to throw.
 *   - A firm not yet backfilled into Postgres (no matching kissingerId) is
 *     skipped (logged), never treated as an error.
 *   - A Postgres outage/error during the update is caught and logged —
 *     dual-write helpers must NEVER throw, since Kissinger remains the
 *     write of record during this phase and must not be blocked by this
 *     instrumentation (same contract as every dualWrite* function in
 *     outreach-dual-write.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const orgFindUniqueMock = vi.fn();
const orgUpdateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: (...args: unknown[]) => orgFindUniqueMock(...args),
      update: (...args: unknown[]) => orgUpdateMock(...args),
    },
  },
}));

import { dualWriteInvestorPipelineStage } from "@/lib/investors-dual-write";

function resetAllMocks() {
  [orgFindUniqueMock, orgUpdateMock].forEach((m) => m.mockReset());
}

describe("dualWriteInvestorPipelineStage", () => {
  beforeEach(resetAllMocks);

  it("resolves the firm by kissingerId and updates investorPipeline to the matching enum value", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
    orgUpdateMock.mockResolvedValue({});

    await dualWriteInvestorPipelineStage({ kissingerFirmId: "kis-firm-1", stageLabel: "Warm Intro" });

    expect(orgFindUniqueMock).toHaveBeenCalledWith({
      where: { kissingerId: "kis-firm-1" },
      select: { id: true },
    });
    expect(orgUpdateMock).toHaveBeenCalledTimes(1);
    const call = orgUpdateMock.mock.calls[0][0];
    expect(call.where).toEqual({ id: "pg-org-1" });
    expect(call.data.investorPipeline).toBe("WarmIntro");
    expect(call.data.investorPipelineUpdatedAt).toBeInstanceOf(Date);
  });

  it("maps every UI stage label to its correct enum value", async () => {
    const cases: [string, string][] = [
      ["Research", "Research"],
      ["Warm Intro", "WarmIntro"],
      ["First Meeting", "FirstMeeting"],
      ["Partner Meeting", "PartnerMeeting"],
      ["Term Sheet", "TermSheet"],
      ["Closed", "Closed"],
      ["Passed", "Passed"],
    ];
    for (const [label, enumValue] of cases) {
      orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
      orgUpdateMock.mockResolvedValue({});
      await dualWriteInvestorPipelineStage({ kissingerFirmId: "kis-firm-1", stageLabel: label });
      const call = orgUpdateMock.mock.calls.at(-1)![0];
      expect(call.data.investorPipeline).toBe(enumValue);
    }
  });

  it("skips the write (never throws) for an unrecognized stage label", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });

    await expect(
      dualWriteInvestorPipelineStage({ kissingerFirmId: "kis-firm-1", stageLabel: "Not A Real Stage" })
    ).resolves.toBeUndefined();
    expect(orgUpdateMock).not.toHaveBeenCalled();
  });

  it("skips the write (never throws) when the firm hasn't been backfilled into Postgres yet", async () => {
    orgFindUniqueMock.mockResolvedValue(null);

    await expect(
      dualWriteInvestorPipelineStage({ kissingerFirmId: "kis-firm-unknown", stageLabel: "Warm Intro" })
    ).resolves.toBeUndefined();
    expect(orgUpdateMock).not.toHaveBeenCalled();
  });

  it("never throws when the Postgres lookup fails", async () => {
    orgFindUniqueMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      dualWriteInvestorPipelineStage({ kissingerFirmId: "kis-firm-1", stageLabel: "Warm Intro" })
    ).resolves.toBeUndefined();
    expect(orgUpdateMock).not.toHaveBeenCalled();
  });

  it("never throws when the Postgres update fails", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
    orgUpdateMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      dualWriteInvestorPipelineStage({ kissingerFirmId: "kis-firm-1", stageLabel: "Warm Intro" })
    ).resolves.toBeUndefined();
  });
});
