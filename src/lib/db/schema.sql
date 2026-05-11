-- bisque-booking SQLite schema
-- All timestamps stored as UTC ISO-8601 strings

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,                          -- UUID v4
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_notes TEXT NOT NULL DEFAULT '',
  start_utc TEXT NOT NULL,                      -- ISO-8601 UTC
  end_utc TEXT NOT NULL,                        -- ISO-8601 UTC
  duration_minutes INTEGER NOT NULL,
  timezone TEXT NOT NULL,                       -- IANA tz, e.g. "America/New_York"
  status TEXT NOT NULL DEFAULT 'confirmed',     -- confirmed | cancelled | rescheduled
  cancel_token TEXT NOT NULL,                   -- 32-byte random hex, single-use
  reschedule_token TEXT NOT NULL,               -- 32-byte random hex, single-use
  cancel_token_used INTEGER NOT NULL DEFAULT 0, -- 0 | 1 boolean
  reschedule_token_used INTEGER NOT NULL DEFAULT 0,
  reminder_24h_sent INTEGER NOT NULL DEFAULT 0,
  reminder_1h_sent INTEGER NOT NULL DEFAULT 0,
  kissinger_contact_id TEXT,                    -- nullable; set after Kissinger upsert
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_utc);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_cancel_token ON bookings(cancel_token);
CREATE INDEX IF NOT EXISTS idx_bookings_reschedule_token ON bookings(reschedule_token);
CREATE INDEX IF NOT EXISTS idx_bookings_reminders ON bookings(status, start_utc, reminder_24h_sent, reminder_1h_sent);

CREATE TABLE IF NOT EXISTS availability_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  working_days TEXT NOT NULL DEFAULT '["Mon","Tue","Wed","Thu","Fri"]', -- JSON array
  start_time TEXT NOT NULL DEFAULT '09:00',  -- HH:MM in host's local tz
  end_time TEXT NOT NULL DEFAULT '17:00',
  slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_minutes INTEGER NOT NULL DEFAULT 15,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  booking_horizon_days INTEGER NOT NULL DEFAULT 60,
  min_notice_hours INTEGER NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default config if not exists
INSERT OR IGNORE INTO availability_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id TEXT PRIMARY KEY,  -- UUID v4
  date TEXT NOT NULL,   -- YYYY-MM-DD
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(date);
