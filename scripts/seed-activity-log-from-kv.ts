/**
 * One-time historical seed: reads the existing Vercel KV activity counters
 * and inserts corresponding `ActivityLog` rows in Postgres, so the Activity
 * Dashboard cutover (Prisma Phase 3.1) doesn't lose historical data.
 *
 * Run with:  npx tsx scripts/seed-activity-log-from-kv.ts [--dry-run]
 * Requires:  KV_REST_API_URL / KV_REST_API_TOKEN and DATABASE_URL in env
 *            (e.g. `vercel env pull --environment=production` first).
 *
 * Idempotent / safely re-runnable: before inserting rows for a given
 * (user, day, eventType), checks whether any ActivityLog rows already exist
 * in that day's window and skips if so. This also means it is safe to run
 * after dual-write has started recording *today's* events, because this
 * script only ever seeds dates strictly before "today" — see
 * scripts/lib/activity-seed.ts for the row-planning logic.
 */

import { kv } from "@vercel/kv";
import { prisma } from "../src/lib/prisma";
import { KNOWN_ACTIVITY_USERS } from "../src/lib/activity-log";
import { ACTIVITY_DASHBOARD_DAYS, getDates } from "../src/lib/activity-dashboard";
import {
  planSeedRows,
  groupSeedRowsByDateAndType,
  type KvActivitySnapshot,
} from "./lib/activity-seed";

const DRY_RUN = process.argv.includes("--dry-run");

async function readKvSnapshot(email: string, seedDates: string[]): Promise<KvActivitySnapshot> {
  const [lastLoginIso, totalOutreachSent, dailyLoginsList, dailyOutreachList] = await Promise.all([
    kv.get<string>(`activity:last_login:${email}`),
    kv.get<number>(`activity:outreach_sent_total:${email}`),
    Promise.all(
      seedDates.map((date) => kv.get<number>(`activity:logins:${email}:${date}`))
    ),
    Promise.all(
      seedDates.map((date) => kv.get<number>(`activity:outreach_sent:${email}:${date}`))
    ),
  ]);

  const dailyLogins: Record<string, number> = {};
  const dailyOutreachSent: Record<string, number> = {};
  seedDates.forEach((date, i) => {
    dailyLogins[date] = dailyLoginsList[i] ?? 0;
    dailyOutreachSent[date] = dailyOutreachList[i] ?? 0;
  });

  return {
    email,
    dailyLogins,
    dailyOutreachSent,
    lastLoginIso: lastLoginIso ?? null,
    totalOutreachSent: totalOutreachSent ?? 0,
  };
}

async function alreadySeeded(
  userId: string,
  eventType: "Login" | "OutreachTouchSent",
  dayStart: Date,
  dayEnd: Date
): Promise<boolean> {
  const count = await prisma.activityLog.count({
    where: { userId, eventType, createdAt: { gte: dayStart, lt: dayEnd } },
  });
  return count > 0;
}

async function main() {
  const dashboardDates = getDates(ACTIVITY_DASHBOARD_DAYS);
  // Seed everything the dashboard needs except "today" (the last entry) —
  // today's activity is covered by live dual-write, and re-seeding it would
  // double-count on top of whatever's already been dual-written today.
  const seedDates = dashboardDates.slice(0, -1);

  console.log(`Seeding ActivityLog history for dates: ${seedDates.join(", ")}`);
  console.log(DRY_RUN ? "(dry run — no writes)" : "(live run)");

  const summary: Record<string, { planned: number; inserted: number; skippedExisting: number }> = {};

  for (const { email } of KNOWN_ACTIVITY_USERS) {
    summary[email] = { planned: 0, inserted: 0, skippedExisting: 0 };

    const dbUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!dbUser) {
      console.warn(
        `[seed] No Postgres User row for ${email} yet — skipping ` +
          "(expected until the Kissinger backfill script seeds Users)."
      );
      continue;
    }

    const snapshot = await readKvSnapshot(email, seedDates);
    const plannedRows = planSeedRows(snapshot, seedDates);
    summary[email].planned = plannedRows.length;

    const grouped = groupSeedRowsByDateAndType(plannedRows);

    for (const [key, rows] of grouped) {
      const [date, eventType] = key.split("|") as [string, "Login" | "OutreachTouchSent"];
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      if (await alreadySeeded(dbUser.id, eventType, dayStart, dayEnd)) {
        summary[email].skippedExisting += rows.length;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [dry-run] would insert ${rows.length} ${eventType} row(s) for ${email} on ${date}`);
        summary[email].inserted += rows.length;
        continue;
      }

      await prisma.activityLog.createMany({
        data: rows.map((r) => ({
          userId: dbUser.id,
          eventType: r.eventType,
          createdAt: r.createdAt,
        })),
      });
      summary[email].inserted += rows.length;
    }
  }

  console.log("\nSummary:");
  console.table(summary);
}

main()
  .catch((err) => {
    console.error("Seed script failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
