/**
 * Tests for the Funnel stage dual-write helper (Prisma Phase 3.6, GH #46).
 *
 * Behavior under test (from GH #46's dual-write requirement — PATCH
 * /api/contacts/[id]/stage currently only calls Kissinger's
 * `updateContactFunnelStage(id, stage)`; this must ALSO update
 * `Organization.funnelStage` + `funnelStageUpdatedAt` in Postgres, looked
 * up via `kissingerId`, per the exact dual-write pattern established in
 * outreach-dual-write.ts (GH #43) and investors-dual-write.ts (GH #45)):
 *
 *   - Resolves the org by `kissingerId` and updates `funnelStage` to the
 *     enum value matching the UI stage label ("Meeting Booked" ->
 *     MeetingBooked).
 *   - Also stamps `funnelStageUpdatedAt` with the current time.
 *   - An unrecognized stage label throws — never guessed into a default
 *     enum value.
 *   - An org with no matching kissingerId throws.
 *   - Since Kissinger has been disconnected from this route's live path,
 *     Postgres is the sole write of record — a Postgres outage during the
 *     lookup or update must throw so the caller (PATCH
 *     /api/contacts/[id]/stage) can surface a real error instead of
 *     silently no-op'ing.
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

import { dualWriteFunnelStage } from "../funnel-dual-write";

function resetAllMocks() {
  [orgFindUniqueMock, orgUpdateMock].forEach((m) => m.mockReset());
}

describe("dualWriteFunnelStage", () => {
  beforeEach(resetAllMocks);

  it("resolves the org by kissingerId and updates funnelStage to the matching enum value", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
    orgUpdateMock.mockResolvedValue({});

    await dualWriteFunnelStage({ kissingerOrgId: "kis-org-1", stageLabel: "Meeting Booked" });

    expect(orgFindUniqueMock).toHaveBeenCalledWith({
      where: { kissingerId: "kis-org-1" },
      select: { id: true },
    });
    expect(orgUpdateMock).toHaveBeenCalledTimes(1);
    const call = orgUpdateMock.mock.calls[0][0];
    expect(call.where).toEqual({ id: "pg-org-1" });
    expect(call.data.funnelStage).toBe("MeetingBooked");
    expect(call.data.funnelStageUpdatedAt).toBeInstanceOf(Date);
  });

  it("maps every UI stage label to its correct enum value", async () => {
    const cases: [string, string][] = [
      ["Identified", "Identified"],
      ["Researched", "Researched"],
      ["Contacted", "Contacted"],
      ["Engaged", "Engaged"],
      ["Meeting Booked", "MeetingBooked"],
      ["Proposal Sent", "ProposalSent"],
      ["Closed / Nurture", "ClosedNurture"],
    ];
    for (const [label, enumValue] of cases) {
      orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
      orgUpdateMock.mockResolvedValue({});
      await dualWriteFunnelStage({ kissingerOrgId: "kis-org-1", stageLabel: label });
      const call = orgUpdateMock.mock.calls.at(-1)![0];
      expect(call.data.funnelStage).toBe(enumValue);
    }
  });

  it("throws for an unrecognized stage label", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });

    await expect(
      dualWriteFunnelStage({ kissingerOrgId: "kis-org-1", stageLabel: "Not A Real Stage" })
    ).rejects.toThrow();
    expect(orgUpdateMock).not.toHaveBeenCalled();
  });

  it("throws when the org does not exist in Postgres", async () => {
    orgFindUniqueMock.mockResolvedValue(null);

    await expect(
      dualWriteFunnelStage({ kissingerOrgId: "kis-org-unknown", stageLabel: "Contacted" })
    ).rejects.toThrow();
    expect(orgUpdateMock).not.toHaveBeenCalled();
  });

  it("throws when the Postgres lookup fails", async () => {
    orgFindUniqueMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      dualWriteFunnelStage({ kissingerOrgId: "kis-org-1", stageLabel: "Contacted" })
    ).rejects.toThrow("connection refused");
    expect(orgUpdateMock).not.toHaveBeenCalled();
  });

  it("throws when the Postgres update fails", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
    orgUpdateMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      dualWriteFunnelStage({ kissingerOrgId: "kis-org-1", stageLabel: "Contacted" })
    ).rejects.toThrow("connection refused");
  });
});
