"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ProspectContact } from "@/lib/outreach";
import { isHotSignal, daysSince } from "@/lib/outreach";

interface SignalsTabProps {
  contacts: ProspectContact[];
}

function relativeSignalDate(dateStr: string): string {
  const days = Math.floor(daysSince(dateStr));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function SignalCard({ contact }: { contact: ProspectContact }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [loading, setLoading] = useState<"dismiss" | "snooze" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDismiss = useCallback(async () => {
    setLoading("dismiss");
    setError(null);
    try {
      const res = await fetch("/api/signals/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: contact.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      }
      setDismissed(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
    } finally {
      setLoading(null);
    }
  }, [contact.id, router]);

  const handleSnooze = useCallback(async () => {
    setLoading("snooze");
    setError(null);
    try {
      const res = await fetch("/api/signals/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId: contact.id, days: 7 }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      }
      setSnoozed(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to snooze");
    } finally {
      setLoading(null);
    }
  }, [contact.id, router]);

  if (dismissed) {
    return (
      <div className="px-4 py-3 text-sm text-bisque-400 bg-bisque-50 rounded-lg border border-bisque-100">
        {contact.name} — dismissed
      </div>
    );
  }

  if (snoozed) {
    return (
      <div className="px-4 py-3 text-sm text-bisque-400 bg-bisque-50 rounded-lg border border-bisque-100">
        {contact.name} — snoozed 7 days
      </div>
    );
  }

  const hot = isHotSignal(contact);

  return (
    <div className="bg-white rounded-xl border border-bisque-100 shadow-sm px-4 md:px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-bisque-900 text-base">{contact.name}</h3>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${
                hot
                  ? "bg-amber-100 text-amber-700 border-amber-200"
                  : "bg-green-50 text-green-700 border-green-200"
              }`}
            >
              ⚡ {contact.lastSignalDate ? relativeSignalDate(contact.lastSignalDate) : "Recent"}
              {contact.lastSignalKeyword && ` · "${contact.lastSignalKeyword}"`}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                contact.fitTier === "high"
                  ? "bg-green-100 text-green-700"
                  : contact.fitTier === "medium"
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-bisque-100 text-bisque-600"
              }`}
            >
              fit-{contact.fitTier}
            </span>
          </div>
          {contact.title && (
            <p className="text-sm text-bisque-600 mt-0.5">{contact.title}</p>
          )}
          {contact.company && (
            <p className="text-sm text-bisque-500">{contact.company}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* Engage button: opens the specific post URL, or falls back to LinkedIn profile */}
          {(contact.lastSignalUrl || contact.linkedinUrl) && (() => {
            const engageUrl = contact.lastSignalUrl
              ? (contact.lastSignalUrl.startsWith("http") ? contact.lastSignalUrl : `https://${contact.lastSignalUrl}`)
              : (contact.linkedinUrl!.startsWith("http") ? contact.linkedinUrl! : `https://${contact.linkedinUrl}`);
            const tooltipText = contact.lastSignalKeyword
              ? `Engaged via "${contact.lastSignalKeyword}"`
              : "Engage on LinkedIn";
            return (
              <a
                href={engageUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={tooltipText}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
                Engage ↗
              </a>
            );
          })()}
          <button
            onClick={handleSnooze}
            disabled={loading !== null}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-bisque-200 text-bisque-700 hover:bg-bisque-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading === "snooze" ? "Snoozing…" : "Snooze 7d"}
          </button>
          <button
            onClick={handleDismiss}
            disabled={loading !== null}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading === "dismiss" ? "Dismissing…" : "Not Relevant"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

export default function SignalsTab({ contacts }: SignalsTabProps) {
  if (contacts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-bisque-100 p-12 text-center">
        <div className="text-4xl mb-3">⚡</div>
        <p className="text-bisque-600 font-medium">No active signals</p>
        <p className="text-bisque-400 text-sm mt-1">
          Prospects who post about your keywords on LinkedIn will appear here within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-bisque-500">
        {contacts.length} signal{contacts.length !== 1 ? "s" : ""} — sorted by priority score
      </p>
      <div className="space-y-3">
        {contacts.map((contact) => (
          <SignalCard key={contact.id} contact={contact} />
        ))}
      </div>
    </div>
  );
}
