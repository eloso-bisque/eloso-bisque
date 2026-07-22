"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * TrigifySignalsTab — shows Trigify social listening signals for a contact.
 *
 * Signals are stored as Kissinger contact events with createdBy="trigify-sync"
 * and eventType="NOTE", written by the external `trigify-daily-sync` cron job
 * directly into Kissinger — not through this app. This component fetches all
 * events for the contact from /api/contacts/[id]/trigify-signals (a
 * dedicated, still-Kissinger-backed route — see that route's doc comment)
 * and filters to only those created by the sync job.
 *
 * This intentionally still reads Kissinger: the sibling
 * /api/contacts/[id]/events route was cut over to Postgres for the regular
 * Notes/Meetings/etc events tab, but Trigify's sync job has no Postgres
 * counterpart to read from yet.
 *
 * TODO: When Kissinger adds server-side filtering for contact events
 * (e.g. contactEventsForEntity(entityId, createdBy: "trigify-sync")),
 * switch to that for efficiency.
 */

interface RawEvent {
  id: string;
  personId?: string;
  kind: string;
  notes: string;
  occurredAt: string;
  createdAt: string;
  /** Present when fetched via the updated events route */
  createdBy?: string;
  eventType?: string;
}

interface TrigifySignal {
  id: string;
  summary: string;
  occurredAt: string;
  createdAt: string;
  /** Keyword extracted from the summary: 'Posted about "X"' */
  keyword: string | null;
  /** Excerpt after the keyword: the post text */
  postExcerpt: string | null;
}

function parseTrigifySignal(event: RawEvent): TrigifySignal {
  const summary = event.notes ?? "";
  // Summary format: 'Posted about "keyword": excerpt'
  const keywordMatch = summary.match(/Posted about "([^"]+)"/);
  const keyword = keywordMatch ? keywordMatch[1] : null;
  const colonIdx = summary.indexOf(":");
  const postExcerpt =
    colonIdx >= 0 ? summary.slice(colonIdx + 1).trim() : null;

  return {
    id: event.id,
    summary,
    occurredAt: event.occurredAt ?? event.createdAt,
    createdAt: event.createdAt,
    keyword,
    postExcerpt,
  };
}

function isTrigifyEvent(event: RawEvent): boolean {
  // Primary check: createdBy field (set by trigify-sync)
  if (event.createdBy === "trigify-sync") return true;
  // Fallback: heuristic — summary starts with 'Posted about'
  if (event.notes?.startsWith("Posted about")) return true;
  return false;
}

function formatSignalDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

interface TrigifySignalsTabProps {
  contactId: string;
}

export default function TrigifySignalsTab({ contactId }: TrigifySignalsTabProps) {
  const [signals, setSignals] = useState<TrigifySignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSignals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/trigify-signals`
      );
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as { events: RawEvent[] };
      const trigifyEvents = (json.events ?? [])
        .filter(isTrigifyEvent)
        .sort(
          (a, b) =>
            Date.parse(b.occurredAt ?? b.createdAt) -
            Date.parse(a.occurredAt ?? a.createdAt)
        )
        .map(parseTrigifySignal);
      setSignals(trigifyEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void loadSignals();
  }, [loadSignals]);

  if (loading) {
    return (
      <div className="py-8 text-center text-bisque-400 text-sm">
        Loading signals…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={loadSignals}
          className="mt-2 text-xs text-bisque-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-bisque-800">Trigify Signals</h2>
        <div className="bg-white rounded-xl border border-bisque-100 p-12 text-center">
          <div className="text-4xl mb-3">📡</div>
          <p className="text-bisque-600 font-medium">No signals yet</p>
          <p className="text-bisque-400 text-sm mt-1">
            Trigify signals appear here when this contact posts about monitored
            keywords on LinkedIn.
          </p>
          <p className="text-bisque-300 text-xs mt-3">
            Signals are written by the{" "}
            <code className="font-mono bg-bisque-50 px-1 rounded">
              trigify-daily-sync
            </code>{" "}
            scheduled job.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-bisque-800">
          Trigify Signals
          <span className="ml-2 text-sm font-normal text-bisque-500">
            ({signals.length})
          </span>
        </h2>
        <span className="text-xs text-bisque-400 italic">
          From LinkedIn post monitoring
        </span>
      </div>

      <div className="bg-white rounded-xl border border-bisque-100 shadow-sm divide-y divide-bisque-50">
        {signals.map((signal, idx) => {
          const isLast = idx === signals.length - 1;
          return (
            <div key={signal.id} className="flex gap-4 px-5 py-4">
              {/* Date column */}
              <div className="w-24 shrink-0 text-right">
                <p className="text-xs text-bisque-500 leading-tight">
                  {formatSignalDate(signal.occurredAt)}
                </p>
              </div>

              {/* Timeline dot + line */}
              <div className="flex flex-col items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-green-400 mt-0.5 shrink-0" />
                {!isLast && (
                  <div className="w-px flex-1 bg-bisque-100 mt-1" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-2">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">
                    Trigify Signal
                  </span>
                  {signal.keyword && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-bisque-100 text-bisque-700">
                      &quot;{signal.keyword}&quot;
                    </span>
                  )}
                </div>
                {signal.postExcerpt ? (
                  <p className="text-sm text-bisque-700 leading-relaxed">
                    {signal.postExcerpt}
                  </p>
                ) : (
                  <p className="text-sm text-bisque-500 italic">
                    {signal.summary}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
