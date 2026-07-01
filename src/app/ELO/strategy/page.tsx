import Link from 'next/link';
import type { Metadata } from 'next';
import EloBookingWidget from '@/components/EloBookingWidget';

export const metadata: Metadata = {
  title: 'Book a Strategy Session — Eloso',
  description: 'Schedule a 45-minute Strategy Session with the Eloso team.',
};

export default function EloStrategyPage() {
  return (
    <div className="min-h-screen bg-bisque-50 flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-lg w-full">
        {/* Back link */}
        <Link
          href="/ELO"
          className="inline-flex items-center text-bisque-500 text-sm hover:text-bisque-700 mb-8 transition-colors"
        >
          ← Back
        </Link>

        <div className="bg-white border border-bisque-200 rounded-2xl p-8 shadow-sm">
          {/* Header */}
          <div className="mb-6">
            <p className="text-bisque-500 text-sm font-medium mb-1">Eloso · 45 min meeting</p>
            <h1 className="text-2xl font-bold text-bisque-950 mb-3">Strategy Session</h1>
            <p className="text-bisque-600 text-sm leading-relaxed">
              A deeper 45-minute working session for leaders who are ready to think concretely
              about AI-assisted sourcing. Come with your context — we&apos;ll map out a path forward together.
            </p>
          </div>

          {/* Booking widget */}
          <EloBookingWidget
            sessionType="strategy"
            durationLabel="45 min"
            confirmedHref="/ELO/confirmed/strategy"
          />

          <p className="text-bisque-400 text-xs mt-5 text-center">
            After booking you&apos;ll receive a confirmation email with the meeting link.
          </p>
        </div>
      </div>
    </div>
  );
}
