'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface TimeSlot {
  start_utc: string;
  end_utc: string;
  start_local: string;
  end_local: string;
  duration_minutes: number;
}

type Step = 'slots' | 'form' | 'submitting';

function groupByDate(slots: TimeSlot[]): Record<string, TimeSlot[]> {
  const groups: Record<string, TimeSlot[]> = {};
  for (const slot of slots) {
    const d = new Date(slot.start_utc);
    const key = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(slot);
  }
  return groups;
}

interface EloBookingWidgetProps {
  /** "discovery" or "strategy" */
  sessionType: 'discovery' | 'strategy';
  /** Displayed duration label, e.g. "30 min" */
  durationLabel: string;
  /** Where to redirect on successful booking */
  confirmedHref: string;
}

export default function EloBookingWidget({
  sessionType,
  durationLabel,
  confirmedHref,
}: EloBookingWidgetProps) {
  const router = useRouter();

  const [step, setStep] = useState<Step>('slots');
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestNotes, setGuestNotes] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

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

    setStep('submitting');
    setSubmitError(null);

    try {
      const res = await fetch('/api/booking/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_name: guestName.trim(),
          guest_email: guestEmail.trim(),
          guest_notes: `[${sessionType === 'discovery' ? 'Discovery Call' : 'Strategy Session'}] ${guestNotes.trim()}`.trim(),
          start_utc: selectedSlot.start_utc,
          timezone: userTz,
        }),
      });

      const data = await res.json() as { ok?: boolean; booking_id?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? 'Booking failed');
      }

      router.push(confirmedHref);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Booking failed. Please try again.');
      setStep('form');
    }
  }

  const grouped = groupByDate(slots);

  // Slot picker
  if (step === 'slots') {
    return (
      <div>
        <p className="text-bisque-500 text-xs mb-4">
          All times shown in your timezone ({userTz}).
        </p>

        {loadingSlots && (
          <div className="py-8 text-center text-bisque-400 text-sm">Loading available times…</div>
        )}

        {slotsError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
            {slotsError}
            <button onClick={loadSlots} className="ml-2 underline text-sm">Retry</button>
          </div>
        )}

        {!loadingSlots && !slotsError && slots.length === 0 && (
          <div className="py-8 text-center text-bisque-400 text-sm">
            No available times in the next 14 days. Please check back later.
          </div>
        )}

        {!loadingSlots && !slotsError && Object.entries(grouped).map(([date, daySlots]) => (
          <div key={date} className="mb-5">
            <h3 className="text-xs font-medium text-bisque-500 mb-2 uppercase tracking-wide">{date}</h3>
            <div className="grid grid-cols-2 gap-2">
              {daySlots.map(slot => (
                <button
                  key={slot.start_utc}
                  onClick={() => { setSelectedSlot(slot); setStep('form'); }}
                  className="py-2 px-3 bg-bisque-50 border border-bisque-200 rounded-lg text-bisque-800 text-sm hover:border-bisque-400 hover:bg-white transition-colors text-left"
                >
                  {new Date(slot.start_utc).toLocaleTimeString('en-US', {
                    timeZone: userTz,
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  <span className="text-bisque-400 text-xs ml-1">({durationLabel})</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Booking form
  if ((step === 'form' || step === 'submitting') && selectedSlot) {
    const submitting = step === 'submitting';
    return (
      <div>
        <button
          onClick={() => { setStep('slots'); setSubmitError(null); }}
          className="text-bisque-500 text-sm mb-4 hover:text-bisque-700 transition-colors"
          disabled={submitting}
        >
          ← Choose a different time
        </button>

        <div className="bg-bisque-50 border border-bisque-100 rounded-lg px-4 py-3 mb-5">
          <p className="text-bisque-700 text-sm font-medium">
            {new Date(selectedSlot.start_utc).toLocaleString('en-US', {
              timeZone: userTz,
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </p>
          <p className="text-bisque-400 text-xs mt-0.5">{durationLabel} · {userTz}</p>
        </div>

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
              disabled={submitting}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400 disabled:opacity-50"
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
              disabled={submitting}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400 disabled:opacity-50"
              placeholder="jane@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-bisque-700 mb-1">
              Anything you&apos;d like to discuss? (optional)
            </label>
            <textarea
              maxLength={1800}
              rows={3}
              value={guestNotes}
              onChange={e => setGuestNotes(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 border border-bisque-300 rounded-lg text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400 resize-none disabled:opacity-50"
              placeholder="Topics, questions, context…"
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
            className="w-full py-2.5 px-4 bg-bisque-700 text-white rounded-lg font-medium text-sm hover:bg-bisque-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Confirming…' : 'Confirm booking'}
          </button>
        </form>
      </div>
    );
  }

  return null;
}
