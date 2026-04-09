"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type EnrichState =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "error";

interface EnrichResult {
  contacts_added: number;
  duplicates_skipped: number;
  fuzzy_flagged: number;
  skipped_fresh: number;
  sources_attempted: string[];
  errors: string[];
  dry_run: boolean;
}

interface EnrichButtonProps {
  contactId: string;
  /** If true, passes dry_run=true to the pipeline — no writes to Kissinger. */
  dryRun?: boolean;
  /** Called when enrichment completes successfully, so the parent can refresh. */
  onComplete?: (result: EnrichResult) => void;
}

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export default function EnrichButton({
  contactId,
  dryRun = false,
  onComplete,
}: EnrichButtonProps) {
  const [state, setState] = useState<EnrichState>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartRef = useRef<number>(0);

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Poll for run status
  const pollStatus = useCallback(
    async (id: string) => {
      // Guard: max polling duration
      if (Date.now() - pollStartRef.current > MAX_POLL_DURATION_MS) {
        stopPolling();
        setState("error");
        setErrorMessage("Enrichment timed out. Check logs for details.");
        return;
      }

      try {
        const res = await fetch(
          `/api/contacts/${encodeURIComponent(contactId)}/enrich/status?run_id=${encodeURIComponent(id)}`
        );
        if (!res.ok) {
          stopPolling();
          setState("error");
          setErrorMessage("Could not read enrichment status.");
          return;
        }

        const data = (await res.json()) as {
          status: "running" | "completed" | "failed";
          contacts_added?: number;
          duplicates_skipped?: number;
          fuzzy_flagged?: number;
          skipped_fresh?: number;
          sources_attempted?: string[];
          errors?: string[];
          dry_run?: boolean;
        };

        if (data.status === "completed" || data.status === "failed") {
          stopPolling();
          setState(data.status);

          if (data.status === "completed") {
            const enrichResult: EnrichResult = {
              contacts_added: data.contacts_added ?? 0,
              duplicates_skipped: data.duplicates_skipped ?? 0,
              fuzzy_flagged: data.fuzzy_flagged ?? 0,
              skipped_fresh: data.skipped_fresh ?? 0,
              sources_attempted: data.sources_attempted ?? [],
              errors: data.errors ?? [],
              dry_run: data.dry_run ?? false,
            };
            setResult(enrichResult);
            onComplete?.(enrichResult);
          } else {
            setErrorMessage(
              data.errors?.join("; ") || "Enrichment failed."
            );
          }
        }
        // If still "running", do nothing — next tick will poll again
      } catch {
        stopPolling();
        setState("error");
        setErrorMessage("Lost connection while polling enrichment status.");
      }
    },
    [contactId, stopPolling, onComplete]
  );

  // Trigger enrichment
  const startEnrichment = useCallback(async () => {
    setState("starting");
    setErrorMessage(null);
    setResult(null);

    try {
      const res = await fetch(
        `/api/contacts/${encodeURIComponent(contactId)}/enrich`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dry_run: dryRun }),
        }
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState("error");
        setErrorMessage(body.error ?? "Failed to start enrichment.");
        return;
      }

      const data = (await res.json()) as { run_id: string };
      if (!data.run_id) {
        setState("error");
        setErrorMessage("No run_id returned from server.");
        return;
      }

      setRunId(data.run_id);
      setState("running");
      pollStartRef.current = Date.now();

      // Begin polling
      pollIntervalRef.current = setInterval(() => {
        void pollStatus(data.run_id);
      }, POLL_INTERVAL_MS);

      // Immediate first poll
      void pollStatus(data.run_id);
    } catch {
      setState("error");
      setErrorMessage("Network error. Please try again.");
    }
  }, [contactId, dryRun, pollStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const isRunning = state === "starting" || state === "running";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          onClick={() => void startEnrichment()}
          disabled={isRunning}
          className={[
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
            "border focus:outline-none focus:ring-2 focus:ring-offset-1",
            isRunning
              ? "bg-bisque-100 text-bisque-400 border-bisque-200 cursor-not-allowed"
              : state === "completed"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
              : state === "failed" || state === "error"
              ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 focus:ring-red-300"
              : "bg-white text-bisque-700 border-bisque-200 hover:bg-bisque-50 hover:border-bisque-300 focus:ring-bisque-300",
          ].join(" ")}
          title={
            isRunning
              ? "Enrichment in progress…"
              : state === "completed"
              ? "Enrichment complete — click to re-enrich"
              : state === "failed" || state === "error"
              ? "Enrichment failed — click to retry"
              : dryRun
              ? "Simulate enrichment (dry run — no writes)"
              : "Enrich this contact from available data sources"
          }
        >
          {isRunning ? (
            <>
              <Spinner />
              {state === "starting" ? "Starting…" : "Enriching…"}
            </>
          ) : state === "completed" ? (
            <>
              <CheckIcon />
              {dryRun ? "Dry run done" : "Enriched"}
            </>
          ) : state === "failed" || state === "error" ? (
            <>
              <ErrorIcon />
              Retry Enrich
            </>
          ) : (
            <>
              <EnrichIcon />
              {dryRun ? "Dry Run Enrich" : "Enrich"}
            </>
          )}
        </button>

        {/* Status badge */}
        {state === "running" && runId && (
          <span className="text-xs text-bisque-400 font-mono truncate max-w-[180px]" title={runId}>
            run: {runId.slice(0, 8)}…
          </span>
        )}
      </div>

      {/* Result summary — shown after completion */}
      {state === "completed" && result && (
        <div className="text-xs text-bisque-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 space-y-0.5">
          {result.dry_run && (
            <p className="font-semibold text-amber-600">Dry run — no writes made</p>
          )}
          <p>
            <span className="font-medium text-emerald-700">
              {result.contacts_added}
            </span>{" "}
            contact{result.contacts_added !== 1 ? "s" : ""} added
            {result.duplicates_skipped > 0 && (
              <> · <span className="text-bisque-500">{result.duplicates_skipped} duplicate{result.duplicates_skipped !== 1 ? "s" : ""} skipped</span></>
            )}
            {result.fuzzy_flagged > 0 && (
              <> · <span className="text-amber-600">{result.fuzzy_flagged} fuzzy match{result.fuzzy_flagged !== 1 ? "es" : ""} flagged</span></>
            )}
            {result.skipped_fresh > 0 && (
              <> · <span className="text-bisque-400">{result.skipped_fresh} already fresh</span></>
            )}
          </p>
          {result.sources_attempted.length > 0 && (
            <p className="text-bisque-400">
              Sources: {result.sources_attempted.join(", ")}
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="text-red-500">
              {result.errors.length} error{result.errors.length !== 1 ? "s" : ""} — check logs
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {(state === "failed" || state === "error") && errorMessage && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon subcomponents
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="animate-spin h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function EnrichIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}
