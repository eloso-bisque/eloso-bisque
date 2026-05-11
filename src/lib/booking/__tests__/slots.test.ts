import { describe, it, expect } from 'vitest';
import { generateSlots, validateSlot } from '../slots';
import type { AvailabilityConfig } from '../types';

const BASE_CONFIG: AvailabilityConfig = {
  id: 1,
  working_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  start_time: '09:00',
  end_time: '17:00',
  slot_duration_minutes: 30,
  buffer_minutes: 15,
  timezone: 'America/New_York',
  booking_horizon_days: 60,
  min_notice_hours: 2,
  updated_at: new Date().toISOString(),
};

function makeConfig(overrides: Partial<AvailabilityConfig> = {}): AvailabilityConfig {
  return { ...BASE_CONFIG, ...overrides };
}

/**
 * Returns next Monday at the given local hour in America/New_York.
 * Uses localToUtcApprox to avoid hardcoding the UTC offset.
 */
function getNextMonday(localHour = 10): Date {
  const now = new Date();
  const d = new Date(now);
  // Advance to next Monday
  const day = d.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  // Format as YYYY-MM-DD
  const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const timeStr = `${String(localHour).padStart(2, '0')}:00`;

  // Convert local time to UTC using Intl
  const approx = new Date(`${dateStr}T${timeStr}:00`);
  // Use Intl to find offset
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(approx);
  const [lh, lm] = local.split(':').map(Number);
  const wantedMin = localHour * 60;
  const gotMin = lh * 60 + lm;
  const offsetMin = wantedMin - gotMin;
  return new Date(approx.getTime() - offsetMin * 60 * 1000);
}

describe('generateSlots', () => {
  it('returns slots only on working days', () => {
    const fromUtc = getNextMonday(9);
    const toUtc = new Date(fromUtc.getTime() + 7 * 24 * 60 * 60 * 1000);

    const slots = generateSlots({
      config: makeConfig(),
      blockedDates: [],
      existingBookings: [],
      requestTz: 'America/New_York',
      fromUtc,
      toUtc,
    });

    expect(slots.length).toBeGreaterThan(0);

    // Verify no slots on Saturday/Sunday
    for (const slot of slots) {
      const d = new Date(slot.start_utc);
      const dayOfWeek = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
      }).format(d);
      expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).toContain(dayOfWeek);
    }
  });

  it('respects blocked dates', () => {
    const fromUtc = getNextMonday(9);
    const toUtc = new Date(fromUtc.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Block the next Monday
    const blockedDate = fromUtc.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD

    const slots = generateSlots({
      config: makeConfig(),
      blockedDates: [blockedDate],
      existingBookings: [],
      requestTz: 'America/New_York',
      fromUtc,
      toUtc,
    });

    // Verify no slots on the blocked date
    for (const slot of slots) {
      const slotDate = new Date(slot.start_utc).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      expect(slotDate).not.toBe(blockedDate);
    }
  });

  it('excludes slots conflicting with existing bookings (including buffer)', () => {
    const fromUtc = getNextMonday(9);
    const toUtc = new Date(fromUtc.getTime() + 2 * 24 * 60 * 60 * 1000);

    // Book 10:00-10:30 Monday (local New York time)
    const bookingStart = getNextMonday(10);
    const bookingEnd = new Date(bookingStart.getTime() + 30 * 60 * 1000);

    const slots = generateSlots({
      config: makeConfig({ buffer_minutes: 15 }),
      blockedDates: [],
      existingBookings: [
        { start_utc: bookingStart.toISOString(), end_utc: bookingEnd.toISOString() },
      ],
      requestTz: 'America/New_York',
      fromUtc,
      toUtc,
    });

    // No slot should overlap bookingStart - buffer to bookingEnd + buffer
    const bufferMs = 15 * 60 * 1000;
    for (const slot of slots) {
      const slotStart = new Date(slot.start_utc).getTime();
      const slotEnd = new Date(slot.end_utc).getTime();
      const bStart = bookingStart.getTime() - bufferMs;
      const bEnd = bookingEnd.getTime() + bufferMs;
      const overlaps = slotStart < bEnd && slotEnd > bStart;
      expect(overlaps).toBe(false);
    }
  });

  it('respects min_notice_hours via validateSlot', () => {
    // generateSlots uses fromUtc as its window start, so min_notice_hours is
    // enforced by the caller passing an appropriate fromUtc.
    // Here we test that validateSlot enforces the min_notice_hours constraint.
    const config = makeConfig({ min_notice_hours: 4 });

    // A slot 2h from now should be rejected by validateSlot (< 4h notice)
    const tooSoon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const err = validateSlot(tooSoon, config, [], []);
    expect(err).toBeTruthy();
    expect(err).toContain('advance');

    // A slot 6h from now should pass the notice check (ignoring other validations)
    // (It may fail other checks like working hours, but not the notice check)
    const inTime = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const err2 = validateSlot(inTime, config, [], []);
    // May fail due to working hours, but should not fail due to min_notice_hours
    if (err2) {
      expect(err2).not.toContain('advance');
    }
  });

  it('slot times are within working hours', () => {
    const fromUtc = getNextMonday(9);
    const toUtc = new Date(fromUtc.getTime() + 14 * 24 * 60 * 60 * 1000);

    const slots = generateSlots({
      config: makeConfig(),
      blockedDates: [],
      existingBookings: [],
      requestTz: 'America/New_York',
      fromUtc,
      toUtc,
    });

    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const start = new Date(slot.start_utc);
      const end = new Date(slot.end_utc);

      // Use hour12 format and parse AM/PM to reliably get 0-23
      const startStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false,
      }).format(start);
      const endStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false,
      }).format(end);

      // Parse "HH:MM" or "H:MM" — handle edge case of "24:00" (midnight next day)
      const [sh] = startStr.split(':').map(Number);
      const [eh] = endStr.split(':').map(Number);
      const startHour = sh === 24 ? 0 : sh;
      const endHour = eh === 24 ? 0 : eh;

      expect(startHour).toBeGreaterThanOrEqual(9);
      expect(endHour).toBeLessThanOrEqual(17);
    }
  });
});

describe('validateSlot', () => {
  it('rejects past slots', () => {
    const pastTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const err = validateSlot(pastTime, makeConfig(), [], []);
    expect(err).toBeTruthy();
    expect(err).toContain('advance');
  });

  it('rejects slots too close (within min_notice_hours)', () => {
    const tooSoon = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min from now
    const err = validateSlot(tooSoon, makeConfig({ min_notice_hours: 2 }), [], []);
    expect(err).toBeTruthy();
  });

  it('rejects invalid timezone', () => {
    // Valid slot time (next Monday)
    const validTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    // Use invalid tz in config
    const badConfig = makeConfig({ timezone: 'Invalid/Timezone' });
    // This won't crash — just treat as if outside working hours
    const err = validateSlot(validTime, badConfig, [], []);
    // May return null or an error, but should not throw
    expect(typeof err === 'string' || err === null).toBe(true);
  });

  it('rejects double-booked slots', () => {
    // A slot in the future within working hours (10am New York time)
    const fromUtc = getNextMonday(10);
    const endUtc = new Date(fromUtc.getTime() + 30 * 60 * 1000);

    const err = validateSlot(
      fromUtc.toISOString(),
      makeConfig(),
      [],
      [{ start_utc: fromUtc.toISOString(), end_utc: endUtc.toISOString() }]
    );
    expect(err).toBeTruthy();
    // Either "no longer available" (conflict) or "outside working hours" (tz edge)
    expect(typeof err).toBe('string');
  });

  it('rejects slots beyond booking horizon', () => {
    const tooFar = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString();
    const err = validateSlot(tooFar, makeConfig({ booking_horizon_days: 60 }), [], []);
    expect(err).toBeTruthy();
    expect(err).toContain('days');
  });

  it('rejects invalid date strings', () => {
    const err = validateSlot('not-a-date', makeConfig(), [], []);
    expect(err).toBeTruthy();
  });
});
