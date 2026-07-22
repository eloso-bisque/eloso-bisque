/**
 * Tests for PATCH /api/contacts/[id]/notes.
 *
 * Behavior under test: this route used to call Kissinger's updateEntity
 * mutation to write notes, then dual-write the same value into Postgres.
 * Kissinger has been removed from the live path — Postgres is the sole
 * write, and a failure there now surfaces as a real error (never silently
 * swallowed the way dual-write instrumentation used to be).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contactUpdateManyMock = vi.fn();
const organizationUpdateManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { updateMany: (...args: unknown[]) => contactUpdateManyMock(...args) },
    organization: { updateMany: (...args: unknown[]) => organizationUpdateManyMock(...args) },
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { PATCH } from "../route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/contacts/kis-1/notes", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/contacts/[id]/notes", () => {
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

  it("updates notes in Postgres and never calls the network", async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 1 });

    const res = await PATCH(
      makeRequest({ notes: "Met at conference" }) as unknown as Parameters<typeof PATCH>[0],
      ctx("kis-1")
    );
    const json = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(contactUpdateManyMock).toHaveBeenCalledWith({
      where: { kissingerId: "kis-1" },
      data: { notes: "Met at conference" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a real error when neither Contact nor Organization has a matching row", async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 0 });
    organizationUpdateManyMock.mockResolvedValue({ count: 0 });

    const res = await PATCH(
      makeRequest({ notes: "x" }) as unknown as Parameters<typeof PATCH>[0],
      ctx("kis-unknown")
    );

    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
