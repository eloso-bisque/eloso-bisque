/**
 * Verifies that the cutover read path (ActivityLog queries) produces the
 * same numbers the current KV-backed Activity Dashboard shows, for the same
 * users/days. Run this after seed-activity-log-from-kv.ts and before
 * flipping the read route over.
 *
 * Run with:  npx tsx scripts/verify-activity-parity.ts
 * Exits non-zero if any mismatch is found.
 */

import { kv } from "@vercel/kv";
import { prisma } from "../src/lib/prisma";
import { KNOWN_ACTIVITY_USERS } from "../src/lib/activity-log";
import {
  ACTIVITY_DASHBOARD_DAYS,
  getDates,
  fetchActivityDashboardData,
  resolveDashboardUsers,
} from "../src/lib/activity-dashboard";
import { buildParityRow, summarizeParity, type ParityRow } from "./lib/activity-parity";

async function main() {
  const dashboardDates = getDates(ACTIVITY_DASHBOARD_DAYS);
  // Compare only days strictly before today — today is a partial day for
  // both sources and isn't a meaningful parity check (see seed script notes).
  const compareDates = dashboardDates.slice(0, -1);

  const dashboardUsers = await resolveDashboardUsers();
  const userIds = dashboardUsers.map((u) => u.userId).filter((id): id is string => id !== null);
  const windowStart = new Date(`${compareDates[0]}T00:00:00.000Z`);
  const { daily, lastLogin, totalOutreach } = await fetchActivityDashboardData(userIds, windowStart);

  const dailyByUserDay = new Map<string, { logins: number; outreach: number }>();
  for (const row of daily) {
    dailyByUserDay.set(`${row.userId}|${row.day}`, {
      logins: Number(row.logins),
      outreach: Number(row.outreach_sent),
    });
  }
  const lastLoginByUser = new Map(lastLogin.map((r) => [r.userId, r.last_login.toISOString()]));
  const totalOutreachByUser = new Map(totalOutreach.map((r) => [r.userId, Number(r.total)]));

  const rows: ParityRow[] = [];

  for (const { email } of KNOWN_ACTIVITY_USERS) {
    const dashboardUser = dashboardUsers.find((u) => u.email === email);
    const userId = dashboardUser?.userId ?? null;

    for (const date of compareDates) {
      const kvLogins = (await kv.get<number>(`activity:logins:${email}:${date}`)) ?? 0;
      const pgLogins = userId ? dailyByUserDay.get(`${userId}|${date}`)?.logins ?? 0 : 0;
      rows.push(buildParityRow(email, "logins", date, kvLogins, pgLogins));

      const kvOutreach = (await kv.get<number>(`activity:outreach_sent:${email}:${date}`)) ?? 0;
      const pgOutreach = userId ? dailyByUserDay.get(`${userId}|${date}`)?.outreach ?? 0 : 0;
      rows.push(buildParityRow(email, "outreach_sent", date, kvOutreach, pgOutreach));
    }

    const kvLastLogin = (await kv.get<string>(`activity:last_login:${email}`)) ?? null;
    const pgLastLogin = userId ? lastLoginByUser.get(userId) ?? null : null;
    rows.push(buildParityRow(email, "last_login", "all-time", kvLastLogin, pgLastLogin));

    const kvTotalOutreach = (await kv.get<number>(`activity:outreach_sent_total:${email}`)) ?? 0;
    const pgTotalOutreach = userId ? totalOutreachByUser.get(userId) ?? 0 : 0;
    rows.push(buildParityRow(email, "total_outreach_sent", "all-time", kvTotalOutreach, pgTotalOutreach));
  }

  console.table(
    rows.map((r) => ({
      email: r.email,
      metric: r.metric,
      date: r.date,
      kv: r.kvValue,
      postgres: r.pgValue,
      match: r.match ? "OK" : "MISMATCH",
    }))
  );

  const summary = summarizeParity(rows);
  console.log(`\n${summary.matched}/${summary.total} rows matched.`);
  if (summary.mismatched.length > 0) {
    console.error(`${summary.mismatched.length} mismatch(es) found.`);
    process.exitCode = 1;
  } else {
    console.log("All rows matched.");
  }
}

main()
  .catch((err) => {
    console.error("Verification script failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
