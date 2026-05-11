"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { ContactDetailPayload } from "@/app/api/contacts/[id]/detail/route";

interface ContactDetailPanelProps {
  contactId: string;
  contactName: string;
  onClose: () => void;
}

function formatDate(iso: string): string {
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

function MetaField({ label, value }: { label: string; value: string }) {
  // Render links for linkedin/url values
  const isUrl =
    value.startsWith("http://") || value.startsWith("https://");
  return (
    <div>
      <dt className="text-xs text-bisque-400">{label}</dt>
      <dd className="text-sm text-bisque-800 mt-0.5 break-words">
        {isUrl ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-bisque-600 hover:underline"
          >
            {value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// Human-readable labels for known meta keys
const META_LABELS: Record<string, string> = {
  title: "Title",
  email: "Email",
  phone: "Phone",
  linkedin_url: "LinkedIn",
  location: "Location",
  company: "Company",
  connected_on: "LinkedIn Connected",
  hq: "HQ",
  revenue: "Revenue (est.)",
  employees: "Employees",
  website: "Website",
};

// Keys to hide (already shown in the header or not useful inline)
const HIDDEN_META_KEYS = new Set(["title", "company"]);

export default function ContactDetailPanel({
  contactId,
  contactName,
  onClose,
}: ContactDetailPanelProps) {
  const [data, setData] = useState<ContactDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/contacts/${encodeURIComponent(contactId)}/detail`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ContactDetailPayload>;
      })
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const title = data?.meta.find((m) => m.key === "title")?.value;
  const company = data?.meta.find((m) => m.key === "company")?.value;
  const email = data?.meta.find((m) => m.key === "email")?.value;

  // Visible meta fields (skip hidden ones, and email is shown separately)
  const visibleMeta = (data?.meta ?? []).filter(
    (m) => !HIDDEN_META_KEYS.has(m.key) && m.key !== "email"
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${contactName} details`}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-bisque-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-bisque-900 leading-tight truncate">
              {contactName}
            </h2>
            {(title || company) && (
              <p className="text-sm text-bisque-500 mt-0.5">
                {[title, company].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-lg text-bisque-400 hover:text-bisque-700 hover:bg-bisque-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
            aria-label="Close panel"
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <svg
                className="w-6 h-6 animate-spin text-bisque-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Tags */}
              {data.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {data.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-bisque-100 text-bisque-700 rounded-full text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Contact info */}
              {(email || visibleMeta.length > 0) && (
                <section>
                  <h3 className="text-xs font-semibold text-bisque-400 uppercase tracking-wide mb-2">
                    Contact Info
                  </h3>
                  <dl className="space-y-2.5">
                    {email && (
                      <div>
                        <dt className="text-xs text-bisque-400">Email</dt>
                        <dd className="text-sm mt-0.5">
                          <a
                            href={`mailto:${email}`}
                            className="text-bisque-600 hover:underline break-words"
                          >
                            {email}
                          </a>
                        </dd>
                      </div>
                    )}
                    {visibleMeta.map((m) => (
                      <MetaField
                        key={m.key}
                        label={META_LABELS[m.key] ?? m.key.replace(/_/g, " ")}
                        value={m.value}
                      />
                    ))}
                  </dl>
                </section>
              )}

              {/* Notes */}
              {data.notes && (
                <section>
                  <h3 className="text-xs font-semibold text-bisque-400 uppercase tracking-wide mb-2">
                    Notes
                  </h3>
                  <p className="text-sm text-bisque-800 leading-relaxed whitespace-pre-wrap bg-bisque-50 rounded-lg p-3 border border-bisque-100">
                    {data.notes}
                  </p>
                </section>
              )}

              {/* Recent interactions */}
              {data.recentInteractions.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-bisque-400 uppercase tracking-wide mb-2">
                    Recent Interactions
                  </h3>
                  <div className="space-y-2">
                    {data.recentInteractions.map((interaction) => (
                      <div
                        key={interaction.id}
                        className="bg-bisque-50 rounded-lg border border-bisque-100 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-bisque-600 capitalize">
                            {interaction.kind.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-bisque-400">
                            {formatDate(interaction.occurredAt)}
                          </span>
                        </div>
                        {interaction.subject && (
                          <p className="text-sm text-bisque-800 mt-1 font-medium">
                            {interaction.subject}
                          </p>
                        )}
                        {interaction.notes && (
                          <p className="text-xs text-bisque-600 mt-0.5 line-clamp-2">
                            {interaction.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Timestamps */}
              <div className="text-xs text-bisque-400 space-y-0.5">
                <p>Updated {formatDate(data.updatedAt)}</p>
                <p>Added {formatDate(data.createdAt)}</p>
              </div>
            </>
          )}
        </div>

        {/* Footer: View full profile link */}
        <div className="shrink-0 px-5 py-4 border-t border-bisque-100 bg-bisque-50/50">
          <Link
            href={`/contacts/${encodeURIComponent(contactId)}`}
            onClick={onClose}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-bisque-700 text-bisque-50 text-sm font-semibold hover:bg-bisque-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
          >
            View full profile
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
        </div>
      </div>
    </>
  );
}
