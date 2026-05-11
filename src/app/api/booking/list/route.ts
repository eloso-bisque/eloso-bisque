/**
 * GET /api/booking/list (admin, authenticated)
 * Returns upcoming and past bookings.
 *
 * Query params:
 *   view = "upcoming" | "past" | "all"  (default: upcoming)
 *   limit = number (default: 50)
 */

import { NextRequest, NextResponse } from 'next/server';
import { listUpcomingBookings, listPastBookings, listBookings } from '@/lib/booking/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const view = searchParams.get('view') ?? 'upcoming';
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);

    let bookings;
    if (view === 'past') {
      bookings = listPastBookings(limit);
    } else if (view === 'all') {
      bookings = listBookings(undefined, limit);
    } else {
      bookings = listUpcomingBookings();
    }

    return NextResponse.json({ bookings, count: bookings.length });
  } catch (err) {
    console.error('[api/booking/list]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
