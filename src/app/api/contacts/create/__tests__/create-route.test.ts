/**
 * Tests for POST /api/contacts/create.
 *
 * Behavior under test: this route used to call Kissinger's createEntity
 * mutation to mint the new contact's id, then dual-write the same row into
 * Postgres. Kissinger has been removed from the live path — the route now
 * self-mints a stable external id and Postgres is the sole write.
 *
 *   - Creates the contact in Postgres and never calls the network.
 *   - The free-text "organization" field (previously a Kissinger-only meta
 *     value with no Postgres column) is folded into notes instead of
 *     silently dropped.
 *   - linkedin_url is persisted onto Contact.linkedinUrl.
 *   - A Postgres failure surfaces as a real error response (not a false
 *     "ok: true"), since Postgres is now the operation of record.
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

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/contacts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/contacts/create", () => {
  const originalFetch = global.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY; // skip AI enrichment, use raw input
    fetchSpy = vi.fn().mockRejectedValue(new Error("network calls are not allowed in this test"));
    global.fetch = fetchSpy as unknown as typeof global.fetch;
    contactCreateMock.mockResolvedValue({ id: "pg-1" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("creates the contact in Postgres and never calls the network", async () => {
    const res = await POST(
      makeRequest({ name: "Erle Shepard", email: "erle@x.com", kind: "person" }) as unknown as Parameters<
        typeof POST
      >[0]
    );
    const json = (await res.json()) as { ok: boolean; entity: { id: string; name: string } };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.entity.name).toBe("Erle Shepard");
    expect(contactCreateMock).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("folds the free-text organization field into notes instead of dropping it", async () => {
    await POST(
      makeRequest({
        name: "Erle Shepard",
        email: "erle@x.com",
        organization: "Acme Corp",
        kind: "person",
      }) as unknown as Parameters<typeof POST>[0]
    );

    const call = contactCreateMock.mock.calls[0][0] as { data: { notes: string | null } };
    expect(call.data.notes).toBe("Company: Acme Corp");
  });

  it("persists linkedin_url onto Contact.linkedinUrl", async () => {
    await POST(
      makeRequest({
        name: "Erle Shepard",
        linkedin_url: "https://linkedin.com/in/erle",
        kind: "person",
      }) as unknown as Parameters<typeof POST>[0]
    );

    const call = contactCreateMock.mock.calls[0][0] as { data: { linkedinUrl: string | null } };
    expect(call.data.linkedinUrl).toBe("https://linkedin.com/in/erle");
  });

  it("returns a real error when the Postgres write fails, instead of a false success", async () => {
    contactCreateMock.mockRejectedValue(new Error("connection refused"));

    const res = await POST(
      makeRequest({ name: "Erle Shepard", kind: "person" }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as { error?: string; ok?: boolean };

    expect(res.status).toBe(500);
    expect(json.ok).toBeUndefined();
    expect(json.error).toBeTruthy();
  });
});
