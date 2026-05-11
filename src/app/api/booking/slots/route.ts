/**
 * GET /api/booking/slots
 * Returns available booking slots.
 *
 * Query params:
 *   tz       - IANA timezone for display (default: UTC)
 *   days     - number of days to look ahead (default: 14, max: 60)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAvailabilityConfig, getBlockedDates, listUpcomingBookings } from '@/lib/booking/db';
import { generateSlots } from '@/lib/booking/slots';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tz = searchParams.get('tz') ?? 'UTC';
    const daysParam = parseInt(searchParams.get('days') ?? '14', 10);
    const days = isNaN(daysParam) ? 14 : Math.min(Math.max(1, daysParam), 60);

    // Validate timezone
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }

    const config = getAvailabilityConfig();
    const blockedDates = getBlockedDates();
    const existingBookings = listUpcomingBookings();

    const fromUtc = new Date(Date.now() + config.min_notice_hours * 60 * 60 * 1000);
    const toUtc = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const slots = generateSlots({
      config,
      blockedDates,
      existingBookings,
      requestTz: tz,
      fromUtc,
      toUtc,
    });

    return NextResponse.json({ slots, config: { slot_duration_minutes: config.slot_duration_minutes } });
  } catch (err) {
    console.error('[api/booking/slots]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
