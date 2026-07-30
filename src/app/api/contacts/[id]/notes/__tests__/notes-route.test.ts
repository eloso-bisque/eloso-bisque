/**
 * Tests for PATCH /api/contacts/[id]/notes.
 *
 * Behavior under test: this route used to call Kissinger's updateEntity
 * mutation to write notes, then dual-write the same value into Postgres.
 * Kissinger has been removed from the live path — Postgres is the sole
 * write, and a failure there now surfaces as a real error (never silently
 * swallowed the way dual-write instrumentation used to be).
 *
 * Also covers a regression found 2026-07-30: revalidateTag used to be
 * called inside the same try/catch as the Postgres write, so a
 * revalidation hiccup would report a failed update even though the notes
 * had already been saved — a false negative that could prompt a pointless
 * retry. revalidateTag is now called after the write's try/catch, wrapped
 * in its own non-fatal try/catch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contactUpdateManyMock = vi.fn();
const organizationUpdateManyMock = vi.fn();
const revalidateTagMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { updateMany: (...args: unknown[]) => contactUpdateManyMock(...args) },
    organization: { updateMany: (...args: unknown[]) => organizationUpdateManyMock(...args) },
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTagMock(...args) }));

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
    revalidateTagMock.mockReset();
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

  it("still reports success when the Postgres write succeeds but cache revalidation throws", async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 1 });
    revalidateTagMock.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag");
    });

    const res = await PATCH(
      makeRequest({ notes: "Met at conference" }) as unknown as Parameters<typeof PATCH>[0],
      ctx("kis-1")
    );
    const json = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});
