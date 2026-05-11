/**
 * GET  /api/availability — returns current availability config + blocked dates
 * PUT  /api/availability — update availability config (admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAvailabilityConfig,
  updateAvailabilityConfig,
  getBlockedDates,
  addBlockedDate,
  removeBlockedDate,
} from '@/lib/booking/db';

const VALID_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export async function GET() {
  try {
    const config = getAvailabilityConfig();
    const blocked_dates = getBlockedDates();
    return NextResponse.json({ config, blocked_dates });
  } catch (err) {
    console.error('[api/availability GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Validate and build updates
  const updates: Parameters<typeof updateAvailabilityConfig>[0] = {};

  if (raw.working_days !== undefined) {
    if (!Array.isArray(raw.working_days) || !raw.working_days.every((d: unknown) => VALID_DAYS.includes(d as string))) {
      return NextResponse.json(
        { error: `working_days must be an array of: ${VALID_DAYS.join(', ')}` },
        { status: 400 }
      );
    }
    updates.working_days = raw.working_days as string[];
  }

  if (raw.start_time !== undefined) {
    if (typeof raw.start_time !== 'string' || !TIME_PATTERN.test(raw.start_time)) {
      return NextResponse.json({ error: 'start_time must be HH:MM' }, { status: 400 });
    }
    updates.start_time = raw.start_time;
  }

  if (raw.end_time !== undefined) {
    if (typeof raw.end_time !== 'string' || !TIME_PATTERN.test(raw.end_time)) {
      return NextResponse.json({ error: 'end_time must be HH:MM' }, { status: 400 });
    }
    updates.end_time = raw.end_time;
  }

  // Validate hour range ordering
  const start = updates.start_time ?? (await getAvailabilityConfig()).start_time;
  const end = updates.end_time ?? (await getAvailabilityConfig()).end_time;
  if (start >= end) {
    return NextResponse.json({ error: 'start_time must be before end_time' }, { status: 400 });
  }

  if (raw.slot_duration_minutes !== undefined) {
    const v = Number(raw.slot_duration_minutes);
    if (!Number.isInteger(v) || v < 15 || v > 480) {
      return NextResponse.json({ error: 'slot_duration_minutes must be 15–480' }, { status: 400 });
    }
    updates.slot_duration_minutes = v;
  }

  if (raw.buffer_minutes !== undefined) {
    const v = Number(raw.buffer_minutes);
    if (!Number.isInteger(v) || v < 0 || v > 120) {
      return NextResponse.json({ error: 'buffer_minutes must be 0–120' }, { status: 400 });
    }
    updates.buffer_minutes = v;
  }

  if (raw.timezone !== undefined) {
    if (typeof raw.timezone !== 'string') {
      return NextResponse.json({ error: 'timezone must be a string' }, { status: 400 });
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: raw.timezone });
      updates.timezone = raw.timezone;
    } catch {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }
  }

  if (raw.booking_horizon_days !== undefined) {
    const v = Number(raw.booking_horizon_days);
    if (!Number.isInteger(v) || v < 1 || v > 365) {
      return NextResponse.json({ error: 'booking_horizon_days must be 1–365' }, { status: 400 });
    }
    updates.booking_horizon_days = v;
  }

  if (raw.min_notice_hours !== undefined) {
    const v = Number(raw.min_notice_hours);
    if (!Number.isInteger(v) || v < 0 || v > 168) {
      return NextResponse.json({ error: 'min_notice_hours must be 0–168' }, { status: 400 });
    }
    updates.min_notice_hours = v;
  }

  // Handle blocked_dates operations
  if (raw.add_blocked_date !== undefined) {
    const date = String(raw.add_blocked_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
      return NextResponse.json({ error: 'add_blocked_date must be YYYY-MM-DD' }, { status: 400 });
    }
    addBlockedDate(date, typeof raw.blocked_date_reason === 'string' ? raw.blocked_date_reason : '');
  }

  if (raw.remove_blocked_date !== undefined) {
    const date = String(raw.remove_blocked_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'remove_blocked_date must be YYYY-MM-DD' }, { status: 400 });
    }
    removeBlockedDate(date);
  }

  const updated = updateAvailabilityConfig(updates);
  const blocked_dates = getBlockedDates();
  return NextResponse.json({ config: updated, blocked_dates });
}
