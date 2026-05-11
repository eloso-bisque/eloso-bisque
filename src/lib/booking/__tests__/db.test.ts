import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { closeDb } from '@/lib/db/client';
import {
  getAvailabilityConfig,
  updateAvailabilityConfig,
  createBooking,
  getBookingById,
  getBookingByCancelToken,
  getBookingByRescheduleToken,
  cancelBooking,
  rescheduleBooking,
  getConflictingBookings,
  addBlockedDate,
  getBlockedDates,
  removeBlockedDate,
  markReminderSent,
  getBookingsNeedingReminders,
} from '../db';

// Use in-memory DB for tests
process.env.BOOKING_DB_PATH = ':memory:';

function makeBookingRow(overrides: Partial<Parameters<typeof createBooking>[0]> = {}): Parameters<typeof createBooking>[0] {
  const now = new Date();
  const start = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    id: crypto.randomUUID(),
    guest_name: 'Test User',
    guest_email: 'test@example.com',
    guest_notes: '',
    start_utc: start.toISOString(),
    end_utc: end.toISOString(),
    duration_minutes: 30,
    timezone: 'America/New_York',
    cancel_token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    reschedule_token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    ...overrides,
  };
}

describe('AvailabilityConfig', () => {
  it('returns default config', () => {
    const config = getAvailabilityConfig();
    expect(config.id).toBe(1);
    expect(Array.isArray(config.working_days)).toBe(true);
    expect(config.working_days).toContain('Mon');
    expect(config.slot_duration_minutes).toBeGreaterThan(0);
  });

  it('updates config fields', () => {
    const updated = updateAvailabilityConfig({ buffer_minutes: 20, slot_duration_minutes: 45 });
    expect(updated.buffer_minutes).toBe(20);
    expect(updated.slot_duration_minutes).toBe(45);
  });

  it('preserves unset fields when updating', () => {
    const before = getAvailabilityConfig();
    updateAvailabilityConfig({ buffer_minutes: 10 });
    const after = getAvailabilityConfig();
    expect(after.timezone).toBe(before.timezone);
    expect(after.start_time).toBe(before.start_time);
  });
});

describe('Blocked dates', () => {
  it('adds and retrieves blocked dates', () => {
    addBlockedDate('2099-01-01', 'New Year');
    const dates = getBlockedDates();
    expect(dates).toContain('2099-01-01');
  });

  it('ignores duplicate blocked dates (INSERT OR IGNORE)', () => {
    addBlockedDate('2099-02-01');
    addBlockedDate('2099-02-01'); // duplicate — should not throw
    const dates = getBlockedDates().filter(d => d === '2099-02-01');
    expect(dates.length).toBe(1);
  });

  it('removes blocked dates', () => {
    addBlockedDate('2099-03-01');
    removeBlockedDate('2099-03-01');
    const dates = getBlockedDates();
    expect(dates).not.toContain('2099-03-01');
  });
});

describe('Booking CRUD', () => {
  it('creates and retrieves a booking', () => {
    const row = makeBookingRow();
    const booking = createBooking(row);
    expect(booking.id).toBe(row.id);
    expect(booking.guest_name).toBe('Test User');
    expect(booking.status).toBe('confirmed');
    expect(booking.cancel_token_used).toBe(0);
  });

  it('retrieves by cancel token', () => {
    const row = makeBookingRow();
    createBooking(row);
    const booking = getBookingByCancelToken(row.cancel_token);
    expect(booking).not.toBeNull();
    expect(booking!.id).toBe(row.id);
  });

  it('retrieves by reschedule token', () => {
    const row = makeBookingRow();
    createBooking(row);
    const booking = getBookingByRescheduleToken(row.reschedule_token);
    expect(booking).not.toBeNull();
    expect(booking!.id).toBe(row.id);
  });

  it('returns null for unknown ID', () => {
    const result = getBookingById('nonexistent-id');
    expect(result).toBeNull();
  });

  it('cancels a booking atomically', () => {
    const row = makeBookingRow();
    createBooking(row);
    const cancelled = cancelBooking(row.id);
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.cancel_token_used).toBe(1);
  });

  it('reschedules a booking', () => {
    const row = makeBookingRow();
    createBooking(row);
    const newStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const newEnd = new Date(new Date(newStart).getTime() + 30 * 60 * 1000).toISOString();
    const rescheduled = rescheduleBooking(row.id, newStart, newEnd);
    expect(rescheduled!.start_utc).toBe(newStart);
    expect(rescheduled!.status).toBe('confirmed');
    expect(rescheduled!.reschedule_token_used).toBe(1);
  });
});

describe('Conflict detection', () => {
  it('detects overlapping bookings', () => {
    const start = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const row = makeBookingRow({ start_utc: start.toISOString(), end_utc: end.toISOString() });
    createBooking(row);

    const conflicts = getConflictingBookings(start.toISOString(), end.toISOString());
    expect(conflicts.some(b => b.id === row.id)).toBe(true);
  });

  it('excludes cancelled bookings from conflicts', () => {
    const start = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const row = makeBookingRow({ start_utc: start.toISOString(), end_utc: end.toISOString() });
    createBooking(row);
    cancelBooking(row.id);

    const conflicts = getConflictingBookings(start.toISOString(), end.toISOString());
    expect(conflicts.some(b => b.id === row.id)).toBe(false);
  });

  it('excludes self when checking for double-booking (reschedule case)', () => {
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const row = makeBookingRow({ start_utc: start.toISOString(), end_utc: end.toISOString() });
    createBooking(row);

    const conflicts = getConflictingBookings(start.toISOString(), end.toISOString(), row.id);
    expect(conflicts.some(b => b.id === row.id)).toBe(false);
  });

  it('detects partially overlapping bookings', () => {
    const start = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour
    const row = makeBookingRow({ start_utc: start.toISOString(), end_utc: end.toISOString() });
    createBooking(row);

    // Partial overlap: 30 min into the booking
    const partialStart = new Date(start.getTime() + 30 * 60 * 1000).toISOString();
    const partialEnd = new Date(start.getTime() + 90 * 60 * 1000).toISOString();

    const conflicts = getConflictingBookings(partialStart, partialEnd);
    expect(conflicts.some(b => b.id === row.id)).toBe(true);
  });
});

describe('Reminder tracking', () => {
  it('marks 24h reminder as sent', () => {
    const row = makeBookingRow();
    createBooking(row);
    markReminderSent(row.id, '24h');
    const booking = getBookingById(row.id);
    expect(booking!.reminder_24h_sent).toBe(1);
    expect(booking!.reminder_1h_sent).toBe(0);
  });

  it('marks 1h reminder as sent', () => {
    const row = makeBookingRow();
    createBooking(row);
    markReminderSent(row.id, '1h');
    const booking = getBookingById(row.id);
    expect(booking!.reminder_1h_sent).toBe(1);
  });

  it('getBookingsNeedingReminders returns bookings in the right window', () => {
    // Create a booking 24h from now
    const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const in24h30 = new Date(in24h.getTime() + 30 * 60 * 1000);
    const row = makeBookingRow({
      start_utc: in24h.toISOString(),
      end_utc: in24h30.toISOString(),
    });
    createBooking(row);

    const needingReminders = getBookingsNeedingReminders();
    // Should include our 24h booking (within 23-25h window)
    expect(needingReminders.some(b => b.id === row.id)).toBe(true);
  });
});
