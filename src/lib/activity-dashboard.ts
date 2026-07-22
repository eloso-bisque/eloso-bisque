/**
 * Query logic for the Activity Dashboard (Prisma Phase 3.1 read-path cutover).
 *
 * Replaces per-day Vercel KV counter reads with `ActivityLog` row queries
 * (design doc docs/prisma-schema-design.md section 3.7). The shape returned
 * to the client is unchanged from the KV-backed implementation.
 *
 * The functions here are split so the response-shaping logic (pure, no I/O)
 * can be unit tested without a database: `fetchActivityDashboardData` does
 * the Prisma/SQL work, `buildActivityDashboardResponse` is a pure function
 * from raw query rows to the API response shape.
 */

import { prisma } from '@/lib/prisma';
import { KNOWN_ACTIVITY_USERS } from '@/lib/activity-log';

export const ACTIVITY_DASHBOARD_DAYS = 7;

export interface DashboardUser {
  email: string;
  name: string;
  /** Postgres User.id, or null if no matching User row exists yet (pre-backfill). */
  userId: string | null;
}

export interface DailyCountRow {
  day: string; // 'YYYY-MM-DD' (UTC)
  userId: string;
  logins: number | bigint;
  outreach_sent: number | bigint;
}

export interface LastLoginRow {
  userId: string;
  last_login: Date;
}

export interface TotalOutreachRow {
  userId: string;
  total: number | bigint;
}

export interface ActivityDashboardUserResult {
  email: string;
  name: string;
  last_login: string | null;
  last_7_days_logins: number[];
  last_7_days_outreach_sent: number[];
  total_outreach_sent: number;
}

export interface ActivityDashboardResponse {
  users: ActivityDashboardUserResult[];
  dates: string[];
}

/** Returns `count` UTC calendar-date strings ending today, oldest first. */
export function getDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Resolves the known Activity Dashboard roster (KNOWN_ACTIVITY_USERS) against
 * the real Postgres `User` table by email. Does not assume the hardcoded
 * roster is authoritative: any Postgres user among the known emails whose
 * `name` differs from the hardcoded display name, or any *additional*
 * Postgres user not in the hardcoded roster, is logged as a flag rather than
 * silently adopted — see docs/prisma-schema-design.md section 3.7 and the
 * migration task description for why the hardcoded list needs cross-checking
 * rather than blind trust.
 */
export async function resolveDashboardUsers(): Promise<DashboardUser[]> {
  const knownEmails = KNOWN_ACTIVITY_USERS.map((u) => u.email);

  const [knownDbUsers, allDbUsers] = await Promise.all([
    prisma.user.findMany({
      where: { email: { in: knownEmails } },
      select: { id: true, email: true, name: true },
    }),
    prisma.user.findMany({ select: { email: true, name: true } }),
  ]);

  const dbByEmail = new Map(knownDbUsers.map((u) => [u.email, u]));

  for (const dbUser of knownDbUsers) {
    const known = KNOWN_ACTIVITY_USERS.find((u) => u.email === dbUser.email);
    if (known && known.name !== dbUser.name) {
      console.warn(
        `[activity-dashboard] Postgres User.name "${dbUser.name}" for ${dbUser.email} differs ` +
          `from the hardcoded Activity Dashboard display name "${known.name}" — keeping the ` +
          'hardcoded display name. Flagging for review.'
      );
    }
  }

  const extraUsers = allDbUsers.filter((u) => !knownEmails.includes(u.email));
  if (extraUsers.length > 0) {
    console.warn(
      `[activity-dashboard] Postgres User table has ${extraUsers.length} user(s) not in the ` +
        `hardcoded Activity Dashboard roster: ${extraUsers.map((u) => u.email).join(', ')} — ` +
        'not shown on the dashboard. Flagging for review.'
    );
  }

  return KNOWN_ACTIVITY_USERS.map(({ email, name }) => ({
    email,
    name,
    userId: dbByEmail.get(email)?.id ?? null,
  }));
}

/**
 * Runs the three ActivityLog aggregation queries needed for the dashboard.
 * Uses raw SQL for the per-day breakdown (design doc 3.7) since Prisma's
 * `groupBy` cannot group by a computed `DATE(createdAt)` expression.
 */
export async function fetchActivityDashboardData(
  userIds: string[],
  windowStartUtc: Date
): Promise<{
  daily: DailyCountRow[];
  lastLogin: LastLoginRow[];
  totalOutreach: TotalOutreachRow[];
}> {
  if (userIds.length === 0) {
    return { daily: [], lastLogin: [], totalOutreach: [] };
  }

  const [daily, lastLogin, totalOutreach] = await Promise.all([
    prisma.$queryRaw<DailyCountRow[]>`
      SELECT
        TO_CHAR("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
        "userId",
        COUNT(*) FILTER (WHERE "eventType" = 'Login') as logins,
        COUNT(*) FILTER (WHERE "eventType" = 'OutreachTouchSent') as outreach_sent
      FROM "ActivityLog"
      WHERE "userId" = ANY(${userIds})
        AND "createdAt" >= ${windowStartUtc}
      GROUP BY day, "userId"
    `,
    prisma.$queryRaw<LastLoginRow[]>`
      SELECT "userId", MAX("createdAt") as last_login
      FROM "ActivityLog"
      WHERE "userId" = ANY(${userIds})
        AND "eventType" = 'Login'
      GROUP BY "userId"
    `,
    prisma.$queryRaw<TotalOutreachRow[]>`
      SELECT "userId", COUNT(*) as total
      FROM "ActivityLog"
      WHERE "userId" = ANY(${userIds})
        AND "eventType" = 'OutreachTouchSent'
      GROUP BY "userId"
    `,
  ]);

  return { daily, lastLogin, totalOutreach };
}

/**
 * Pure function: shapes raw ActivityLog query rows into the Activity
 * Dashboard API response. No I/O — fully unit-testable with fixture rows.
 */
export function buildActivityDashboardResponse(
  dashboardUsers: DashboardUser[],
  dates: string[],
  daily: DailyCountRow[],
  lastLogin: LastLoginRow[],
  totalOutreach: TotalOutreachRow[]
): ActivityDashboardResponse {
  const dailyByUser = new Map<string, Map<string, { logins: number; outreach: number }>>();
  for (const row of daily) {
    if (!dailyByUser.has(row.userId)) {
      dailyByUser.set(row.userId, new Map());
    }
    dailyByUser.get(row.userId)!.set(row.day, {
      logins: Number(row.logins),
      outreach: Number(row.outreach_sent),
    });
  }

  const lastLoginByUser = new Map(lastLogin.map((r) => [r.userId, r.last_login]));
  const totalByUser = new Map(totalOutreach.map((r) => [r.userId, Number(r.total)]));

  const users: ActivityDashboardUserResult[] = dashboardUsers.map(({ email, name, userId }) => {
    const perDay = userId ? dailyByUser.get(userId) : undefined;
    const lastLoginDate = userId ? lastLoginByUser.get(userId) : undefined;

    return {
      email,
      name,
      last_login: lastLoginDate ? new Date(lastLoginDate).toISOString() : null,
      last_7_days_logins: dates.map((d) => perDay?.get(d)?.logins ?? 0),
      last_7_days_outreach_sent: dates.map((d) => perDay?.get(d)?.outreach ?? 0),
      total_outreach_sent: userId ? totalByUser.get(userId) ?? 0 : 0,
    };
  });

  return { users, dates };
}
