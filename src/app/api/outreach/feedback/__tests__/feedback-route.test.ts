/**
 * Tests for POST /api/outreach/feedback.
 *
 * Behavior under test: this route's Kissinger entity-meta write remains the
 * operation of record (the Outreach subsystem is one of the pieces
 * deliberately left on Kissinger by the PR #53 disconnect — see the route's
 * doc comment). This is a genuine DUAL write, not a cutover: every request
 * must still perform the existing Kissinger meta write (and its best-effort
 * ContactEvent write) AND now also create a first-class Postgres
 * `OutreachFeedback` row via `dualWriteOutreachFeedback`. A Postgres failure
 * must never fail the request or block the Kissinger write — same
 * never-throw contract as every other dual-write helper in the codebase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dualWriteOutreachFeedbackMock = vi.fn();
vi.mock("@/lib/outreach-dual-write", () => ({
  dualWriteOutreachFeedback: (...args: unknown[]) => dualWriteOutreachFeedbackMock(...args),
}));

const verifyTokenMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
}));

import { POST } from "../route";

function makeRequest(options: { body: Record<string, unknown>; cookie?: string }): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.cookie) headers["cookie"] = options.cookie;
  return new Request("http://localhost/api/outreach/feedback", {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
  });
}

describe("POST /api/outreach/feedback", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    dualWriteOutreachFeedbackMock.mockResolvedValue(undefined);

    // Generic Kissinger GraphQL responder: the meta query needs to return an
    // `entity.meta` array (gqlMutate reads entityData.entity.meta); the
    // update mutation and contact-event mutation responses aren't read by
    // the route, so an empty `data` object is enough for those.
    fetchSpy = vi.fn(async (_url: string, opts: { body: string }) => {
      const parsed = JSON.parse(opts.body) as { query: string };
      if (parsed.query.includes("query EntityMeta")) {
        return {
          ok: true,
          json: async () => ({ data: { entity: { meta: [] } } }),
        };
      }
      return { ok: true, json: async () => ({ data: {} }) };
    });
    global.fetch = fetchSpy as unknown as typeof global.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dual-writes an OutreachFeedback row while still performing the Kissinger meta write", async () => {
    verifyTokenMock.mockResolvedValue({ email: "ben@eloso.ai", name: "Ben", sub: "usr_ben" });

    const res = await POST(
      makeRequest({
        body: { entityId: "kis-42", thumb: "up", text: "great fit" },
        cookie: "eloso_session=valid-jwt-token",
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    // Postgres dual-write happened, attributed to the resolved session user.
    expect(dualWriteOutreachFeedbackMock).toHaveBeenCalledWith({
      kissingerContactId: "kis-42",
      thumb: "up",
      text: "great fit",
      assigneeLower: "ben",
    });

    // Kissinger remains the write of record — its meta-update mutation must
    // still fire (this is additive, not a replacement).
    const updateCall = fetchSpy.mock.calls.find((call) =>
      JSON.parse((call[1] as { body: string }).body).query.includes("mutation UpdateEntityMeta")
    );
    expect(updateCall).toBeDefined();
    const updateVars = JSON.parse((updateCall![1] as { body: string }).body).variables;
    expect(updateVars.id).toBe("kis-42");
    expect(updateVars.input.meta).toEqual(
      expect.arrayContaining([{ key: "feedback_thumb", value: "up" }])
    );
  });

  it("still returns ok:true and still performs the Kissinger write when the Postgres dual-write fails", async () => {
    verifyTokenMock.mockResolvedValue({ email: "jake@eloso.ai", name: "Jake", sub: "usr_jake" });
    dualWriteOutreachFeedbackMock.mockRejectedValue(new Error("Postgres unreachable"));

    const res = await POST(
      makeRequest({
        body: { entityId: "kis-7", thumb: "down" },
        cookie: "eloso_session=valid-jwt-token",
      }) as unknown as Parameters<typeof POST>[0]
    );
    const json = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(dualWriteOutreachFeedbackMock).toHaveBeenCalled();

    const updateCall = fetchSpy.mock.calls.find((call) =>
      JSON.parse((call[1] as { body: string }).body).query.includes("mutation UpdateEntityMeta")
    );
    expect(updateCall).toBeDefined();
  });

  it("attributes loggedBy=null for an internal-secret call with no session", async () => {
    const originalSecret = process.env.LOBSTER_INTERNAL_SECRET;
    process.env.LOBSTER_INTERNAL_SECRET = "shh";

    const req = new Request("http://localhost/api/outreach/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": "shh" },
      body: JSON.stringify({ entityId: "kis-99", thumb: "up" }),
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);

    expect(dualWriteOutreachFeedbackMock).toHaveBeenCalledWith({
      kissingerContactId: "kis-99",
      thumb: "up",
      text: undefined,
      assigneeLower: null,
    });
    expect(verifyTokenMock).not.toHaveBeenCalled();

    process.env.LOBSTER_INTERNAL_SECRET = originalSecret;
  });

  it("attributes loggedBy=null when the session email doesn't map to a known team member", async () => {
    verifyTokenMock.mockResolvedValue({ email: "someone-else@example.com", name: "X", sub: "usr_x" });

    const res = await POST(
      makeRequest({
        body: { entityId: "kis-1", thumb: "up" },
        cookie: "eloso_session=valid-jwt-token",
      }) as unknown as Parameters<typeof POST>[0]
    );

    expect(res.status).toBe(200);
    expect(dualWriteOutreachFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeLower: null })
    );
  });
});
