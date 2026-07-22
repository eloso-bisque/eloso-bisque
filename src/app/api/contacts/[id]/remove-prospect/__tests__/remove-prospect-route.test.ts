/**
 * Tests for DELETE /api/contacts/[id]/remove-prospect.
 *
 * Behavior under test: this route used to fetch tags from Kissinger, update
 * them there, then dual-write the same change into Postgres. Kissinger has
 * been removed from the live path — Postgres (Contact.tags +
 * isProspectContact) is now the sole source and sole write.
 *
 *   - Removes the tag and never calls the network.
 *   - Idempotent when the tag isn't present (matches the pre-cutover contract).
 *   - Returns 404 when the contact doesn't exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contactFindUniqueMock = vi.fn();
const contactUpdateMock = vi.fn();
const contactTagDeleteManyMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findUnique: (...args: unknown[]) => contactFindUniqueMock(...args),
      update: (...args: unknown[]) => contactUpdateMock(...args),
    },
    contactTag: {
      deleteMany: (...args: unknown[]) => contactTagDeleteManyMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { DELETE } from "../route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/contacts/[id]/remove-prospect", () => {
  const originalFetch = global.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn().mockRejectedValue(new Error("network calls are not allowed in this test"));
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    transactionMock.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("removes the prospect-contact tag in Postgres and never calls the network", async () => {
    contactFindUniqueMock.mockResolvedValue({
      id: "pg-1",
      tags: [{ tag: "prospect-contact" }, { tag: "manufacturing" }],
    });

    const res = await DELETE({} as unknown as Parameters<typeof DELETE>[0], ctx("kis-1"));
    const json = (await res.json()) as { success: boolean; tags: string[] };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.tags).toEqual(["manufacturing"]);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is idempotent when the tag isn't present", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "pg-1", tags: [{ tag: "manufacturing" }] });

    const res = await DELETE({} as unknown as Parameters<typeof DELETE>[0], ctx("kis-1"));
    const json = (await res.json()) as { success: boolean; tags: string[] };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when the contact does not exist", async () => {
    contactFindUniqueMock.mockResolvedValue(null);

    const res = await DELETE({} as unknown as Parameters<typeof DELETE>[0], ctx("kis-unknown"));

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
