/**
 * Tests for the Activity Dashboard read-path cutover (Prisma Phase 3.1).
 *
 * Behavior under test (from docs/prisma-schema-design.md section 3.7 and the
 * migration task description), not from the implementation:
 *   - `buildActivityDashboardResponse` (pure) shapes ActivityLog query rows
 *     into the same response shape the KV-backed route used to return.
 *   - Users with no matching Postgres row yet (userId=null) get all-zero
 *     stats rather than throwing — required because the Kissinger backfill
 *     that seeds Users runs in a separate, independently-sequenced task.
 *   - `resolveDashboardUsers` cross-checks the hardcoded roster against the
 *     real `User` table rather than assuming the hardcoded list is right.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: (...args: unknown[]) => findManyMock(...args) },
    $queryRaw: vi.fn(),
  },
}));

import {
  buildActivityDashboardResponse,
  getDates,
  resolveDashboardUsers,
  type DailyCountRow,
  type LastLoginRow,
  type TotalOutreachRow,
} from "@/lib/activity-dashboard";

describe("getDates", () => {
  it("returns `count` consecutive UTC dates ending today, oldest first", () => {
    const dates = getDates(7);
    expect(dates).toHaveLength(7);
    const today = new Date().toISOString().split("T")[0];
    expect(dates[6]).toBe(today);
    // strictly increasing
    for (let i = 1; i < dates.length; i++) {
      expect(new Date(dates[i]).getTime()).toBeGreaterThan(new Date(dates[i - 1]).getTime());
    }
  });
});

describe("buildActivityDashboardResponse", () => {
  const dates = ["2026-07-16", "2026-07-17", "2026-07-18"];

  it("fills in per-day logins/outreach for a user with matching rows", () => {
    const daily: DailyCountRow[] = [
      { day: "2026-07-16", userId: "usr_drew", logins: 2, outreach_sent: 1 },
      { day: "2026-07-18", userId: "usr_drew", logins: 0, outreach_sent: 3 },
    ];
    const lastLogin: LastLoginRow[] = [
      { userId: "usr_drew", last_login: new Date("2026-07-18T12:00:00.000Z") },
    ];
    const totalOutreach: TotalOutreachRow[] = [{ userId: "usr_drew", total: 42 }];

    const result = buildActivityDashboardResponse(
      [{ email: "drew@eloso.ai", name: "Drew", userId: "usr_drew" }],
      dates,
      daily,
      lastLogin,
      totalOutreach
    );

    expect(result.dates).toEqual(dates);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toEqual({
      email: "drew@eloso.ai",
      name: "Drew",
      last_login: "2026-07-18T12:00:00.000Z",
      last_7_days_logins: [2, 0, 0],
      last_7_days_outreach_sent: [1, 0, 3],
      total_outreach_sent: 42,
    });
  });

  it("returns all-zero stats and null last_login for a user with no Postgres row yet", () => {
    const result = buildActivityDashboardResponse(
      [{ email: "jake@eloso.ai", name: "Jake", userId: null }],
      dates,
      [],
      [],
      []
    );

    expect(result.users[0]).toEqual({
      email: "jake@eloso.ai",
      name: "Jake",
      last_login: null,
      last_7_days_logins: [0, 0, 0],
      last_7_days_outreach_sent: [0, 0, 0],
      total_outreach_sent: 0,
    });
  });

  it("converts bigint-like counts (as returned by Postgres COUNT(*)) to numbers", () => {
    const daily: DailyCountRow[] = [
      { day: "2026-07-16", userId: "usr_ben", logins: BigInt(3), outreach_sent: BigInt(5) },
    ];
    const result = buildActivityDashboardResponse(
      [{ email: "ben@eloso.ai", name: "Ben", userId: "usr_ben" }],
      dates,
      daily,
      [],
      [{ userId: "usr_ben", total: BigInt(10) }]
    );

    expect(result.users[0].last_7_days_logins[0]).toBe(3);
    expect(result.users[0].last_7_days_outreach_sent[0]).toBe(5);
    expect(result.users[0].total_outreach_sent).toBe(10);
    expect(typeof result.users[0].last_7_days_logins[0]).toBe("number");
  });

  it("only reports stats for known users, in roster order", () => {
    const result = buildActivityDashboardResponse(
      [
        { email: "drew@eloso.ai", name: "Drew", userId: "usr_drew" },
        { email: "ben@eloso.ai", name: "Ben", userId: "usr_ben" },
      ],
      dates,
      [],
      [],
      []
    );
    expect(result.users.map((u) => u.email)).toEqual(["drew@eloso.ai", "ben@eloso.ai"]);
  });
});

describe("resolveDashboardUsers", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("maps known users to null userId when no Postgres User exists yet", async () => {
    findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await resolveDashboardUsers();

    expect(result).toEqual([
      { email: "drew@eloso.ai", name: "Drew", userId: null },
      { email: "ben@eloso.ai", name: "Ben", userId: null },
      { email: "jake@eloso.ai", name: "Jake", userId: null },
    ]);
  });

  it("resolves userId from Postgres when a matching User row exists", async () => {
    findManyMock
      .mockResolvedValueOnce([{ id: "usr_drew", email: "drew@eloso.ai", name: "Drew" }])
      .mockResolvedValueOnce([{ email: "drew@eloso.ai", name: "Drew" }]);

    const result = await resolveDashboardUsers();

    expect(result.find((u) => u.email === "drew@eloso.ai")?.userId).toBe("usr_drew");
    expect(result.find((u) => u.email === "ben@eloso.ai")?.userId).toBeNull();
  });

  it("flags (via warning) but does not throw when Postgres has an unexpected extra user", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    findManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ email: "someone-else@eloso.ai", name: "Someone Else" }]);

    await expect(resolveDashboardUsers()).resolves.toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("someone-else@eloso.ai"));

    warnSpy.mockRestore();
  });
});
