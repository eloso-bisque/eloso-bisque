"use client";

/**
 * LazyScoreBadge
 *
 * Renders "—" until the element enters the viewport, then fetches the contact
 * score from /api/contacts/[id]/score and displays the result.
 *
 * This is the P1b lazy-scoring implementation: no scores are computed during
 * the server-side contacts list render. Scores are fetched on demand as the
 * user scrolls.
 */

import { useEffect, useRef, useState } from "react";

interface ScoreResponse {
  score: number;
  error?: string;
}

interface LazyScoreBadgeProps {
  contactId: string;
  /** When true, skip lazy loading and just show "—" (e.g., search results). */
  disabled?: boolean;
}

export default function LazyScoreBadge({ contactId, disabled = false }: LazyScoreBadgeProps) {
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (disabled || fetchedRef.current) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetchedRef.current) {
          fetchedRef.current = true;
          observer.disconnect();
          setLoading(true);

          fetch(`/api/contacts/${encodeURIComponent(contactId)}/score`, {
            // Short cache: score changes rarely but we don't want stale data
            next: { revalidate: 300 },
          } as RequestInit)
            .then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return res.json() as Promise<ScoreResponse>;
            })
            .then((data) => {
              setScore(data.score ?? null);
            })
            .catch(() => {
              setFailed(true);
            })
            .finally(() => {
              setLoading(false);
            });
        }
      },
      { rootMargin: "100px" } // pre-load slightly before entering view
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [contactId, disabled]);

  if (disabled || failed) {
    return (
      <span
        ref={ref}
        className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-bisque-50 text-bisque-300 border border-bisque-100"
        title="Score unavailable"
      >
        —
      </span>
    );
  }

  if (loading) {
    return (
      <span
        ref={ref}
        className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-bisque-50 text-bisque-300 border border-bisque-100 animate-pulse"
        title="Loading score…"
      >
        …
      </span>
    );
  }

  if (score === null) {
    return (
      <span
        ref={ref}
        className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-bisque-50 text-bisque-400 border border-bisque-100"
        title="Score loads when visible"
      >
        —
      </span>
    );
  }

  // Colored score badge
  let cls: string;
  if (score >= 70) {
    cls = "bg-green-100 text-green-700 border border-green-200";
  } else if (score >= 40) {
    cls = "bg-yellow-100 text-yellow-700 border border-yellow-200";
  } else {
    cls = "bg-red-100 text-red-600 border border-red-200";
  }

  return (
    <span
      ref={ref}
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${cls}`}
      title={`Eloso fit score: ${score}/100`}
    >
      {score}
    </span>
  );
}
