/**
 * Tests for the historical ActivityLog seed planning logic.
 *
 * Behavior under test (from the migration task description):
 *   - Each day's KV count expands into that many synthetic rows on that day.
 *   - The most recent Login row on the day matching KV's `last_login` is
 *     pinned to the exact KV timestamp (dashboard `last_login` must match).
 *   - KV's `last_login` has no expiry and can predate the entire seed window
 *     (e.g. a user who hasn't logged in for months) — that timestamp must
 *     still be represented as a standalone Login row so the cutover doesn't
 *     regress `last_login` to null, even though it falls outside the 7-day
 *     daily breakdown.
 *   - The all-time outreach total, minus what the daily buckets capture, is
 *     represented as an extra batch dated before the seed window (so it
 *     counts toward the all-time total without polluting the 7-day view).
 *   - Nothing is planned for dates not in `seedDates` — in particular, the
 *     caller is expected to exclude "today" to avoid double-counting
 *     against live dual-write, and this module must not silently seed it.
 */

import { describe, it, expect } from "vitest";
import {
  planSeedRows,
  groupSeedRowsByDateAndType,
  type KvActivitySnapshot,
} from "../activity-seed";

const baseSnapshot: KvActivitySnapshot = {
  email: "drew@eloso.ai",
  dailyLogins: {},
  dailyOutreachSent: {},
  lastLoginIso: null,
  totalOutreachSent: 0,
};

describe("planSeedRows", () => {
  it("expands a day's login count into that many Login rows on that date", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyLogins: { "2026-07-20": 3 },
    };

    const rows = planSeedRows(snapshot, ["2026-07-20"]);
    const logins = rows.filter((r) => r.eventType === "Login");

    expect(logins).toHaveLength(3);
    for (const row of logins) {
      expect(row.createdAt.toISOString().startsWith("2026-07-20")).toBe(true);
      expect(row.email).toBe("drew@eloso.ai");
    }
    // distinct timestamps (not all identical) so ordering/spread is meaningful
    const uniqueTimestamps = new Set(logins.map((r) => r.createdAt.getTime()));
    expect(uniqueTimestamps.size).toBe(3);
  });

  it("expands a day's outreach-sent count into that many OutreachTouchSent rows", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyOutreachSent: { "2026-07-20": 2 },
    };

    const rows = planSeedRows(snapshot, ["2026-07-20"]);
    expect(rows.filter((r) => r.eventType === "OutreachTouchSent")).toHaveLength(2);
  });

  it("pins the last login row on its day to the exact KV last_login timestamp", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyLogins: { "2026-07-20": 2 },
      lastLoginIso: "2026-07-20T15:42:07.123Z",
    };

    const rows = planSeedRows(snapshot, ["2026-07-20"]);
    const logins = rows
      .filter((r) => r.eventType === "Login")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    expect(logins).toHaveLength(2); // no extra standalone row — already captured by the day count
    expect(logins[logins.length - 1].createdAt.toISOString()).toBe("2026-07-20T15:42:07.123Z");
  });

  it("does not add a standalone last_login row when it falls on/after 'today' (live dual-write's job)", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyLogins: { "2026-07-20": 1 },
      lastLoginIso: "2026-07-21T09:00:00.000Z", // "today" — outside the seeded window, excluded on purpose
    };

    const rows = planSeedRows(snapshot, ["2026-07-20"]);
    const logins = rows.filter((r) => r.eventType === "Login");
    expect(logins).toHaveLength(1);
    expect(logins[0].createdAt.toISOString().startsWith("2026-07-20")).toBe(true);
    expect(logins[0].createdAt.toISOString()).not.toBe("2026-07-21T09:00:00.000Z");
  });

  it("adds a standalone Login row when last_login predates the entire seed window", () => {
    // Realistic case: KV's last_login has no expiry and can be much older
    // than the 7-day daily counters (which expire after 90 days but may
    // simply have no recent activity). Without this, the dashboard would
    // regress last_login to null after cutover.
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyLogins: {}, // no recent activity at all
      lastLoginIso: "2026-05-12T19:16:47.562Z",
    };

    const rows = planSeedRows(snapshot, ["2026-07-16", "2026-07-17", "2026-07-18"]);
    const logins = rows.filter((r) => r.eventType === "Login");

    expect(logins).toHaveLength(1);
    expect(logins[0].createdAt.toISOString()).toBe("2026-05-12T19:16:47.562Z");
  });

  it("does not duplicate the standalone last_login row when that day's count is already captured", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyLogins: { "2026-07-17": 1 },
      lastLoginIso: "2026-07-17T08:00:00.000Z",
    };

    const rows = planSeedRows(snapshot, ["2026-07-16", "2026-07-17", "2026-07-18"]);
    expect(rows.filter((r) => r.eventType === "Login")).toHaveLength(1);
  });

  it("does not plan any rows for dates outside seedDates (caller excludes 'today')", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyLogins: { "2026-07-20": 1, "2026-07-22": 5 }, // 07-22 = "today", not in seedDates
    };

    const rows = planSeedRows(snapshot, ["2026-07-20"]);
    expect(rows.filter((r) => r.eventType === "Login")).toHaveLength(1);
  });

  it("represents the all-time outreach remainder as a batch dated before the seed window", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyOutreachSent: { "2026-07-20": 2, "2026-07-21": 1 }, // 3 captured in the window
      totalOutreachSent: 10, // 7 more predate the window
    };

    const rows = planSeedRows(snapshot, ["2026-07-20", "2026-07-21"]);
    const outreachRows = rows.filter((r) => r.eventType === "OutreachTouchSent");
    expect(outreachRows).toHaveLength(10);

    const olderRows = outreachRows.filter(
      (r) => r.createdAt.toISOString().split("T")[0] === "2026-07-19"
    );
    expect(olderRows).toHaveLength(7);
  });

  it("plans no remainder batch when the all-time total exactly matches the captured window", () => {
    const snapshot: KvActivitySnapshot = {
      ...baseSnapshot,
      dailyOutreachSent: { "2026-07-20": 4 },
      totalOutreachSent: 4,
    };

    const rows = planSeedRows(snapshot, ["2026-07-20"]);
    expect(rows.filter((r) => r.eventType === "OutreachTouchSent")).toHaveLength(4);
  });

  it("plans nothing for a user with all-zero KV counters", () => {
    const rows = planSeedRows(baseSnapshot, ["2026-07-20", "2026-07-21"]);
    expect(rows).toHaveLength(0);
  });
});

describe("groupSeedRowsByDateAndType", () => {
  it("groups rows by (UTC date, eventType) for batched idempotency checks", () => {
    const rows = planSeedRows(
      {
        ...baseSnapshot,
        dailyLogins: { "2026-07-20": 2 },
        dailyOutreachSent: { "2026-07-20": 1, "2026-07-21": 3 },
      },
      ["2026-07-20", "2026-07-21"]
    );

    const groups = groupSeedRowsByDateAndType(rows);
    expect(groups.get("2026-07-20|Login")).toHaveLength(2);
    expect(groups.get("2026-07-20|OutreachTouchSent")).toHaveLength(1);
    expect(groups.get("2026-07-21|OutreachTouchSent")).toHaveLength(3);
    expect(groups.has("2026-07-21|Login")).toBe(false);
  });
});
