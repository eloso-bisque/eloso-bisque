/**
 * Data access layer for bisque-booking.
 * All DB calls are synchronous (better-sqlite3).
 */

import { getDb } from '@/lib/db/client';
import type { Booking, AvailabilityConfig, BookingStatus } from './types';

// ---------------------------------------------------------------------------
// Availability config
// ---------------------------------------------------------------------------

interface RawAvailabilityConfig {
  id: number;
  working_days: string;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  booking_horizon_days: number;
  min_notice_hours: number;
  updated_at: string;
}

function parseConfig(raw: RawAvailabilityConfig): AvailabilityConfig {
  return {
    ...raw,
    id: 1,
    working_days: JSON.parse(raw.working_days) as string[],
  };
}

export function getAvailabilityConfig(): AvailabilityConfig {
  const db = getDb();
  const row = db.prepare('SELECT * FROM availability_config WHERE id = 1').get() as RawAvailabilityConfig;
  return parseConfig(row);
}

export function updateAvailabilityConfig(
  updates: Partial<Omit<AvailabilityConfig, 'id' | 'updated_at'>>
): AvailabilityConfig {
  const db = getDb();
  const current = getAvailabilityConfig();
  const merged = { ...current, ...updates };

  db.prepare(`
    UPDATE availability_config SET
      working_days = ?,
      start_time = ?,
      end_time = ?,
      slot_duration_minutes = ?,
      buffer_minutes = ?,
      timezone = ?,
      booking_horizon_days = ?,
      min_notice_hours = ?,
      updated_at = datetime('now')
    WHERE id = 1
  `).run(
    JSON.stringify(merged.working_days),
    merged.start_time,
    merged.end_time,
    merged.slot_duration_minutes,
    merged.buffer_minutes,
    merged.timezone,
    merged.booking_horizon_days,
    merged.min_notice_hours,
  );

  return getAvailabilityConfig();
}

// ---------------------------------------------------------------------------
// Blocked dates
// ---------------------------------------------------------------------------

export function getBlockedDates(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT date FROM blocked_dates ORDER BY date').all() as { date: string }[];
  return rows.map(r => r.date);
}

export function addBlockedDate(date: string, reason = ''): void {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT OR IGNORE INTO blocked_dates (id, date, reason) VALUES (?, ?, ?)'
  ).run(id, date, reason);
}

export function removeBlockedDate(date: string): void {
  const db = getDb();
  db.prepare('DELETE FROM blocked_dates WHERE date = ?').run(date);
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export function getBookingById(id: string): Booking | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Booking) ?? null;
}

export function getBookingByCancelToken(token: string): Booking | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM bookings WHERE cancel_token = ?').get(token) as Booking) ?? null;
}

export function getBookingByRescheduleToken(token: string): Booking | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM bookings WHERE reschedule_token = ?').get(token) as Booking) ?? null;
}

export function listBookings(
  status?: BookingStatus,
  limit = 100,
  offset = 0
): Booking[] {
  const db = getDb();
  if (status) {
    return db.prepare(
      'SELECT * FROM bookings WHERE status = ? ORDER BY start_utc DESC LIMIT ? OFFSET ?'
    ).all(status, limit, offset) as Booking[];
  }
  return db.prepare(
    'SELECT * FROM bookings ORDER BY start_utc DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as Booking[];
}

export function listUpcomingBookings(): Booking[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(
    "SELECT * FROM bookings WHERE status = 'confirmed' AND start_utc >= ? ORDER BY start_utc ASC"
  ).all(now) as Booking[];
}

export function listPastBookings(limit = 50): Booking[] {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare(
    "SELECT * FROM bookings WHERE start_utc < ? ORDER BY start_utc DESC LIMIT ?"
  ).all(now, limit) as Booking[];
}

export interface CreateBookingRow {
  id: string;
  guest_name: string;
  guest_email: string;
  guest_notes: string;
  start_utc: string;
  end_utc: string;
  duration_minutes: number;
  timezone: string;
  cancel_token: string;
  reschedule_token: string;
}

export function createBooking(row: CreateBookingRow): Booking {
  const db = getDb();
  db.prepare(`
    INSERT INTO bookings (
      id, guest_name, guest_email, guest_notes,
      start_utc, end_utc, duration_minutes, timezone,
      cancel_token, reschedule_token
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.guest_name,
    row.guest_email,
    row.guest_notes,
    row.start_utc,
    row.end_utc,
    row.duration_minutes,
    row.timezone,
    row.cancel_token,
    row.reschedule_token,
  );
  return getBookingById(row.id)!;
}

export function cancelBooking(id: string): Booking | null {
  const db = getDb();
  db.prepare(`
    UPDATE bookings SET
      status = 'cancelled',
      cancel_token_used = 1,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
  return getBookingById(id);
}

export function rescheduleBooking(
  id: string,
  newStartUtc: string,
  newEndUtc: string
): Booking | null {
  const db = getDb();
  db.prepare(`
    UPDATE bookings SET
      start_utc = ?,
      end_utc = ?,
      status = 'confirmed',
      reschedule_token_used = 1,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(newStartUtc, newEndUtc, id);
  return getBookingById(id);
}

export function markReminderSent(id: string, which: '24h' | '1h'): void {
  const db = getDb();
  const col = which === '24h' ? 'reminder_24h_sent' : 'reminder_1h_sent';
  db.prepare(`UPDATE bookings SET ${col} = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function setKissingerContactId(id: string, contactId: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE bookings SET kissinger_contact_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(contactId, id);
}

/**
 * Returns confirmed bookings that overlap [startUtc, endUtc).
 * Used to check for double-booking.
 */
export function getConflictingBookings(
  startUtc: string,
  endUtc: string,
  excludeId?: string
): Booking[] {
  const db = getDb();
  const query = excludeId
    ? `SELECT * FROM bookings
       WHERE status = 'confirmed'
         AND id != ?
         AND start_utc < ?
         AND end_utc > ?`
    : `SELECT * FROM bookings
       WHERE status = 'confirmed'
         AND start_utc < ?
         AND end_utc > ?`;

  const params = excludeId
    ? [excludeId, endUtc, startUtc]
    : [endUtc, startUtc];

  return db.prepare(query).all(...params) as Booking[];
}

/** Fetch bookings that need 24h or 1h reminders (for cron job). */
export function getBookingsNeedingReminders(): Booking[] {
  const db = getDb();
  const now = new Date();
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString();
  const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000).toISOString();
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const in0h = now.toISOString();

  return db.prepare(`
    SELECT * FROM bookings
    WHERE status = 'confirmed'
      AND (
        (reminder_24h_sent = 0 AND start_utc >= ? AND start_utc <= ?)
        OR
        (reminder_1h_sent = 0 AND start_utc >= ? AND start_utc <= ?)
      )
  `).all(in23h, in25h, in0h, in2h) as Booking[];
}
