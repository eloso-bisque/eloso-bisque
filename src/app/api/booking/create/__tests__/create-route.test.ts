/**
 * Tests for POST /api/booking/create.
 *
 * Behavior under test: this route used to fire-and-forget a Kissinger sync
 * (syncBookingToKissinger + setKissingerContactId) alongside creating the
 * booking in Postgres/SQLite. Booking has always been fully self-contained
 * (Postgres/SQLite is the actual source of truth; Kissinger sync was pure
 * best-effort mirroring), so that call has been removed — this proves a
 * booking still creates successfully and that Kissinger is never touched,
 * even when KISSINGER_GRAPHQL_URL is configured (which used to be exactly
 * the condition that turned the sync on).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { closeDb } from "@/lib/db/client";

process.env.BOOKING_DB_PATH = ":memory:";
process.env.EMAIL_PROVIDER = "none";
// Set on purpose: this used to be the flag that turned Kissinger sync on.
// If the sync call were still wired into the route, this would trigger a
// real network request our fetch spy below would catch.
process.env.KISSINGER_GRAPHQL_URL = "http://localhost:9/graphql";

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/booking/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Finds a UTC instant that lands on a weekday, comfortably inside the
 * default AvailabilityConfig's Mon-Fri / 09:00-17:00 America/New_York
 * working hours, at least a few days out (safely past the 2-hour
 * min_notice_hours default). Avoids hardcoding a date that might land on a
 * weekend depending on when the test suite runs.
 */
function findValidBookingSlotUtc(): Date {
  for (let daysAhead = 3; daysAhead < 14; daysAhead++) {
    const candidate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
    candidate.setUTCHours(16, 0, 0, 0); // 16:00 UTC ~= 11-12am America/New_York
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const weekday = local.find((p) => p.type === "weekday")?.value;
    const hour = Number(local.find((p) => p.type === "hour")?.value);
    if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday ?? "") && hour >= 9 && hour <= 16) {
      return candidate;
    }
  }
  throw new Error("Could not find a valid booking slot for the test — check AvailabilityConfig defaults");
}

describe("POST /api/booking/create", () => {
  const originalFetch = global.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockRejectedValue(new Error("network calls are not allowed in this test"));
    global.fetch = fetchSpy as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    closeDb();
  });

  it("creates a booking and never calls Kissinger, even with KISSINGER_GRAPHQL_URL set", async () => {
    const start = findValidBookingSlotUtc();

    const res = await POST(
      makeRequest({
        guest_name: "Ada Lovelace",
        guest_email: "ada@example.com",
        guest_notes: "Looking forward to it",
        start_utc: start.toISOString(),
        timezone: "America/New_York",
      }) as unknown as Parameters<typeof POST>[0]
    );

    const json = (await res.json()) as { ok?: boolean; booking_id?: string; error?: string };

    expect(json.error).toBeUndefined();
    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.booking_id).toBeTruthy();

    // The strongest proof: no Kissinger (or any other) network call happened.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
