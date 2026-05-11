/**
 * POST /api/booking/create
 * Creates a new booking (public endpoint — no auth required).
 *
 * Body:
 *   guest_name    string (required)
 *   guest_email   string (required)
 *   guest_notes   string (optional)
 *   start_utc     string ISO-8601 UTC (required)
 *   timezone      IANA tz for display in emails (required)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAvailabilityConfig,
  getBlockedDates,
  listUpcomingBookings,
  createBooking,
  getConflictingBookings,
  setKissingerContactId,
} from '@/lib/booking/db';
import { validateSlot } from '@/lib/booking/slots';
import {
  sendBookingEmail,
  buildGuestConfirmationEmail,
  buildHostConfirmationEmail,
  generateICS,
} from '@/lib/booking/email';
import { syncBookingToKissinger } from '@/lib/booking/kissinger-adapter';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeString(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') return '';
  // Strip HTML tags and control characters
  return s.replace(/<[^>]*>/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen).trim();
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Sanitize inputs (XSS protection)
  const guest_name = sanitizeString(raw.guest_name, 200);
  const guest_email = sanitizeString(raw.guest_email, 300);
  const guest_notes = sanitizeString(raw.guest_notes, 2000);
  const start_utc = sanitizeString(raw.start_utc, 50);
  const timezone = sanitizeString(raw.timezone, 100);

  // Validate required fields
  if (!guest_name) {
    return NextResponse.json({ error: 'guest_name is required' }, { status: 400 });
  }
  if (!guest_email || !EMAIL_PATTERN.test(guest_email)) {
    return NextResponse.json({ error: 'Valid guest_email is required' }, { status: 400 });
  }
  if (!start_utc) {
    return NextResponse.json({ error: 'start_utc is required' }, { status: 400 });
  }
  if (!timezone) {
    return NextResponse.json({ error: 'timezone is required' }, { status: 400 });
  }

  // Validate timezone
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }

  // Validate start_utc is a valid date
  const startDate = new Date(start_utc);
  if (isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'Invalid start_utc' }, { status: 400 });
  }

  const config = getAvailabilityConfig();
  const blockedDates = getBlockedDates();
  const existingBookings = listUpcomingBookings();

  // Validate slot
  const slotError = validateSlot(start_utc, config, blockedDates, existingBookings);
  if (slotError) {
    return NextResponse.json({ error: slotError }, { status: 409 });
  }

  const endDate = new Date(startDate.getTime() + config.slot_duration_minutes * 60 * 1000);

  // Double-check for race condition conflicts
  const conflicts = getConflictingBookings(start_utc, endDate.toISOString());
  if (conflicts.length > 0) {
    return NextResponse.json({ error: 'This time slot is no longer available' }, { status: 409 });
  }

  // Generate tokens (32-byte = 64 hex chars)
  const cancel_token = crypto.getRandomValues(new Uint8Array(32))
    .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '');
  const reschedule_token = crypto.getRandomValues(new Uint8Array(32))
    .reduce((acc, b) => acc + b.toString(16).padStart(2, '0'), '');

  const booking = createBooking({
    id: crypto.randomUUID(),
    guest_name,
    guest_email,
    guest_notes,
    start_utc,
    end_utc: endDate.toISOString(),
    duration_minutes: config.slot_duration_minutes,
    timezone,
    cancel_token,
    reschedule_token,
  });

  // Build confirmation URLs
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://eloso-bisque.vercel.app';
  const cancelUrl = `${baseUrl}/cancel/${cancel_token}`;
  const rescheduleUrl = `${baseUrl}/reschedule/${reschedule_token}`;

  const hostEmail = process.env.BOOKING_HOST_EMAIL ?? '';
  const hostName = process.env.BOOKING_HOST_NAME ?? 'Your host';

  // Send confirmation emails (non-blocking — failures don't affect response)
  const icsContent = generateICS(booking, hostEmail);

  const guestEmailPromise = sendBookingEmail(
    buildGuestConfirmationEmail(booking, cancelUrl, rescheduleUrl, hostName)
  );

  const hostEmailPromise = hostEmail
    ? sendBookingEmail(
        buildHostConfirmationEmail(booking, cancelUrl, rescheduleUrl, hostEmail, hostName, icsContent)
      )
    : Promise.resolve({ ok: true });

  // Fire-and-forget Kissinger sync
  syncBookingToKissinger({
    booking_id: booking.id,
    guest_name: booking.guest_name,
    guest_email: booking.guest_email,
    start_utc: booking.start_utc,
    end_utc: booking.end_utc,
    duration_minutes: booking.duration_minutes,
    timezone: booking.timezone,
  }).then(contactId => {
    if (contactId) {
      setKissingerContactId(booking.id, contactId);
    }
  });

  // Wait for emails (but don't fail booking if they fail)
  await Promise.allSettled([guestEmailPromise, hostEmailPromise]);

  return NextResponse.json({
    ok: true,
    booking_id: booking.id,
    start_utc: booking.start_utc,
    end_utc: booking.end_utc,
    duration_minutes: booking.duration_minutes,
    confirmed_at: booking.created_at,
  }, { status: 201 });
}
