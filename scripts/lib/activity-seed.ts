/**
 * Pure planning logic for the one-time historical ActivityLog seed
 * (Prisma Phase 3.1 — see docs/prisma-schema-design.md section 4.1, step 3
 * "Dual-write period").
 *
 * KV stores activity as day-bucketed *counts* (`activity:logins:{email}:{date}`
 * = N), not individual events. To let the cutover read path (which counts
 * `ActivityLog` rows) show the same historical numbers KV currently shows,
 * this module expands each day's count into N synthetic `ActivityLog` row
 * plans, spread across that day.
 *
 * No I/O happens here — callers (the CLI script) are responsible for
 * reading KV, checking which rows already exist in Postgres (idempotency),
 * and inserting. Keeping this pure makes the day-bucketing / no-double-count
 * / last-login-pinning logic unit-testable without a database or KV.
 */

export type SeedEventType = "Login" | "OutreachTouchSent";

export interface KvActivitySnapshot {
  email: string;
  /** date ('YYYY-MM-DD') -> login count, from `activity:logins:{email}:{date}` */
  dailyLogins: Record<string, number>;
  /** date ('YYYY-MM-DD') -> outreach-sent count, from `activity:outreach_sent:{email}:{date}` */
  dailyOutreachSent: Record<string, number>;
  /** ISO timestamp from `activity:last_login:{email}`, or null if never logged in */
  lastLoginIso: string | null;
  /** all-time count from `activity:outreach_sent_total:{email}` */
  totalOutreachSent: number;
}

export interface SeedRowPlan {
  email: string;
  eventType: SeedEventType;
  createdAt: Date;
}

/** Spreads `count` events evenly through the UTC day `date`, in ascending order. */
function spreadTimestampsThroughDay(date: string, count: number): Date[] {
  const dayStartMs = new Date(`${date}T00:00:00.000Z`).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const timestamps: Date[] = [];
  for (let i = 0; i < count; i++) {
    const offsetMs = Math.floor(((i + 1) / (count + 1)) * DAY_MS);
    timestamps.push(new Date(dayStartMs + offsetMs));
  }
  return timestamps;
}

/**
 * Builds the list of synthetic Login row timestamps for one day, pinning the
 * most recent one to the exact KV `last_login` timestamp if that timestamp
 * falls on this date — so the dashboard's `last_login` value (computed as
 * MAX(createdAt) over Login rows) exactly matches what KV currently reports,
 * not just an approximate spread-out time.
 */
function buildLoginTimestampsForDay(
  date: string,
  count: number,
  lastLoginIso: string | null
): Date[] {
  const timestamps = spreadTimestampsThroughDay(date, count);
  if (count > 0 && lastLoginIso && lastLoginIso.startsWith(date)) {
    timestamps[timestamps.length - 1] = new Date(lastLoginIso);
  }
  return timestamps;
}

/**
 * Plans the full set of ActivityLog rows to seed for one user, given their
 * KV snapshot and the set of calendar dates to backfill.
 *
 * `seedDates` MUST be strictly before "today" (the caller is responsible for
 * excluding today) — today's activity is covered by live dual-write once
 * deployed, and re-seeding it here would double-count.
 *
 * The all-time `totalOutreachSent` KV counter has no expiry, while the daily
 * counters expire after 90 days; if the total exceeds what `seedDates`
 * captures, the remainder is represented as a single batch of rows dated
 * one day before the earliest seed date — outside the 7-day dashboard
 * window, so it contributes to `total_outreach_sent` without perturbing the
 * daily breakdown.
 */
export function planSeedRows(
  snapshot: KvActivitySnapshot,
  seedDates: string[]
): SeedRowPlan[] {
  const rows: SeedRowPlan[] = [];

  for (const date of seedDates) {
    const loginCount = snapshot.dailyLogins[date] ?? 0;
    for (const createdAt of buildLoginTimestampsForDay(date, loginCount, snapshot.lastLoginIso)) {
      rows.push({ email: snapshot.email, eventType: "Login", createdAt });
    }

    const outreachCount = snapshot.dailyOutreachSent[date] ?? 0;
    for (const createdAt of spreadTimestampsThroughDay(date, outreachCount)) {
      rows.push({ email: snapshot.email, eventType: "OutreachTouchSent", createdAt });
    }
  }

  // KV's last_login has no expiry and can predate the entire seed window
  // (e.g. a user who hasn't logged in for months, while the daily counters
  // only cover the last few days). Without a standalone row for it, the
  // cutover would regress `last_login` to null. We only add this when the
  // timestamp is NOT already represented by the day-count expansion above,
  // and only when it falls on/before the last seeded date — a last_login
  // on "today" (after the seed window) is deliberately left to live
  // dual-write, not backfilled here.
  if (seedDates.length > 0 && snapshot.lastLoginIso) {
    const windowEnd = [...seedDates].sort().at(-1)!;
    const lastLoginDate = snapshot.lastLoginIso.split("T")[0];
    const alreadyCaptured = (snapshot.dailyLogins[lastLoginDate] ?? 0) > 0;
    if (lastLoginDate <= windowEnd && !alreadyCaptured) {
      rows.push({ email: snapshot.email, eventType: "Login", createdAt: new Date(snapshot.lastLoginIso) });
    }
  }

  const capturedOutreach = seedDates.reduce(
    (sum, d) => sum + (snapshot.dailyOutreachSent[d] ?? 0),
    0
  );
  const remainder = snapshot.totalOutreachSent - capturedOutreach;
  if (remainder > 0 && seedDates.length > 0) {
    const earliestDate = seedDates[0];
    const olderDate = new Date(`${earliestDate}T00:00:00.000Z`);
    olderDate.setUTCDate(olderDate.getUTCDate() - 1);
    for (let i = 0; i < remainder; i++) {
      rows.push({ email: snapshot.email, eventType: "OutreachTouchSent", createdAt: olderDate });
    }
  }

  return rows;
}

/** Groups a flat list of row plans by (date, eventType) for batched idempotency checks. */
export function groupSeedRowsByDateAndType(
  rows: SeedRowPlan[]
): Map<string, SeedRowPlan[]> {
  const groups = new Map<string, SeedRowPlan[]>();
  for (const row of rows) {
    const date = row.createdAt.toISOString().split("T")[0];
    const key = `${date}|${row.eventType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}
