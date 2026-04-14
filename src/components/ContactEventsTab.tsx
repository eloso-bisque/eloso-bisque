"use client";

import { useState, useEffect, useCallback } from "react";

export type ContactEventKind = "Note" | "Meeting" | "Email" | "Call" | "Custom";

export interface ContactEvent {
  id: string;
  personId: string;
  kind: ContactEventKind;
  notes: string;
  occurredAt: string;
  createdAt: string;
}

const KIND_CONFIG: Record<
  ContactEventKind,
  { emoji: string; label: string; badgeCls: string }
> = {
  Note: {
    emoji: "📝",
    label: "Note",
    badgeCls: "bg-bisque-100 text-bisque-700 border border-bisque-200",
  },
  Meeting: {
    emoji: "🤝",
    label: "Meeting",
    badgeCls: "bg-sky-100 text-sky-700 border border-sky-200",
  },
  Email: {
    emoji: "📧",
    label: "Email",
    badgeCls: "bg-violet-100 text-violet-700 border border-violet-200",
  },
  Call: {
    emoji: "📞",
    label: "Call",
    badgeCls: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  },
  Custom: {
    emoji: "⭐",
    label: "Custom",
    badgeCls: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  },
};

const EVENT_KINDS: ContactEventKind[] = ["Note", "Meeting", "Email", "Call", "Custom"];

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatEventDate(iso: string): string {
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

interface LogEventFormProps {
  contactId: string;
  onCreated: (event: ContactEvent) => void;
  onCancel: () => void;
}

function LogEventForm({ contactId, onCreated, onCancel }: LogEventFormProps) {
  const [kind, setKind] = useState<ContactEventKind>("Note");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, notes, occurredAt: date }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `Request failed: ${res.status}`);
      }

      const json = (await res.json()) as { event: ContactEvent };
      onCreated(json.event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log event");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-bisque-50 border border-bisque-200 rounded-xl p-4 space-y-4"
    >
      <h3 className="text-sm font-semibold text-bisque-800">Log an event</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Kind */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-bisque-700">Type</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ContactEventKind)}
            className="w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400"
          >
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_CONFIG[k].emoji} {KIND_CONFIG[k].label}
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-bisque-700">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400"
          />
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-bisque-700">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened?"
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400 resize-none"
        />
      </div>

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-bisque-600 hover:text-bisque-900 hover:bg-bisque-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-bisque-800 text-white hover:bg-bisque-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Saving…" : "Log event"}
        </button>
      </div>
    </form>
  );
}

interface ContactEventsTabProps {
  contactId: string;
  /** Optional: pre-loaded events from server (avoids extra fetch on mount) */
  initialEvents?: ContactEvent[];
}

export default function ContactEventsTab({
  contactId,
  initialEvents,
}: ContactEventsTabProps) {
  const [events, setEvents] = useState<ContactEvent[]>(initialEvents ?? []);
  const [loading, setLoading] = useState(!initialEvents);
  const [showForm, setShowForm] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/events`);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const json = (await res.json()) as { events: ContactEvent[] };
      // Sort descending by occurredAt
      const sorted = (json.events ?? []).sort(
        (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
      );
      setEvents(sorted);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    if (!initialEvents) {
      void loadEvents();
    }
  }, [initialEvents, loadEvents]);

  function handleCreated(event: ContactEvent) {
    setEvents((prev) => {
      const updated = [event, ...prev];
      // Re-sort by date
      return updated.sort(
        (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
      );
    });
    setShowForm(false);
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-bisque-800">Events</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-bisque-800 text-white hover:bg-bisque-700 transition-colors"
          >
            + Log event
          </button>
        )}
      </div>

      {/* Log event form */}
      {showForm && (
        <LogEventForm
          contactId={contactId}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-8 text-center text-bisque-400 text-sm">
          Loading events…
        </div>
      )}

      {/* Fetch error */}
      {fetchError && !loading && (
        <div className="py-6 text-center">
          <p className="text-sm text-red-500">{fetchError}</p>
          <button
            onClick={loadEvents}
            className="mt-2 text-xs text-bisque-500 hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !fetchError && events.length === 0 && (
        <div className="bg-white rounded-xl border border-bisque-100 p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-bisque-600 font-medium">No events yet</p>
          <p className="text-bisque-400 text-sm mt-1">
            Log the first one to start the timeline.
          </p>
        </div>
      )}

      {/* Timeline */}
      {!loading && !fetchError && events.length > 0 && (
        <div className="bg-white rounded-xl border border-bisque-100 shadow-sm divide-y divide-bisque-50">
          {events.map((event, idx) => {
            const cfg = KIND_CONFIG[event.kind] ?? KIND_CONFIG.Custom;
            const isLast = idx === events.length - 1;
            return (
              <div key={event.id} className="flex gap-4 px-5 py-4">
                {/* Left: date column */}
                <div className="w-24 shrink-0 text-right">
                  <p className="text-xs text-bisque-500 leading-tight">
                    {formatEventDate(event.occurredAt)}
                  </p>
                </div>

                {/* Center: timeline line + dot */}
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-bisque-300 mt-0.5 shrink-0" />
                  {!isLast && (
                    <div className="w-px flex-1 bg-bisque-100 mt-1" />
                  )}
                </div>

                {/* Right: event content */}
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badgeCls}`}
                    >
                      {cfg.emoji} {cfg.label}
                    </span>
                  </div>
                  {event.notes ? (
                    <p className="text-sm text-bisque-700 leading-relaxed whitespace-pre-line">
                      {event.notes}
                    </p>
                  ) : (
                    <p className="text-sm text-bisque-400 italic">No notes</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
