"use client";

import { useEffect, useState } from "react";
import type { IntroPathResult, IntroPathStep } from "@/lib/kissinger";

interface IntroPathTabProps {
  contactId: string;
  contactName: string;
}

type LoadState = "loading" | "loaded" | "error";

export default function IntroPathTab({ contactId, contactName }: IntroPathTabProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [result, setResult] = useState<IntroPathResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setResult(null);

    fetch(`/api/contacts/${encodeURIComponent(contactId)}/intro-path`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<IntroPathResult>;
      })
      .then((data) => {
        setResult(data);
        setState("loaded");
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setState("error");
        }
      });

    return () => controller.abort();
  }, [contactId]);

  if (state === "loading") {
    return <IntroPathSkeleton />;
  }

  if (state === "error") {
    return (
      <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-8 text-center">
        <p className="text-red-500 text-sm">Could not load intro path. Please try again.</p>
      </div>
    );
  }

  if (!result || !result.found) {
    return <IntroPathEmpty />;
  }

  return <IntroPathFound result={result} targetName={contactName} />;
}

// ---------------------------------------------------------------------------
// Path found — linear chain visualization
// ---------------------------------------------------------------------------

function IntroPathFound({
  result,
  targetName,
}: {
  result: IntroPathResult;
  targetName: string;
}) {
  const { hops, steps } = result;

  // The first connector is steps[1] (index 0 is the team member source)
  const firstConnector = steps.length > 1 ? steps[1].name : steps[0]?.name;
  const label =
    hops === 1
      ? `1-hop intro via ${firstConnector}`
      : `${hops}-hop intro via ${firstConnector}`;

  return (
    <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-6 space-y-5">
      {/* Heading */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-bisque-700">{label}</span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          Warm intro available
        </span>
      </div>

      {/* Chain */}
      <div className="flex flex-col gap-0 sm:flex-row sm:flex-wrap sm:items-center">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const isTarget = isLast;
          return (
            <PathNode
              key={step.personId}
              step={step}
              isTarget={isTarget}
              relationToNext={step.relationToNext}
              showArrow={!isLast}
              // Override the target name with the canonical contact name
              overrideName={isTarget ? targetName : undefined}
            />
          );
        })}
      </div>

      <p className="text-xs text-bisque-400 italic">
        Intro paths are discovered by traversing &ldquo;knows&rdquo; edges in your network graph.
      </p>
    </div>
  );
}

function PathNode({
  step,
  isTarget,
  relationToNext,
  showArrow,
  overrideName,
}: {
  step: IntroPathStep;
  isTarget: boolean;
  relationToNext: string | null;
  showArrow: boolean;
  overrideName?: string;
}) {
  const name = overrideName ?? step.name;
  const relation = relationToNext ? relationToNext.replace(/_/g, " ") : "knows";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0">
      {/* Person card */}
      <div
        className={`flex flex-col min-w-0 px-3 py-2 rounded-lg ${
          isTarget
            ? "bg-bisque-700 text-white"
            : "bg-bisque-50 text-bisque-900 border border-bisque-100"
        }`}
      >
        <span className="font-semibold text-sm leading-tight truncate max-w-[160px]">
          {name}
        </span>
        {(step.title || step.organization) && (
          <span
            className={`text-xs mt-0.5 truncate max-w-[160px] ${
              isTarget ? "text-bisque-200" : "text-bisque-500"
            }`}
          >
            {step.title}
            {step.title && step.organization ? " at " : ""}
            {step.organization}
          </span>
        )}
      </div>

      {/* Arrow + relation label */}
      {showArrow && (
        <div className="flex sm:flex-col items-center sm:items-start gap-0.5 px-2 py-1">
          <div className="flex items-center gap-1">
            <div className="hidden sm:block h-px w-5 bg-bisque-300" />
            <span className="text-bisque-400 text-xs hidden sm:inline">({relation})</span>
            <div className="hidden sm:block h-px w-2 bg-bisque-300" />
            <span className="hidden sm:block text-bisque-400 text-sm">&#9654;</span>
          </div>
          {/* Mobile: vertical arrow */}
          <div className="sm:hidden flex flex-col items-center gap-0.5 pl-3">
            <span className="text-bisque-400 text-xs italic">({relation})</span>
            <span className="text-bisque-400">&#9660;</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — no path found
// ---------------------------------------------------------------------------

function IntroPathEmpty() {
  return (
    <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-8 text-center space-y-3">
      <div className="text-4xl">&#128247;</div>
      <div>
        <p className="font-medium text-bisque-800">No intro path found yet</p>
        <p className="text-bisque-500 text-sm mt-1">
          Import your LinkedIn connections to discover warm intro paths
        </p>
      </div>
      <div className="pt-2">
        <a
          href="https://www.linkedin.com/mynetwork/invite-connect/connections/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-bisque-700 text-white rounded-lg text-sm font-medium hover:bg-bisque-800 transition-colors"
        >
          Import LinkedIn connections &#8594;
        </a>
      </div>
      <p className="text-xs text-bisque-400 italic">
        Export your LinkedIn connections as CSV and import via the Kissinger CLI,
        or contact your admin to connect your account.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function IntroPathSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-6 space-y-4 animate-pulse">
      <div className="h-4 w-40 bg-bisque-100 rounded" />
      <div className="flex items-center gap-3">
        <div className="h-12 w-32 bg-bisque-100 rounded-lg" />
        <div className="h-3 w-12 bg-bisque-50 rounded" />
        <div className="h-12 w-32 bg-bisque-100 rounded-lg" />
        <div className="h-3 w-12 bg-bisque-50 rounded" />
        <div className="h-12 w-36 bg-bisque-200 rounded-lg" />
      </div>
    </div>
  );
}
