"use client";

import { useState, useCallback } from "react";
import type { ResponseType } from "@/lib/kissinger";

interface ResponseOption {
  value: ResponseType;
  label: string;
  description: string;
}

const RESPONSE_OPTIONS: ResponseOption[] = [
  {
    value: "Interested",
    label: "Interested",
    description: "They want to learn more or schedule a call",
  },
  {
    value: "NotNow",
    label: "Not now",
    description: "Open to it later — not the right time",
  },
  {
    value: "WrongPerson",
    label: "Wrong person",
    description: "Referred me elsewhere or not the decision maker",
  },
  {
    value: "NoReply",
    label: "No reply",
    description: "No response after all touches",
  },
  {
    value: "Bounced",
    label: "Bounced",
    description: "Email bounced or LinkedIn message undeliverable",
  },
];

interface ResponseDrawerProps {
  contactId: string;
  contactName: string;
  onClose: () => void;
  onSuccess: (responseType: string) => void;
}

export default function ResponseDrawer({
  contactId,
  contactName,
  onClose,
  onSuccess,
}: ResponseDrawerProps) {
  const [selectedType, setSelectedType] = useState<ResponseType | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!selectedType) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/contacts/${contactId}/outreach-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseType: selectedType, notes: notes.trim() || undefined }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { responseType: string };
      onSuccess(data.responseType);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log response");
    } finally {
      setSubmitting(false);
    }
  }, [contactId, selectedType, notes, onSuccess]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="response-drawer-title"
    >
      {/* Dimmed overlay */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className="relative z-10 w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-xl border border-bisque-100 p-5 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="response-drawer-title"
              className="text-lg font-semibold text-bisque-900"
            >
              Log Response
            </h2>
            <p className="text-sm text-bisque-500 mt-0.5">
              {contactName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-bisque-400 hover:text-bisque-700 hover:bg-bisque-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
            aria-label="Close drawer"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Response type options */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-bisque-700">What was the response?</p>
          <div className="space-y-2">
            {RESPONSE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedType === opt.value
                    ? "border-bisque-400 bg-bisque-50"
                    : "border-bisque-100 hover:border-bisque-200 hover:bg-bisque-50/50"
                }`}
              >
                <input
                  type="radio"
                  name="responseType"
                  value={opt.value}
                  checked={selectedType === opt.value}
                  onChange={() => setSelectedType(opt.value)}
                  className="mt-0.5 accent-bisque-600"
                />
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-bisque-900">
                    {opt.label}
                  </span>
                  <span className="block text-xs text-bisque-500 mt-0.5">
                    {opt.description}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Notes textarea */}
        <div className="space-y-1.5">
          <label
            htmlFor="response-notes"
            className="text-sm font-medium text-bisque-700"
          >
            Notes{" "}
            <span className="font-normal text-bisque-400">(optional)</span>
          </label>
          <textarea
            id="response-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did they say? Any context..."
            rows={3}
            className="w-full rounded-lg border border-bisque-200 px-3 py-2 text-sm text-bisque-800 placeholder-bisque-300 focus:outline-none focus:ring-2 focus:ring-bisque-400 focus:border-transparent resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 min-h-[44px] text-sm font-medium rounded-lg border border-bisque-200 text-bisque-700 hover:bg-bisque-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedType || submitting}
            className="flex-1 px-4 py-2.5 min-h-[44px] text-sm font-semibold rounded-lg bg-bisque-700 text-bisque-50 hover:bg-bisque-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Logging…" : "Log Response"}
          </button>
        </div>
      </div>
    </div>
  );
}
