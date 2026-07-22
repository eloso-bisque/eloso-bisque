/**
 * Pure comparison logic for verifying that ActivityLog (Postgres) data
 * matches the KV counters it's replacing, for a given user/day/metric.
 * Used by scripts/verify-activity-parity.ts.
 */

export interface ParityRow {
  email: string;
  metric: string;
  date: string; // 'YYYY-MM-DD', or 'all-time' for lifetime totals
  kvValue: number | string | null;
  pgValue: number | string | null;
  match: boolean;
}

export function compareValues(kvValue: number | string | null, pgValue: number | string | null): boolean {
  if (kvValue === null && pgValue === null) return true;
  return kvValue === pgValue;
}

export function buildParityRow(
  email: string,
  metric: string,
  date: string,
  kvValue: number | string | null,
  pgValue: number | string | null
): ParityRow {
  return { email, metric, date, kvValue, pgValue, match: compareValues(kvValue, pgValue) };
}

export function summarizeParity(rows: ParityRow[]): { total: number; matched: number; mismatched: ParityRow[] } {
  const mismatched = rows.filter((r) => !r.match);
  return { total: rows.length, matched: rows.length - mismatched.length, mismatched };
}
