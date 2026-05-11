'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface TimeSlot {
  start_utc: string;
  end_utc: string;
  start_local: string;
  end_local: string;
  duration_minutes: number;
}

type Step = 'slots' | 'confirmed';

function groupByDate(slots: TimeSlot[], tz: string): Record<string, TimeSlot[]> {
  const groups: Record<string, TimeSlot[]> = {};
  for (const slot of slots) {
    const key = new Date(slot.start_utc).toLocaleDateString('en-US', {
      timeZone: tz,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(slot);
  }
  return groups;
}

export default function ReschedulePage() {
  const params = useParams();
  const token = typeof params.token === 'string' ? params.token : '';

  const [step, setStep] = useState<Step>('slots');
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

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
    if (token) loadSlots();
  }, [token, loadSlots]);

  async function handleSelectSlot(slot: TimeSlot) {
    setSelectedSlot(slot);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch('/api/booking/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, start_utc: slot.start_utc }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Reschedule failed');
      setStep('confirmed');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Reschedule failed. Please try again.');
      setSelectedSlot(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'confirmed' && selectedSlot) {
    return (
      <div className="min-h-screen bg-bisque-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-xl shadow-sm border border-bisque-200 p-8 text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-xl font-semibold text-bisque-900 mb-2">Booking rescheduled!</h1>
          <p className="text-bisque-500 text-sm">
            Your meeting is now on <strong>{selectedSlot.start_local}</strong>.
          </p>
          <p className="text-bisque-400 text-xs mt-3">A confirmation email has been sent.</p>
        </div>
      </div>
    );
  }

  const grouped = groupByDate(slots, userTz);

  return (
    <div className="min-h-screen bg-bisque-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8 pt-6">
          <h1 className="text-2xl font-semibold text-bisque-900">Reschedule your booking</h1>
          <p className="text-bisque-500 text-sm mt-1">Select a new time. Your current booking will be updated.</p>
        </div>

        {loadingSlots && <div className="text-center py-12 text-bisque-500">Loading available times…</div>}

        {slotsError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-center">
            {slotsError}
            <button onClick={loadSlots} className="ml-3 underline text-sm">Retry</button>
          </div>
        )}

        {submitError && (
          <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
            {submitError}
          </div>
        )}

        {!loadingSlots && !slotsError && Object.entries(grouped).map(([date, daySlots]) => (
          <div key={date} className="mb-6">
            <h2 className="text-sm font-medium text-bisque-600 mb-2 uppercase tracking-wide">{date}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {daySlots.map(slot => (
                <button
                  key={slot.start_utc}
                  onClick={() => handleSelectSlot(slot)}
                  disabled={submitting}
                  className="py-2.5 px-3 bg-white border border-bisque-200 rounded-lg text-bisque-800 text-sm hover:border-bisque-400 hover:bg-bisque-50 disabled:opacity-50 transition-colors"
                >
                  {new Date(slot.start_utc).toLocaleTimeString('en-US', {
                    timeZone: userTz,
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
