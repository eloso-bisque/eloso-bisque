/**
 * Core types for bisque-booking.
 */

export type BookingStatus = 'confirmed' | 'cancelled' | 'rescheduled';

export interface Booking {
  id: string;
  guest_name: string;
  guest_email: string;
  guest_notes: string;
  start_utc: string;      // ISO-8601 UTC
  end_utc: string;        // ISO-8601 UTC
  duration_minutes: number;
  timezone: string;
  status: BookingStatus;
  cancel_token: string;
  reschedule_token: string;
  cancel_token_used: 0 | 1;
  reschedule_token_used: 0 | 1;
  reminder_24h_sent: 0 | 1;
  reminder_1h_sent: 0 | 1;
  kissinger_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityConfig {
  id: 1;
  working_days: string[];   // parsed from JSON: ["Mon","Tue","Wed","Thu","Fri"]
  start_time: string;       // "09:00"
  end_time: string;         // "17:00"
  slot_duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  booking_horizon_days: number;
  min_notice_hours: number;
  updated_at: string;
}

export interface TimeSlot {
  start_utc: string;  // ISO-8601 UTC
  end_utc: string;
  start_local: string; // formatted in requested tz
  end_local: string;
  duration_minutes: number;
}

export interface CreateBookingInput {
  guest_name: string;
  guest_email: string;
  guest_notes?: string;
  start_utc: string;
  timezone: string;
  duration_minutes?: number;
}

/** BookingConfirmed event contract — emitted to Kissinger integration seam. */
export interface BookingConfirmedEvent {
  booking_id: string;
  guest_name: string;
  guest_email: string;
  start_utc: string;
  end_utc: string;
  duration_minutes: number;
  timezone: string;
}
