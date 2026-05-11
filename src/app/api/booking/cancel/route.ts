/**
 * POST /api/booking/cancel
 * Cancel a booking via token.
 *
 * Body: { token: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getBookingByCancelToken,
  cancelBooking,
} from '@/lib/booking/db';
import { sendBookingEmail, buildCancellationEmail } from '@/lib/booking/email';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const token = typeof (body as Record<string, unknown>)?.token === 'string'
    ? ((body as Record<string, unknown>).token as string).slice(0, 128)
    : null;

  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'Invalid cancel token' }, { status: 400 });
  }

  const booking = getBookingByCancelToken(token);
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'Booking is already cancelled' }, { status: 409 });
  }

  if (booking.cancel_token_used === 1) {
    return NextResponse.json({ error: 'Cancel token already used' }, { status: 409 });
  }

  // Atomic cancel
  const cancelled = cancelBooking(booking.id);
  if (!cancelled) {
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 });
  }

  const hostName = process.env.BOOKING_HOST_NAME ?? 'Your host';

  // Notify guest (non-blocking)
  sendBookingEmail(buildCancellationEmail(cancelled, hostName)).catch(err => {
    console.error('[api/booking/cancel] Email failed:', err);
  });

  return NextResponse.json({ ok: true, booking_id: cancelled.id });
}
