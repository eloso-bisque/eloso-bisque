/**
 * POST /api/booking/reschedule
 * Reschedule a booking via token.
 *
 * Body: { token: string, start_utc: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getBookingByRescheduleToken,
  rescheduleBooking,
  getAvailabilityConfig,
  getBlockedDates,
  listUpcomingBookings,
  getConflictingBookings,
} from '@/lib/booking/db';
import { validateSlot } from '@/lib/booking/slots';
import {
  sendBookingEmail,
  buildGuestConfirmationEmail,
  buildHostConfirmationEmail,
  generateICS,
} from '@/lib/booking/email';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const token = typeof raw.token === 'string' ? raw.token.slice(0, 128) : null;
  const start_utc = typeof raw.start_utc === 'string' ? raw.start_utc.slice(0, 50) : null;

  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'Invalid reschedule token' }, { status: 400 });
  }
  if (!start_utc) {
    return NextResponse.json({ error: 'start_utc is required' }, { status: 400 });
  }

  const startDate = new Date(start_utc);
  if (isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid start_utc' }, { status: 400 });
  }

  const booking = getBookingByRescheduleToken(token);
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'Cannot reschedule a cancelled booking' }, { status: 409 });
  }

  if (booking.reschedule_token_used === 1) {
    return NextResponse.json({ error: 'Reschedule token already used' }, { status: 409 });
  }

  // Validate start is in the past
  if (startDate <= new Date()) {
    return NextResponse.json({ error: 'Cannot reschedule to a past time' }, { status: 400 });
  }

  const config = getAvailabilityConfig();
  const blockedDates = getBlockedDates();
  const existingBookings = listUpcomingBookings().filter(b => b.id !== booking.id);

  const slotError = validateSlot(start_utc, config, blockedDates, existingBookings);
  if (slotError) {
    return NextResponse.json({ error: slotError }, { status: 409 });
  }

  const endDate = new Date(startDate.getTime() + config.slot_duration_minutes * 60 * 1000);

  // Check race condition conflicts (exclude self)
  const conflicts = getConflictingBookings(start_utc, endDate.toISOString(), booking.id);
  if (conflicts.length > 0) {
    return NextResponse.json({ error: 'This time slot is no longer available' }, { status: 409 });
  }

  const rescheduled = rescheduleBooking(booking.id, start_utc, endDate.toISOString());
  if (!rescheduled) {
    return NextResponse.json({ error: 'Failed to reschedule booking' }, { status: 500 });
  }

  // Send updated confirmations
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://eloso-bisque.vercel.app';
  const cancelUrl = `${baseUrl}/cancel/${rescheduled.cancel_token}`;
  const rescheduleUrl = `${baseUrl}/reschedule/${rescheduled.reschedule_token}`;
  const hostEmail = process.env.BOOKING_HOST_EMAIL ?? '';
  const hostName = process.env.BOOKING_HOST_NAME ?? 'Your host';

  const icsContent = generateICS(rescheduled, hostEmail);

  Promise.allSettled([
    sendBookingEmail(buildGuestConfirmationEmail(rescheduled, cancelUrl, rescheduleUrl, hostName)),
    hostEmail
      ? sendBookingEmail(buildHostConfirmationEmail(rescheduled, cancelUrl, rescheduleUrl, hostEmail, hostName, icsContent))
      : Promise.resolve({ ok: true }),
  ]);

  return NextResponse.json({
    ok: true,
    booking_id: rescheduled.id,
    start_utc: rescheduled.start_utc,
    end_utc: rescheduled.end_utc,
  });
}
