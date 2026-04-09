"use client";

import { useState, useTransition } from "react";

const PIPELINE_STAGES = [
  "Research",
  "Warm Intro",
  "First Meeting",
  "Partner Meeting",
  "Term Sheet",
  "Closed",
  "Passed",
] as const;

type Stage = (typeof PIPELINE_STAGES)[number];

const STAGE_COLORS: Record<string, string> = {
  Research: "bg-gray-100 text-gray-600",
  "Warm Intro": "bg-blue-100 text-blue-700",
  "First Meeting": "bg-indigo-100 text-indigo-700",
  "Partner Meeting": "bg-violet-100 text-violet-700",
  "Term Sheet": "bg-amber-100 text-amber-700",
  Closed: "bg-green-100 text-green-700",
  Passed: "bg-red-100 text-red-600",
};

interface PipelineStageSelectorProps {
  firmId: string;
  currentStage: string;
}

export default function PipelineStageSelector({
  firmId,
  currentStage,
}: PipelineStageSelectorProps) {
  const [stage, setStage] = useState<string>(currentStage || "Research");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleChange(newStage: string) {
    setStage(newStage);
    setSaved(false);
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/investors/pipeline-stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firmId, stage: newStage }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Failed to update stage");
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  const activeColor = STAGE_COLORS[stage] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="space-y-3">
      {/* Stage pills */}
      <div className="flex flex-wrap gap-2">
        {PIPELINE_STAGES.map((s) => {
          const isActive = stage === s;
          const colorCls = isActive ? STAGE_COLORS[s] : "bg-bisque-50 text-bisque-400";
          return (
            <button
              key={s}
              onClick={() => handleChange(s)}
              disabled={isPending}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                isActive
                  ? `${colorCls} border-current ring-1 ring-current ring-opacity-30`
                  : "border-bisque-100 hover:border-bisque-300 hover:text-bisque-600"
              } ${isPending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              aria-pressed={isActive}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Status */}
      <div className="h-4">
        {isPending && (
          <p className="text-xs text-bisque-400">Saving...</p>
        )}
        {saved && !isPending && (
          <p className="text-xs text-green-600">Saved</p>
        )}
        {error && !isPending && (
          <p className="text-xs text-red-600">{error}</p>
        )}
      </div>

      {/* Current stage display */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-bisque-400">Current stage:</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${activeColor}`}>
          {stage}
        </span>
      </div>
    </div>
  );
}
