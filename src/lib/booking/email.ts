/**
 * Email adapter for bisque-booking.
 * Pluggable via EMAIL_PROVIDER env var: "resend" (default) | "smtp" | "none"
 *
 * Failures never block the booking — always catch and log.
 */

import type { Booking } from './types';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  icsAttachment?: string;  // ICS file content
}

// ---------------------------------------------------------------------------
// ICS generation
// ---------------------------------------------------------------------------

function toICSDate(isoString: string): string {
  return isoString.replace(/[-:]/g, '').replace('.000Z', 'Z');
}

export function generateICS(booking: Booking, hostEmail: string): string {
  const uid = `${booking.id}@bisque-booking`;
  const dtStamp = toICSDate(new Date().toISOString());
  const dtStart = toICSDate(booking.start_utc);
  const dtEnd = toICSDate(booking.end_utc);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//bisque-booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:Meeting with ${booking.guest_name}`,
    `DESCRIPTION:Booking ID: ${booking.id}`,
    `ORGANIZER:mailto:${hostEmail}`,
    `ATTENDEE;RSVP=TRUE:mailto:${booking.guest_email}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Google Calendar deep link
// ---------------------------------------------------------------------------

export function googleCalendarLink(booking: Booking): string {
  const title = encodeURIComponent(`Meeting with ${booking.guest_name}`);
  const start = booking.start_utc.replace(/[-:]/g, '').replace('.000Z', 'Z');
  const end = booking.end_utc.replace(/[-:]/g, '').replace('.000Z', 'Z');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}`;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function formatDatetime(isoString: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(isoString));
}

export function buildGuestConfirmationEmail(
  booking: Booking,
  cancelUrl: string,
  rescheduleUrl: string,
  hostName: string
): EmailPayload {
  const datetime = formatDatetime(booking.start_utc, booking.timezone);
  const gcalLink = googleCalendarLink(booking);

  const subject = `Booking confirmed: ${datetime}`;
  const text = [
    `Hi ${booking.guest_name},`,
    '',
    `Your meeting with ${hostName} is confirmed.`,
    '',
    `When: ${datetime}`,
    `Duration: ${booking.duration_minutes} minutes`,
    '',
    `Add to Google Calendar: ${gcalLink}`,
    '',
    `Cancel: ${cancelUrl}`,
    `Reschedule: ${rescheduleUrl}`,
    '',
    'Looking forward to connecting!',
  ].join('\n');

  const html = `
    <p>Hi ${booking.guest_name},</p>
    <p>Your meeting with <strong>${hostName}</strong> is confirmed.</p>
    <p><strong>When:</strong> ${datetime}<br>
    <strong>Duration:</strong> ${booking.duration_minutes} minutes</p>
    <p><a href="${gcalLink}">Add to Google Calendar</a></p>
    <p>
      <a href="${cancelUrl}">Cancel this booking</a> |
      <a href="${rescheduleUrl}">Reschedule</a>
    </p>
  `;

  return { to: booking.guest_email, subject, text, html };
}

export function buildHostConfirmationEmail(
  booking: Booking,
  cancelUrl: string,
  rescheduleUrl: string,
  hostEmail: string,
  hostName: string,
  icsContent: string
): EmailPayload {
  const datetime = formatDatetime(booking.start_utc, booking.timezone);
  const gcalLink = googleCalendarLink(booking);

  const subject = `New booking: ${booking.guest_name} — ${datetime}`;
  const text = [
    `New booking received.`,
    '',
    `Guest: ${booking.guest_name} <${booking.guest_email}>`,
    `When: ${datetime}`,
    `Duration: ${booking.duration_minutes} minutes`,
    booking.guest_notes ? `Notes: ${booking.guest_notes}` : '',
    '',
    `Add to Google Calendar: ${gcalLink}`,
    '',
    `Cancel: ${cancelUrl}`,
    `Reschedule: ${rescheduleUrl}`,
  ].filter(Boolean).join('\n');

  const html = `
    <p><strong>New booking received.</strong></p>
    <p><strong>Guest:</strong> ${booking.guest_name} &lt;${booking.guest_email}&gt;<br>
    <strong>When:</strong> ${datetime}<br>
    <strong>Duration:</strong> ${booking.duration_minutes} minutes</p>
    ${booking.guest_notes ? `<p><strong>Notes:</strong> ${booking.guest_notes}</p>` : ''}
    <p><a href="${gcalLink}">Add to Google Calendar</a></p>
    <p>
      <a href="${cancelUrl}">Cancel this booking</a> |
      <a href="${rescheduleUrl}">Reschedule</a>
    </p>
  `;

  return { to: hostEmail, subject, text, html, icsAttachment: icsContent };
}

export function buildReminderEmail(booking: Booking, which: '24h' | '1h', hostName: string): EmailPayload {
  const datetime = formatDatetime(booking.start_utc, booking.timezone);
  const label = which === '24h' ? '24 hours' : '1 hour';

  return {
    to: booking.guest_email,
    subject: `Reminder: Your meeting with ${hostName} is in ${label}`,
    text: `Hi ${booking.guest_name},\n\nJust a reminder — your meeting with ${hostName} is in ${label}.\n\nWhen: ${datetime}`,
    html: `<p>Hi ${booking.guest_name},</p><p>Just a reminder — your meeting with <strong>${hostName}</strong> is in ${label}.</p><p><strong>When:</strong> ${datetime}</p>`,
  };
}

export function buildCancellationEmail(booking: Booking, hostName: string): EmailPayload {
  const datetime = formatDatetime(booking.start_utc, booking.timezone);
  return {
    to: booking.guest_email,
    subject: `Booking cancelled: ${datetime}`,
    text: `Hi ${booking.guest_name},\n\nYour booking with ${hostName} on ${datetime} has been cancelled.\n\nIf this was a mistake, please rebook at our booking page.`,
    html: `<p>Hi ${booking.guest_name},</p><p>Your booking with <strong>${hostName}</strong> on ${datetime} has been cancelled.</p>`,
  };
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

async function sendViaResend(payload: EmailPayload): Promise<void> {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromEmail = process.env.BOOKING_FROM_EMAIL ?? 'noreply@example.com';

  await resend.emails.send({
    from: fromEmail,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.icsAttachment
      ? [{ filename: 'invite.ics', content: Buffer.from(payload.icsAttachment).toString('base64') }]
      : undefined,
  });
}

// ---------------------------------------------------------------------------
// Public send function — never throws
// ---------------------------------------------------------------------------

export async function sendBookingEmail(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
  const provider = process.env.EMAIL_PROVIDER ?? 'resend';

  try {
    if (provider === 'none') {
      console.log('[bisque-booking] Email suppressed (EMAIL_PROVIDER=none):', payload.subject, '->', payload.to);
      return { ok: true };
    }

    if (provider === 'resend') {
      if (!process.env.RESEND_API_KEY) {
        console.warn('[bisque-booking] RESEND_API_KEY not set, skipping email');
        return { ok: false, error: 'RESEND_API_KEY not configured' };
      }
      await sendViaResend(payload);
      return { ok: true };
    }

    console.warn(`[bisque-booking] Unknown EMAIL_PROVIDER: ${provider}`);
    return { ok: false, error: `Unknown EMAIL_PROVIDER: ${provider}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[bisque-booking] Email send failed:', message);
    return { ok: false, error: message };
  }
}
