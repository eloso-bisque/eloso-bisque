import { describe, it, expect } from 'vitest';
import {
  generateICS,
  googleCalendarLink,
  buildGuestConfirmationEmail,
  buildHostConfirmationEmail,
  buildReminderEmail,
  buildCancellationEmail,
} from '../email';
import type { Booking } from '../types';

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const now = new Date();
  const start = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
  return {
    id: 'test-booking-id',
    guest_name: 'Alice Test',
    guest_email: 'alice@example.com',
    guest_notes: 'Some notes',
    start_utc: start,
    end_utc: end,
    duration_minutes: 30,
    timezone: 'America/New_York',
    status: 'confirmed',
    cancel_token: 'a'.repeat(64),
    reschedule_token: 'b'.repeat(64),
    cancel_token_used: 0,
    reschedule_token_used: 0,
    reminder_24h_sent: 0,
    reminder_1h_sent: 0,
    kissinger_contact_id: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  };
}

describe('generateICS', () => {
  it('produces valid ICS format', () => {
    const booking = makeBooking();
    const ics = generateICS(booking, 'host@example.com');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('DTSTART:');
    expect(ics).toContain('DTEND:');
  });

  it('includes guest email as attendee', () => {
    const booking = makeBooking({ guest_email: 'guest@example.com' });
    const ics = generateICS(booking, 'host@example.com');
    expect(ics).toContain('guest@example.com');
  });

  it('does not contain literal hyphens in datetime (ICS format)', () => {
    const booking = makeBooking();
    const ics = generateICS(booking, 'host@example.com');
    // ICS datetimes should be like 20260512T140000Z not 2026-05-12T14:00:00Z
    const dtLines = ics.split('\r\n').filter(l => l.startsWith('DTSTART:') || l.startsWith('DTEND:'));
    for (const line of dtLines) {
      expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe('googleCalendarLink', () => {
  it('generates a valid Google Calendar URL', () => {
    const booking = makeBooking();
    const link = googleCalendarLink(booking);
    expect(link).toContain('calendar.google.com');
    expect(link).toContain('action=TEMPLATE');
    expect(link).toContain('dates=');
  });

  it('URL-encodes the event title', () => {
    const booking = makeBooking({ guest_name: 'O\'Brien & Smith' });
    const link = googleCalendarLink(booking);
    // encodeURIComponent encodes & as %26 but leaves ' as %27
    expect(link).toContain('%26'); // & should be encoded
  });
});

describe('buildGuestConfirmationEmail', () => {
  it('addresses guest by name', () => {
    const booking = makeBooking({ guest_name: 'Bob Jones' });
    const email = buildGuestConfirmationEmail(booking, '/cancel/tok', '/reschedule/tok', 'Host Name');
    expect(email.text).toContain('Bob Jones');
    expect(email.html).toContain('Bob Jones');
  });

  it('includes cancel and reschedule links', () => {
    const booking = makeBooking();
    const email = buildGuestConfirmationEmail(booking, '/cancel/tok123', '/reschedule/tok456', 'Host');
    expect(email.text).toContain('/cancel/tok123');
    expect(email.text).toContain('/reschedule/tok456');
  });

  it('includes Google Calendar deep link', () => {
    const booking = makeBooking();
    const email = buildGuestConfirmationEmail(booking, '/cancel/tok', '/reschedule/tok', 'Host');
    expect(email.text).toContain('calendar.google.com');
  });

  it('sends to guest email address', () => {
    const booking = makeBooking({ guest_email: 'guest@test.com' });
    const email = buildGuestConfirmationEmail(booking, '/c', '/r', 'Host');
    expect(email.to).toBe('guest@test.com');
  });
});

describe('buildHostConfirmationEmail', () => {
  it('includes ICS attachment', () => {
    const booking = makeBooking();
    const ics = generateICS(booking, 'host@example.com');
    const email = buildHostConfirmationEmail(booking, '/c', '/r', 'host@example.com', 'Host', ics);
    expect(email.icsAttachment).toBe(ics);
  });

  it('includes guest details in email body', () => {
    const booking = makeBooking({ guest_name: 'Carol Test', guest_email: 'carol@example.com', guest_notes: 'Important note' });
    const ics = generateICS(booking, 'host@example.com');
    const email = buildHostConfirmationEmail(booking, '/c', '/r', 'host@example.com', 'Host', ics);
    expect(email.text).toContain('Carol Test');
    expect(email.text).toContain('carol@example.com');
    expect(email.text).toContain('Important note');
  });
});

describe('buildReminderEmail', () => {
  it('sends 24h reminder with correct label', () => {
    const booking = makeBooking();
    const email = buildReminderEmail(booking, '24h', 'Host');
    expect(email.subject).toContain('24 hours');
    expect(email.text).toContain('24 hours');
  });

  it('sends 1h reminder with correct label', () => {
    const booking = makeBooking();
    const email = buildReminderEmail(booking, '1h', 'Host');
    expect(email.subject).toContain('1 hour');
  });
});

describe('buildCancellationEmail', () => {
  it('notifies guest of cancellation', () => {
    const booking = makeBooking({ guest_name: 'Dave C' });
    const email = buildCancellationEmail(booking, 'Host');
    expect(email.to).toBe(booking.guest_email);
    expect(email.text).toContain('cancelled');
    expect(email.text).toContain('Dave C');
  });
});
