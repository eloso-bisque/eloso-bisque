'use client';

import { useState, useEffect, useCallback } from 'react';

interface TimeSlot {
  start_utc: string;
  end_utc: string;
  start_local: string;
  end_local: string;
  duration_minutes: number;
}

type Step = 'slots' | 'form' | 'confirmed';

function groupByDate(slots: TimeSlot[]): Record<string, TimeSlot[]> {
  const groups: Record<string, TimeSlot[]> = {};
  for (const slot of slots) {
    // Extract date from start_local for grouping key
    const d = new Date(slot.start_utc);
    const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(slot);
  }
  return groups;
}

export default function BookPage() {
  const [step, setStep] = useState<Step>('slots');
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestNotes, setGuestNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const loadSlots = useCallback(async () => {
    setLoadingSlots(true);
    setSlotsError(null);
    try {
      const res = await fetch(`/api/booking/slots?tz=${encodeURIComponent(userTz)}&days=14`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'Failed to load slots');
      }
      const data = await res.json() as { slots: TimeSlot[] };
      setSlots(data.slots);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : 'Failed to load available times');
    } finally {
      setLoadingSlots(false);
    }
  }, [userTz]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: guestName.trim(),
          guest_email: guestEmail.trim(),
          guest_notes: guestNotes.trim(),
          start_utc: selectedSlot.start_utc,
          timezone: userTz,
        }),
      });

      const data = await res.json() as { ok?: boolean; booking_id?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? 'Booking failed');
      }

      setBookingId(data.booking_id ?? null);
      setStep('confirmed');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Booking failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const hostName = process.env.NEXT_PUBLIC_BOOKING_HOST_NAME ?? 'us';

  if (step === 'confirmed') {
    return (
      <div className="min-h-screen bg-bisque-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-bisque-200 p-8 text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-2xl font-semibold text-bisque-900 mb-2">Booking confirmed!</h1>
          <p className="text-bisque-600 mb-4">
            {selectedSlot && (
              <>Your meeting is scheduled for <strong>{selectedSlot.start_local}</strong>.</>
            )}
          </p>
          <p className="text-bisque-500 text-sm">
            A confirmation email has been sent to <strong>{guestEmail}</strong>.
          </p>
          {bookingId && (
            <p className="text-bisque-400 text-xs mt-3">Booking ID: {bookingId}</p>
          )}
        </div>
      </div>
    );
  }

  if (step === 'form' && selectedSlot) {
    return (
      <div className="min-h-screen bg-bisque-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-bisque-200 p-8">
          <button
            onClick={() => setStep('slots')}
            className="text-bisque-500 text-sm mb-6 hover:text-bisque-700"
          >
            ← Back
          </button>
          <h1 className="text-xl font-semibold text-bisque-900 mb-1">Book your meeting</h1>
          <p className="text-bisque-600 text-sm mb-6">{selectedSlot.start_local} ({selectedSlot.duration_minutes} min)</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-bisque-700 mb-1">
                Your name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={200}
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-bisque-700 mb-1">
                Email address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                maxLength={300}
                value={guestEmail}
                onChange={e => setGuestEmail(e.target.value)}
                className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500"
                placeholder="jane@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-bisque-700 mb-1">
                Anything you&apos;d like to discuss? (optional)
              </label>
              <textarea
                maxLength={2000}
                rows={3}
                value={guestNotes}
                onChange={e => setGuestNotes(e.target.value)}
                className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 focus:outline-none focus:ring-2 focus:ring-bisque-500 resize-none"
                placeholder="Topics, questions, context..."
              />
            </div>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !guestName.trim() || !guestEmail.trim()}
              className="w-full py-2.5 px-4 bg-bisque-600 text-white rounded-lg font-medium hover:bg-bisque-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Booking…' : 'Confirm booking'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const grouped = groupByDate(slots);

  return (
    <div className="min-h-screen bg-bisque-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8 pt-6">
          <h1 className="text-2xl font-semibold text-bisque-900">Book a meeting with {hostName}</h1>
          <p className="text-bisque-500 text-sm mt-1">
            All times shown in your timezone ({userTz}).
          </p>
        </div>

        {loadingSlots && (
          <div className="text-center py-12 text-bisque-500">Loading available times…</div>
        )}

        {slotsError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
            {slotsError}
            <button onClick={loadSlots} className="ml-3 underline text-sm">Retry</button>
          </div>
        )}

        {!loadingSlots && !slotsError && slots.length === 0 && (
          <div className="text-center py-12 text-bisque-500">
            No available times in the next 14 days. Please check back later.
          </div>
        )}

        {!loadingSlots && !slotsError && Object.entries(grouped).map(([date, daySlots]) => (
          <div key={date} className="mb-6">
            <h2 className="text-sm font-medium text-bisque-600 mb-2 uppercase tracking-wide">{date}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {daySlots.map(slot => (
                <button
                  key={slot.start_utc}
                  onClick={() => { setSelectedSlot(slot); setStep('form'); }}
                  className="py-2.5 px-3 bg-white border border-bisque-200 rounded-lg text-bisque-800 text-sm hover:border-bisque-400 hover:bg-bisque-50 transition-colors text-left"
                >
                  {new Date(slot.start_utc).toLocaleTimeString('en-US', {
                    timeZone: userTz,
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  <span className="text-bisque-400 text-xs ml-1">({slot.duration_minutes}m)</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
