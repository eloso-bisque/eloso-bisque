'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function CancelPage() {
  const params = useParams();
  const token = typeof params.token === 'string' ? params.token : '';

  const [status, setStatus] = useState<'idle' | 'loading' | 'cancelled' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!token) setStatus('error');
  }, [token]);

  async function handleCancel() {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Cancellation failed');
      setStatus('cancelled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel. Please try again.');
      setStatus('error');
    }
  }

  if (status === 'cancelled') {
    return (
      <div className="min-h-screen bg-bisque-50 flex items-center justify-center p-4">
        <div className="max-w-sm w-full bg-white rounded-xl shadow-sm border border-bisque-200 p-8 text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-xl font-semibold text-bisque-900 mb-2">Booking cancelled</h1>
          <p className="text-bisque-500 text-sm">A confirmation has been sent to your email.</p>
          <a href="/book" className="mt-6 inline-block text-bisque-600 hover:underline text-sm">
            Book a new time
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bisque-50 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-white rounded-xl shadow-sm border border-bisque-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-bisque-900 mb-2">Cancel booking</h1>
        {!confirmed ? (
          <>
            <p className="text-bisque-600 text-sm mb-6">Are you sure you want to cancel this booking?</p>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
              >
                Yes, cancel
              </button>
              <a href="/" className="flex-1 py-2 px-4 border border-bisque-300 text-bisque-700 rounded-lg font-medium hover:bg-bisque-50 transition-colors">
                Go back
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="text-bisque-600 text-sm mb-6 font-medium">
              Click confirm to permanently cancel this booking.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                disabled={status === 'loading'}
                className="flex-1 py-2 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {status === 'loading' ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="mt-4 text-red-600 text-sm">{error}</p>
        )}
      </div>
    </div>
  );
}
