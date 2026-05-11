/**
 * GET /api/cron/reminders
 * Vercel Cron job — runs every 15 minutes.
 * Sends 24h and 1h reminder emails for upcoming bookings.
 * Idempotent: checks sent flags before sending.
 *
 * Protected by CRON_SECRET header (set in vercel.json).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBookingsNeedingReminders, markReminderSent } from '@/lib/booking/db';
import { sendBookingEmail, buildReminderEmail } from '@/lib/booking/email';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = request.headers.get('Authorization');
    if (!provided || provided !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const hostName = process.env.BOOKING_HOST_NAME ?? 'Your host';
  const bookings = getBookingsNeedingReminders();

  const results: { id: string; type: '24h' | '1h'; ok: boolean }[] = [];
  const now = new Date();

  for (const booking of bookings) {
    const startMs = new Date(booking.start_utc).getTime();
    const diffMs = startMs - now.getTime();
    const diffHours = diffMs / (60 * 60 * 1000);

    // 24h reminder: booking is 23–25h away and flag not set
    if (booking.reminder_24h_sent === 0 && diffHours >= 23 && diffHours <= 25) {
      const result = await sendBookingEmail(buildReminderEmail(booking, '24h', hostName));
      if (result.ok) {
        markReminderSent(booking.id, '24h');
      }
      results.push({ id: booking.id, type: '24h', ok: result.ok });
    }

    // 1h reminder: booking is 0–2h away and flag not set
    if (booking.reminder_1h_sent === 0 && diffHours >= 0 && diffHours <= 2) {
      const result = await sendBookingEmail(buildReminderEmail(booking, '1h', hostName));
      if (result.ok) {
        markReminderSent(booking.id, '1h');
      }
      results.push({ id: booking.id, type: '1h', ok: result.ok });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
    ts: new Date().toISOString(),
  });
}
