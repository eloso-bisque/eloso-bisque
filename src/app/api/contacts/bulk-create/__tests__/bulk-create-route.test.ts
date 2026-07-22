/**
 * Tests for POST /api/contacts/bulk-create.
 *
 * Behavior under test: this route used to call Kissinger's createEntity
 * mutation once per row to mint each contact's id, then dual-write the same
 * row into Postgres. Kissinger has been removed from the live path — each
 * row now self-mints a stable external id and Postgres is the sole write.
 *
 *   - Creates every valid row in Postgres and never calls the network.
 *   - A per-row Postgres failure is tracked in `errors` and the loop
 *     continues (matches the pre-cutover per-row error handling contract).
 *   - The free-text "organization" column (previously Kissinger-meta-only)
 *     is folded into notes instead of silently dropped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contactCreateMock = vi.fn();
const organizationCreateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { create: (...args: unknown[]) => contactCreateMock(...args) },
    organization: { create: (...args: unknown[]) => organizationCreateMock(...args) },
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "../route";
import type { BulkCreateResult } from "../route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/contacts/bulk-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contacts/bulk-create", () => {
  const originalFetch = global.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn().mockRejectedValue(new Error("network calls are not allowed in this test"));
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    contactCreateMock.mockResolvedValue({ id: "pg-1" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("creates every row in Postgres and never calls the network", async () => {
    const res = await POST(
      makeRequest({
        contacts: [
          { name: "Alice", email: "alice@example.com" },
          { name: "Bob", email: "bob@example.com" },
        ],
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as BulkCreateResult;

    expect(json.created).toBe(2);
    expect(json.errors).toHaveLength(0);
    expect(contactCreateMock).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("folds each row's organization field into notes", async () => {
    await POST(
      makeRequest({
        contacts: [{ name: "Alice", organization: "Acme Corp" }],
      }) as unknown as Parameters<typeof POST>[0]
    );

    const call = contactCreateMock.mock.calls[0][0] as { data: { notes: string | null } };
    expect(call.data.notes).toBe("Company: Acme Corp");
  });

  it("tracks a per-row Postgres failure and continues the loop", async () => {
    contactCreateMock
      .mockResolvedValueOnce({ id: "pg-1" })
      .mockRejectedValueOnce(new Error("unique constraint"))
      .mockResolvedValueOnce({ id: "pg-3" });

    const res = await POST(
      makeRequest({
        contacts: [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }],
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as BulkCreateResult;

    expect(json.created).toBe(2);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].name).toBe("Bob");
    expect(json.errors[0].reason).toMatch(/unique constraint/);
  });
});
