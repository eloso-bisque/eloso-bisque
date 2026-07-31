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
const contactFindFirstMock = vi.fn();
const organizationCreateMock = vi.fn();
const revalidateTagMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      create: (...args: unknown[]) => contactCreateMock(...args),
      findFirst: (...args: unknown[]) => contactFindFirstMock(...args),
    },
    organization: { create: (...args: unknown[]) => organizationCreateMock(...args) },
  },
}));

vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTagMock(...args) }));

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
    contactFindFirstMock.mockResolvedValue(null); // no duplicate by default
    revalidateTagMock.mockReset();
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

  it("still reports the accurate created count when cache revalidation throws", async () => {
    revalidateTagMock.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag");
    });

    const res = await POST(
      makeRequest({
        contacts: [{ name: "Alice" }, { name: "Bob" }],
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as BulkCreateResult;

    expect(res.status).toBe(200);
    expect(json.created).toBe(2);
    expect(json.errors).toHaveLength(0);
  });

  it("skips a row whose email already exists in Postgres, tracked as an error not a crash", async () => {
    contactFindFirstMock.mockResolvedValueOnce({ id: "c-existing", name: "Alice Existing" });

    const res = await POST(
      makeRequest({
        contacts: [
          { name: "Alice", email: "alice@example.com" },
          { name: "Bob", email: "bob@example.com" },
        ],
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as BulkCreateResult;

    expect(json.created).toBe(1);
    expect(contactCreateMock).toHaveBeenCalledTimes(1);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].name).toBe("Alice");
    expect(json.errors[0].reason).toMatch(/already exists/i);
  });

  it("catches two rows in the same batch sharing an email, without a Postgres round trip for the second", async () => {
    const res = await POST(
      makeRequest({
        contacts: [
          { name: "Alice", email: "dupe@example.com" },
          { name: "Alice Duplicate", email: "dupe@example.com" },
        ],
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as BulkCreateResult;

    expect(json.created).toBe(1);
    expect(contactCreateMock).toHaveBeenCalledTimes(1);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].name).toBe("Alice Duplicate");
    expect(json.errors[0].reason).toMatch(/duplicate email within this batch/i);
  });

  it("passes a row's linkedinUrl through to the Contact create call", async () => {
    // Regression test for the linkedin_url bulk-import gap: ParsedContact
    // previously had no linkedinUrl field at all, so bulk-imported contacts
    // could never get one, unlike single-add (POST /api/contacts/create),
    // which has always accepted a LinkedIn URL.
    await POST(
      makeRequest({
        contacts: [
          {
            name: "Alice",
            email: "alice@example.com",
            linkedinUrl: "https://linkedin.com/in/alice",
          },
        ],
      }) as unknown as Parameters<typeof POST>[0]
    );

    const call = contactCreateMock.mock.calls[0][0] as {
      data: { linkedinUrl: string | null };
    };
    expect(call.data.linkedinUrl).toBe("https://linkedin.com/in/alice");
  });

  it("sets linkedinUrl to null when a row has none", async () => {
    await POST(
      makeRequest({ contacts: [{ name: "Alice" }] }) as unknown as Parameters<typeof POST>[0]
    );

    const call = contactCreateMock.mock.calls[0][0] as {
      data: { linkedinUrl: string | null };
    };
    expect(call.data.linkedinUrl).toBeNull();
  });

  it("does not run the duplicate check for rows with no email", async () => {
    const res = await POST(
      makeRequest({ contacts: [{ name: "Alice" }] }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as BulkCreateResult;

    expect(json.created).toBe(1);
    expect(contactFindFirstMock).not.toHaveBeenCalled();
  });
});
