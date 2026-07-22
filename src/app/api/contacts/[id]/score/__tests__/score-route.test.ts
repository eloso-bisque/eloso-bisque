/**
 * Tests for GET /api/contacts/[id]/score.
 *
 * Behavior under test: this route used to make its own Kissinger
 * edgesFrom/interactionsForEntity/entity-tags round-trips. It now reuses
 * fetchContactDetailFromPostgres() (already built for the contact detail
 * page, GH #46) — Kissinger is never called from this route.
 *
 *   - Returns a score + breakdown for a contact found in Postgres.
 *   - Never calls the network (no Kissinger GraphQL request), proving the
 *     live-path disconnect actually took effect for this route.
 *   - Returns 404 when the contact isn't found in Postgres.
 *   - Returns 500 (with no unhandled rejection) when the Postgres lookup throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchContactDetailFromPostgresMock = vi.fn();

vi.mock("@/lib/contact-detail-read", () => ({
  fetchContactDetailFromPostgres: (...args: unknown[]) => fetchContactDetailFromPostgresMock(...args),
}));

import { GET } from "../route";

function makeRequest(id: string) {
  return {
    req: {} as never,
    ctx: { params: Promise.resolve({ id }) },
  };
}

describe("GET /api/contacts/[id]/score", () => {
  const originalFetch = global.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Any accidental Kissinger call would go through global fetch — spy on
    // it so we can assert it was never invoked by this route.
    fetchSpy = vi.fn().mockRejectedValue(new Error("network calls are not allowed in this test"));
    global.fetch = fetchSpy as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("scores a contact from Postgres data and never touches the network", async () => {
    fetchContactDetailFromPostgresMock.mockResolvedValue({
      contact: {
        id: "kis-1",
        kind: "person",
        name: "Erle Shepard",
        tags: [],
        notes: "",
        meta: [{ key: "title", value: "VP Supply Chain" }],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archived: false,
      },
      edges: [],
      peopleAtOrg: [],
      mostRecentInteractionAt: null,
      orgTagsByKissingerId: {},
    });

    const { req, ctx } = makeRequest("kis-1");
    const res = await GET(req, ctx);
    const json = (await res.json()) as { contact_id: string; score: number; breakdown: unknown };

    expect(res.status).toBe(200);
    expect(json.contact_id).toBe("kis-1");
    expect(typeof json.score).toBe("number");
    expect(json.breakdown).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when the contact is not found in Postgres", async () => {
    fetchContactDetailFromPostgresMock.mockResolvedValue(null);

    const { req, ctx } = makeRequest("kis-unknown");
    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 500 when the Postgres lookup throws", async () => {
    fetchContactDetailFromPostgresMock.mockRejectedValue(new Error("connection refused"));

    const { req, ctx } = makeRequest("kis-1");
    const res = await GET(req, ctx);
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(json.error).toMatch(/Failed to score contact/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
