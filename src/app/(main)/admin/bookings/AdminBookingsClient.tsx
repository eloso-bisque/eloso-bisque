'use client';

import { useState } from 'react';
import type { Booking } from '@/lib/booking/types';

type BookingWithDisplay = Booking & { display_datetime: string };

interface Props {
  upcoming: BookingWithDisplay[];
  past: BookingWithDisplay[];
}

function StatusBadge({ status }: { status: string }) {
  const colors = {
    confirmed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-700',
    rescheduled: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status as keyof typeof colors] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

function BookingRow({ booking, showCancel }: { booking: BookingWithDisplay; showCancel: boolean }) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (!confirm(`Cancel booking for ${booking.guest_name}?`)) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: booking.cancel_token }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Cancel failed');
      setCancelled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setCancelling(false);
    }
  }

  const currentStatus = cancelled ? 'cancelled' : booking.status;

  return (
    <tr className="border-t border-bisque-100 hover:bg-bisque-50">
      <td className="py-3 px-4">
        <div className="font-medium text-bisque-900 text-sm">{booking.guest_name}</div>
        <div className="text-bisque-500 text-xs">{booking.guest_email}</div>
      </td>
      <td className="py-3 px-4 text-sm text-bisque-700">{booking.display_datetime}</td>
      <td className="py-3 px-4 text-sm text-bisque-600">{booking.duration_minutes}m</td>
      <td className="py-3 px-4"><StatusBadge status={currentStatus} /></td>
      <td className="py-3 px-4">
        {showCancel && currentStatus === 'confirmed' && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        {error && <span className="text-red-500 text-xs ml-2">{error}</span>}
      </td>
    </tr>
  );
}

export default function AdminBookingsClient({ upcoming, past }: Props) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const bookings = tab === 'upcoming' ? upcoming : past;

  return (
    <div>
      <div className="flex gap-2 mb-6">
        {(['upcoming', 'past'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-bisque-700 text-white'
                : 'bg-white border border-bisque-200 text-bisque-700 hover:bg-bisque-50'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)} ({(t === 'upcoming' ? upcoming : past).length})
          </button>
        ))}
      </div>

      {bookings.length === 0 ? (
        <div className="text-center py-12 text-bisque-400">No {tab} bookings.</div>
      ) : (
        <div className="bg-white border border-bisque-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-bisque-50 border-b border-bisque-200">
              <tr>
                <th className="py-3 px-4 text-left text-xs font-medium text-bisque-600 uppercase tracking-wide">Guest</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-bisque-600 uppercase tracking-wide">Time</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-bisque-600 uppercase tracking-wide">Duration</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-bisque-600 uppercase tracking-wide">Status</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-bisque-600 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <BookingRow key={b.id} booking={b} showCancel={tab === 'upcoming'} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
