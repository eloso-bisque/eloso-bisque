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
 *   - A cache-revalidation failure (revalidateTag throwing) must NOT surface
 *     as a false error response — the Postgres write already succeeded by
 *     that point, so reporting failure would risk the caller retrying and
 *     creating a duplicate. Regression test for a real bug found 2026-07-30:
 *     revalidateTag was originally called inside the same try/catch as the
 *     write, so any revalidation hiccup masqueraded as a failed create even
 *     though the row was already persisted.
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
    contactFindFirstMock.mockResolvedValue(null); // no duplicate by default
    revalidateTagMock.mockReset();
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

  it("still reports success when the Postgres write succeeds but cache revalidation throws", async () => {
    revalidateTagMock.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag");
    });

    const res = await POST(
      makeRequest({ name: "Erle Shepard", kind: "person" }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as { ok: boolean; entity: { id: string; name: string } };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.entity.name).toBe("Erle Shepard");
    expect(contactCreateMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate email with 409 instead of creating a second contact", async () => {
    contactFindFirstMock.mockResolvedValue({ id: "c-existing", name: "Erle Shepard (existing)" });

    const res = await POST(
      makeRequest({ name: "Erle Shepard", email: "erle@x.com", kind: "person" }) as unknown as Parameters<
        typeof POST
      >[0]
    );
    const json = (await res.json()) as { error: string; existingContactId: string };

    expect(res.status).toBe(409);
    expect(json.error).toMatch(/already exists/i);
    expect(json.existingContactId).toBe("c-existing");
    expect(contactCreateMock).not.toHaveBeenCalled();
  });

  it("does not run the duplicate check for org entities (no email column)", async () => {
    const res = await POST(
      makeRequest({ name: "Acme Corp", kind: "org" }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(200);
    expect(contactFindFirstMock).not.toHaveBeenCalled();
    expect(organizationCreateMock).toHaveBeenCalledTimes(1);
  });
});
