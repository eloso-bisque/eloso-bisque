'use client';

import { useState, useEffect } from 'react';

interface AvailabilityConfig {
  id: number;
  working_days: string[];
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  booking_horizon_days: number;
  min_notice_hours: number;
  updated_at: string;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AvailabilityAdminPage() {
  const [config, setConfig] = useState<AvailabilityConfig | null>(null);
  const [blockedDates, setBlockedDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [newBlockedDate, setNewBlockedDate] = useState('');
  const [addingDate, setAddingDate] = useState(false);

  useEffect(() => {
    fetch('/api/availability')
      .then(r => r.json())
      .then((data: { config: AvailabilityConfig; blocked_dates: string[] }) => {
        setConfig(data.config);
        setBlockedDates(data.blocked_dates);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load configuration');
        setLoading(false);
      });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_days: config.working_days,
          start_time: config.start_time,
          end_time: config.end_time,
          slot_duration_minutes: config.slot_duration_minutes,
          buffer_minutes: config.buffer_minutes,
          timezone: config.timezone,
          booking_horizon_days: config.booking_horizon_days,
          min_notice_hours: config.min_notice_hours,
        }),
      });
      const data = await res.json() as { config?: AvailabilityConfig; blocked_dates?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setConfig(data.config!);
      setBlockedDates(data.blocked_dates!);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddBlockedDate() {
    if (!newBlockedDate) return;
    setAddingDate(true);
    try {
      const res = await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_blocked_date: newBlockedDate }),
      });
      const data = await res.json() as { blocked_dates?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to add date');
      setBlockedDates(data.blocked_dates!);
      setNewBlockedDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add date');
    } finally {
      setAddingDate(false);
    }
  }

  async function handleRemoveBlockedDate(date: string) {
    try {
      const res = await fetch('/api/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remove_blocked_date: date }),
      });
      const data = await res.json() as { blocked_dates?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to remove date');
      setBlockedDates(data.blocked_dates!);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove date');
    }
  }

  function toggleDay(day: string) {
    if (!config) return;
    const days = config.working_days.includes(day)
      ? config.working_days.filter(d => d !== day)
      : [...config.working_days, day];
    setConfig({ ...config, working_days: days });
  }

  if (loading) return <div className="p-6 text-bisque-500">Loading…</div>;
  if (!config) return <div className="p-6 text-red-500">{error ?? 'Failed to load'}</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-bisque-900 mb-6">Availability Settings</h1>

      <form onSubmit={handleSave} className="bg-white border border-bisque-200 rounded-xl p-6 mb-6 space-y-5">
        {/* Working days */}
        <div>
          <label className="block text-sm font-medium text-bisque-700 mb-2">Working days</label>
          <div className="flex gap-2 flex-wrap">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  config.working_days.includes(day)
                    ? 'bg-bisque-600 text-white'
                    : 'bg-bisque-100 text-bisque-600 hover:bg-bisque-200'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">Start time</label>
            <input
              type="time"
              value={config.start_time}
              onChange={e => setConfig({ ...config, start_time: e.target.value })}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">End time</label>
            <input
              type="time"
              value={config.end_time}
              onChange={e => setConfig({ ...config, end_time: e.target.value })}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            />
          </div>
        </div>

        {/* Slot duration & buffer */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">Slot duration (min)</label>
            <input
              type="number"
              min={15}
              max={480}
              step={15}
              value={config.slot_duration_minutes}
              onChange={e => setConfig({ ...config, slot_duration_minutes: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">Buffer (min)</label>
            <input
              type="number"
              min={0}
              max={120}
              step={5}
              value={config.buffer_minutes}
              onChange={e => setConfig({ ...config, buffer_minutes: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            />
          </div>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-sm font-medium text-bisque-700 mb-1">Timezone (IANA)</label>
          <input
            type="text"
            value={config.timezone}
            onChange={e => setConfig({ ...config, timezone: e.target.value })}
            className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            placeholder="America/New_York"
          />
        </div>

        {/* Horizon & min notice */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">Booking horizon (days)</label>
            <input
              type="number"
              min={1}
              max={365}
              value={config.booking_horizon_days}
              onChange={e => setConfig({ ...config, booking_horizon_days: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">Min notice (hours)</label>
            <input
              type="number"
              min={0}
              max={168}
              value={config.min_notice_hours}
              onChange={e => setConfig({ ...config, min_notice_hours: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
            />
          </div>
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
        {success && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">Saved!</div>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 px-4 bg-bisque-600 text-white rounded-lg font-medium hover:bg-bisque-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>

      {/* Blocked dates */}
      <div className="bg-white border border-bisque-200 rounded-xl p-6">
        <h2 className="text-lg font-medium text-bisque-900 mb-4">Blocked dates</h2>

        <div className="flex gap-2 mb-4">
          <input
            type="date"
            value={newBlockedDate}
            onChange={e => setNewBlockedDate(e.target.value)}
            className="flex-1 px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
          />
          <button
            onClick={handleAddBlockedDate}
            disabled={!newBlockedDate || addingDate}
            className="px-4 py-2 bg-bisque-600 text-white rounded-lg font-medium hover:bg-bisque-700 disabled:opacity-50 transition-colors"
          >
            {addingDate ? 'Adding…' : 'Block date'}
          </button>
        </div>

        {blockedDates.length === 0 ? (
          <p className="text-bisque-400 text-sm">No blocked dates.</p>
        ) : (
          <ul className="space-y-2">
            {blockedDates.map(date => (
              <li key={date} className="flex items-center justify-between py-2 px-3 bg-bisque-50 rounded-lg">
                <span className="text-bisque-800 text-sm">{date}</span>
                <button
                  onClick={() => handleRemoveBlockedDate(date)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
