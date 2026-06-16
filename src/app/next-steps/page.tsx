import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Meet Eloso — Sourcing Industry Group',
  description: 'Book time with the Eloso team at the Sourcing Industry Group roundtable.',
};

export default function SigLandingPage() {
  return (
    <div className="min-h-screen bg-bisque-50 flex flex-col items-center justify-center px-4 py-16">
      <div className="max-w-2xl w-full text-center">
        {/* Wordmark */}
        <p className="text-bisque-500 text-sm font-medium uppercase tracking-widest mb-6">
          Eloso
        </p>

        <h1 className="text-4xl font-bold text-bisque-950 mb-4 leading-tight">
          Let&apos;s talk supply chain intelligence
        </h1>

        <p className="text-bisque-700 text-lg mb-12 max-w-lg mx-auto leading-relaxed">
          We&apos;re here at the SIG roundtable. Pick the conversation that fits where you are.
        </p>

        {/* CTA cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl mx-auto">
          {/* Discovery Call */}
          <Link
            href="/next-steps/discovery"
            className="group block bg-white border border-bisque-200 rounded-2xl p-7 text-left hover:border-bisque-400 hover:shadow-md transition-all"
          >
            <div className="text-bisque-500 text-sm font-medium mb-1">30 minutes</div>
            <h2 className="text-xl font-semibold text-bisque-950 mb-2 group-hover:text-bisque-800">
              Discovery Call
            </h2>
            <p className="text-bisque-600 text-sm leading-relaxed">
              New to Eloso? Walk through what we do and whether it fits your sourcing operations.
            </p>
            <div className="mt-5 text-bisque-800 text-sm font-medium group-hover:underline">
              Book a time →
            </div>
          </Link>

          {/* Strategy Session */}
          <Link
            href="/next-steps/strategy"
            className="group block bg-bisque-950 border border-bisque-950 rounded-2xl p-7 text-left hover:bg-bisque-900 hover:shadow-md transition-all"
          >
            <div className="text-bisque-400 text-sm font-medium mb-1">45 minutes</div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Strategy Session
            </h2>
            <p className="text-bisque-300 text-sm leading-relaxed">
              Already thinking about AI-assisted sourcing? Bring your context and let&apos;s map out a concrete path forward.
            </p>
            <div className="mt-5 text-bisque-300 text-sm font-medium hover:underline">
              Book a time →
            </div>
          </Link>
        </div>

        <p className="mt-10 text-bisque-400 text-sm">
          Questions? Find us at the Eloso table or email{' '}
          <a href="mailto:hello@eloso.ai" className="underline hover:text-bisque-600">
            hello@eloso.ai
          </a>
        </p>
      </div>
    </div>
  );
}
