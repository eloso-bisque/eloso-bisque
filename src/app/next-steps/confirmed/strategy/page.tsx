import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Strategy Session Confirmed — Eloso',
  description: 'Your Strategy Session with Eloso is confirmed.',
};

export default function SigStrategyConfirmedPage() {
  return (
    <div className="min-h-screen bg-bisque-50 flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="bg-white border border-bisque-200 rounded-2xl p-10 shadow-sm">
          {/* Check mark */}
          <div className="w-14 h-14 bg-bisque-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg
              className="w-7 h-7 text-bisque-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-bisque-950 mb-2">You&apos;re confirmed</h1>
          <p className="text-bisque-600 text-sm mb-1 font-medium">Strategy Session · 45 minutes</p>
          <p className="text-bisque-500 text-sm mb-6">
            Check your inbox for a calendar invite and the meeting link.
          </p>

          <p className="text-bisque-400 text-sm">
            Questions?{' '}
            <a href="mailto:hello@eloso.ai" className="text-bisque-600 underline hover:text-bisque-800">
              hello@eloso.ai
            </a>
          </p>
        </div>

        <Link
          href="/next-steps"
          className="inline-block mt-6 text-bisque-500 text-sm hover:text-bisque-700 transition-colors"
        >
          ← Back to Eloso at SIG
        </Link>
      </div>
    </div>
  );
}
