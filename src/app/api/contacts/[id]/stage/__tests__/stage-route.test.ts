/**
 * Tests for PATCH /api/contacts/[id]/stage.
 *
 * Behavior under test: this route used to call Kissinger's
 * updateContactFunnelStage mutation, then dual-write the same value into
 * Postgres. Kissinger has been removed from the live path — Postgres
 * (Organization.funnelStage) is now the sole write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { PATCH } from "../route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/contacts/kis-org-1/stage", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/contacts/[id]/stage", () => {
  const originalFetch = global.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn().mockRejectedValue(new Error("network calls are not allowed in this test"));
    global.fetch = fetchSpy as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("updates the funnel stage in Postgres and never calls the network", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
    orgUpdateMock.mockResolvedValue({});

    const res = await PATCH(
      makeRequest({ stage: "Meeting Booked" }) as unknown as Parameters<typeof PATCH>[0],
      ctx("kis-org-1")
    );
    const json = (await res.json()) as { id: string; stage: string };

    expect(res.status).toBe(200);
    expect(json.stage).toBe("Meeting Booked");
    expect(orgUpdateMock).toHaveBeenCalledWith({
      where: { id: "pg-org-1" },
      data: { funnelStage: "MeetingBooked", funnelStageUpdatedAt: expect.any(Date) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid stage label before touching Postgres", async () => {
    const res = await PATCH(
      makeRequest({ stage: "Not A Real Stage" }) as unknown as Parameters<typeof PATCH>[0],
      ctx("kis-org-1")
    );

    expect(res.status).toBe(400);
    expect(orgUpdateMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a real error when the org does not exist in Postgres", async () => {
    orgFindUniqueMock.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest({ stage: "Contacted" }) as unknown as Parameters<typeof PATCH>[0],
      ctx("kis-org-unknown")
    );

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
