/**
 * Tests for GET/POST /api/contacts/[id]/events.
 *
 * Behavior under test: both directions of this route used to call
 * Kissinger's contactEventsForEntity query / createContactEvent mutation.
 * Kissinger has been removed from the live path — Postgres (ContactEvent)
 * is now the sole read/write, serving the regular Notes/Meetings/etc events
 * tab. Trigify signal data (previously read from this same endpoint) now
 * has its own dedicated route, GET /api/contacts/[id]/trigify-signals,
 * which intentionally still reads Kissinger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const contactFindUniqueMock = vi.fn();
const contactEventCreateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findUnique: (...args: unknown[]) => contactFindUniqueMock(...args),
    },
    contactEvent: {
      create: (...args: unknown[]) => contactEventCreateMock(...args),
    },
  },
}));

import { GET, POST } from "../route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePostRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/contacts/kis-1/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/POST /api/contacts/[id]/events", () => {
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

  it("GET lists events from Postgres and never calls the network", async () => {
    contactFindUniqueMock.mockResolvedValue({
      events: [
        {
          id: "evt-1",
          kind: "Meeting",
          notes: "Intro call",
          occurredAt: new Date("2026-07-20T00:00:00.000Z"),
          createdAt: new Date("2026-07-20T00:01:00.000Z"),
        },
      ],
    });

    const res = await GET({} as unknown as Parameters<typeof GET>[0], ctx("kis-1"));
    const json = (await res.json()) as { events: { id: string; kind: string }[] };

    expect(res.status).toBe(200);
    expect(json.events).toHaveLength(1);
    expect(json.events[0].kind).toBe("Meeting");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GET returns an empty list when the contact has no events", async () => {
    contactFindUniqueMock.mockResolvedValue({ events: [] });

    const res = await GET({} as unknown as Parameters<typeof GET>[0], ctx("kis-1"));
    const json = (await res.json()) as { events: unknown[] };

    expect(json.events).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POST creates an event in Postgres and never calls the network", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "pg-1" });
    contactEventCreateMock.mockResolvedValue({
      id: "evt-1",
      kind: "Meeting",
      notes: "Intro call",
      occurredAt: new Date("2026-07-20T00:00:00.000Z"),
      createdAt: new Date("2026-07-20T00:01:00.000Z"),
    });

    const res = await POST(
      makePostRequest({ kind: "Meeting", notes: "Intro call", occurredAt: "2026-07-20T00:00:00.000Z" }) as unknown as Parameters<
        typeof POST
      >[0],
      ctx("kis-1")
    );
    const json = (await res.json()) as { event: { id: string; kind: string; notes: string } };

    expect(res.status).toBe(201);
    expect(json.event.kind).toBe("Meeting");
    expect(json.event.notes).toBe("Intro call");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POST returns a real error when the contact does not exist in Postgres", async () => {
    contactFindUniqueMock.mockResolvedValue(null);

    const res = await POST(
      makePostRequest({ kind: "Note", notes: "x", occurredAt: "2026-07-20T00:00:00.000Z" }) as unknown as Parameters<
        typeof POST
      >[0],
      ctx("kis-unknown")
    );

    expect(res.status).toBe(500);
    expect(contactEventCreateMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
