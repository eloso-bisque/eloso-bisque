/**
 * Slot generation algorithm for bisque-booking.
 * Timezone-aware, respects working hours, buffer, and existing bookings.
 */

import type { AvailabilityConfig, TimeSlot } from './types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Parse "HH:MM" into { hours, minutes }. */
function parseTime(t: string): { hours: number; minutes: number } {
  const [h, m] = t.split(':').map(Number);
  return { hours: h, minutes: m };
}

/**
 * Convert a UTC Date to local time components in the given IANA timezone.
 * Returns { year, month (1-12), day, dayName, hours, minutes }.
 */
function toLocalComponents(utcDate: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = Object.fromEntries(fmt.formatToParts(utcDate).map(p => [p.type, p.value]));
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    dayName: parts.weekday,           // 'Mon', 'Tue', etc.
    hours: parseInt(parts.hour),
    minutes: parseInt(parts.minute),
  };
}

/**
 * Build the UTC Date for a given local date + time in the host's timezone.
 * e.g. localDateStr = "2026-05-12", timeStr = "09:00", tz = "America/New_York"
 */
function localToUtc(localDateStr: string, timeStr: string, timezone: string): Date {
  // Strategy: treat the local hours as UTC first (approx), measure how far off
  // the Intl display is, then correct by adding the error.
  //
  // Example (EDT = UTC-4):
  //   We want 9am EDT. approx = 9am UTC.
  //   Intl shows approx as 5am EDT (9am UTC = 5am EDT).
  //   wantedMin = 9*60=540, gotMin=5*60=300, diff=240 min (4 hours)
  //   Correct UTC = approx + 240 min = 9am UTC + 4h = 1pm UTC ✓ (1pm UTC = 9am EDT)
  const [year, month, day] = localDateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  const approx = new Date(Date.UTC(year, month - 1, day, hours, minutes));

  const local = toLocalComponents(approx, timezone);

  const wantedMinutes = hours * 60 + minutes;
  const gotMinutes = local.hours * 60 + local.minutes;
  const diffMinutes = wantedMinutes - gotMinutes;

  // Add diff to correct: if we wanted 9am but got 5am, add 4h
  return new Date(approx.getTime() + diffMinutes * 60 * 1000);
}

/** Format a UTC date as local time string for display. */
function formatLocal(utcDate: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(utcDate);
}

/** Add minutes to a Date, returning a new Date. */
function addMinutes(d: Date, mins: number): Date {
  return new Date(d.getTime() + mins * 60 * 1000);
}

/** Format a Date as "YYYY-MM-DD". */
function toDateStr(d: Date, timezone: string): string {
  const { year, month, day } = toLocalComponents(d, timezone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface GenerateSlotsOptions {
  config: AvailabilityConfig;
  blockedDates: string[];        // ["YYYY-MM-DD", ...]
  existingBookings: { start_utc: string; end_utc: string }[];
  busyPeriods?: { start: string; end: string }[];  // from Google Calendar
  requestTz: string;             // IANA tz for display
  fromUtc?: Date;                // start of window (default: now + min_notice_hours)
  toUtc?: Date;                  // end of window (default: fromUtc + booking_horizon_days)
}

/**
 * Generate available time slots within the booking window.
 * Returns slots sorted ascending by start time.
 */
export function generateSlots(opts: GenerateSlotsOptions): TimeSlot[] {
  const {
    config,
    blockedDates,
    existingBookings,
    busyPeriods = [],
    requestTz,
  } = opts;

  const nowUtc = new Date();
  const minNoticeMs = config.min_notice_hours * 60 * 60 * 1000;
  const fromUtc = opts.fromUtc ?? new Date(nowUtc.getTime() + minNoticeMs);
  const toUtc = opts.toUtc ?? new Date(fromUtc.getTime() + config.booking_horizon_days * 24 * 60 * 60 * 1000);

  const blockedSet = new Set(blockedDates);
  const slots: TimeSlot[] = [];

  const workStart = parseTime(config.start_time);
  const workEnd = parseTime(config.end_time);
  const slotMin = config.slot_duration_minutes;
  const bufferMin = config.buffer_minutes;

  // Iterate day by day in the host timezone
  const hostTz = config.timezone;
  let cursor = new Date(fromUtc);
  // Round up to start of next slot boundary
  cursor = new Date(Math.ceil(cursor.getTime() / (slotMin * 60 * 1000)) * slotMin * 60 * 1000);

  // Safety: max 365 days forward
  const absoluteEnd = new Date(nowUtc.getTime() + 365 * 24 * 60 * 60 * 1000);
  const effectiveEnd = toUtc < absoluteEnd ? toUtc : absoluteEnd;

  while (cursor < effectiveEnd) {
    const localInfo = toLocalComponents(cursor, hostTz);
    const dateStr = toDateStr(cursor, hostTz);

    // Check if this day is a working day
    if (!config.working_days.includes(localInfo.dayName)) {
      // Skip to next calendar day in host timezone
      cursor = localToUtc(
        incrementDate(dateStr),
        config.start_time,
        hostTz
      );
      continue;
    }

    // Check if this date is blocked
    if (blockedSet.has(dateStr)) {
      cursor = localToUtc(incrementDate(dateStr), config.start_time, hostTz);
      continue;
    }

    // Build slot window for this day
    const dayStart = localToUtc(dateStr, config.start_time, hostTz);
    const dayEnd = localToUtc(dateStr, config.end_time, hostTz);

    // If cursor is before day start, jump to day start
    if (cursor < dayStart) {
      cursor = dayStart;
      continue;
    }

    // If cursor is past day end, go to next day
    if (cursor >= dayEnd) {
      cursor = localToUtc(incrementDate(dateStr), config.start_time, hostTz);
      continue;
    }

    const slotEnd = addMinutes(cursor, slotMin);

    // Slot must fit within working hours
    if (slotEnd > dayEnd) {
      cursor = localToUtc(incrementDate(dateStr), config.start_time, hostTz);
      continue;
    }

    // Skip if before the "from" window
    if (cursor < fromUtc) {
      cursor = addMinutes(cursor, slotMin);
      continue;
    }

    // Check conflicts with existing bookings (including buffer)
    const conflictsWithBooking = existingBookings.some(b => {
      const bStart = new Date(b.start_utc);
      const bEnd = new Date(b.end_utc);
      // Add buffer around existing booking
      const bStartWithBuffer = addMinutes(bStart, -bufferMin);
      const bEndWithBuffer = addMinutes(bEnd, bufferMin);
      return cursor < bEndWithBuffer && slotEnd > bStartWithBuffer;
    });

    if (conflictsWithBooking) {
      cursor = addMinutes(cursor, slotMin);
      continue;
    }

    // Check conflicts with Google Calendar busy periods
    const conflictsWithBusy = busyPeriods.some(b => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return cursor < bEnd && slotEnd > bStart;
    });

    if (conflictsWithBusy) {
      cursor = addMinutes(cursor, slotMin);
      continue;
    }

    // Slot is available
    slots.push({
      start_utc: cursor.toISOString(),
      end_utc: slotEnd.toISOString(),
      start_local: formatLocal(cursor, requestTz),
      end_local: formatLocal(slotEnd, requestTz),
      duration_minutes: slotMin,
    });

    cursor = addMinutes(cursor, slotMin);
  }

  return slots;
}

/** Add one calendar day to a YYYY-MM-DD string. */
function incrementDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC to avoid DST edge cases
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Validate that a requested start_utc is a valid bookable slot.
 * Returns an error string if invalid, or null if valid.
 */
export function validateSlot(
  startUtc: string,
  config: AvailabilityConfig,
  blockedDates: string[],
  existingBookings: { start_utc: string; end_utc: string }[],
  busyPeriods: { start: string; end: string }[] = []
): string | null {
  const start = new Date(startUtc);

  if (isNaN(start.getTime())) {
    return 'Invalid start time';
  }

  // Validate timezone early to avoid downstream throws
  try {
    Intl.DateTimeFormat(undefined, { timeZone: config.timezone });
  } catch {
    return 'Invalid host timezone configuration';
  }

  const now = new Date();
  const minNoticeMs = config.min_notice_hours * 60 * 60 * 1000;
  if (start.getTime() < now.getTime() + minNoticeMs) {
    return `Booking must be at least ${config.min_notice_hours} hour(s) in advance`;
  }

  const end = addMinutes(start, config.slot_duration_minutes);
  const horizon = new Date(now.getTime() + config.booking_horizon_days * 24 * 60 * 60 * 1000);
  if (start > horizon) {
    return `Cannot book more than ${config.booking_horizon_days} days in advance`;
  }

  const localInfo = toLocalComponents(start, config.timezone);
  if (!config.working_days.includes(localInfo.dayName)) {
    return 'Selected time is outside working days';
  }

  const dateStr = toDateStr(start, config.timezone);
  if (new Set(blockedDates).has(dateStr)) {
    return 'Selected date is blocked';
  }

  const dayStart = localToUtc(dateStr, config.start_time, config.timezone);
  const dayEnd = localToUtc(dateStr, config.end_time, config.timezone);

  if (start < dayStart || end > dayEnd) {
    return 'Selected time is outside working hours';
  }

  const conflictsWithBooking = existingBookings.some(b => {
    const bStart = new Date(b.start_utc);
    const bEnd = new Date(b.end_utc);
    const bufferMin = config.buffer_minutes;
    const bStartBuffered = addMinutes(bStart, -bufferMin);
    const bEndBuffered = addMinutes(bEnd, bufferMin);
    return start < bEndBuffered && end > bStartBuffered;
  });

  if (conflictsWithBooking) {
    return 'This time slot is no longer available';
  }

  const conflictsWithBusy = busyPeriods.some(b => {
    return start < new Date(b.end) && end > new Date(b.start);
  });

  if (conflictsWithBusy) {
    return 'This time slot conflicts with an existing appointment';
  }

  return null;
}
