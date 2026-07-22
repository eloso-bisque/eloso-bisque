/**
 * Tests for POST /api/investors/pipeline-stage.
 *
 * Behavior under test: this route used to call Kissinger's
 * updatePipelineStage mutation, then dual-write the same value into
 * Postgres. Kissinger has been removed from the live path — Postgres
 * (Organization.investorPipeline) is now the sole write.
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

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/investors/pipeline-stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/investors/pipeline-stage", () => {
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

  it("updates the pipeline stage in Postgres and never calls the network", async () => {
    orgFindUniqueMock.mockResolvedValue({ id: "pg-org-1" });
    orgUpdateMock.mockResolvedValue({});

    const res = await POST(
      makeRequest({ firmId: "kis-firm-1", stage: "Warm Intro" }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as { ok: boolean; stage: string };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.stage).toBe("Warm Intro");
    expect(orgUpdateMock).toHaveBeenCalledWith({
      where: { id: "pg-org-1" },
      data: { investorPipeline: "WarmIntro", investorPipelineUpdatedAt: expect.any(Date) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a real error when the firm does not exist in Postgres", async () => {
    orgFindUniqueMock.mockResolvedValue(null);

    const res = await POST(
      makeRequest({ firmId: "kis-firm-unknown", stage: "Warm Intro" }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
