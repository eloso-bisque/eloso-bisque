"use client";

import { useState, useCallback } from "react";
import type { OutreachTask, GeneratedMessage } from "@/lib/outreach";

interface OutreachTaskCardProps {
  task: OutreachTask;
  message: GeneratedMessage;
  /** If true, show "Personalize with AI" button (API key available) */
  claudeEnabled?: boolean;
}

type MessageSource = "template" | "claude";

interface DisplayMessage {
  text: string;
  source: MessageSource;
  angle: "vision" | "technical" | "strategic";
}

export default function OutreachTaskCard({ task, message, claudeEnabled = false }: OutreachTaskCardProps) {
  const { contact } = task;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [personalizing, setPersonalizing] = useState(false);
  const [displayMessage, setDisplayMessage] = useState<DisplayMessage>({
    text: message.message,
    source: "template",
    angle: message.angle,
  });
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(displayMessage.text);
      } else {
        // Fallback for environments without clipboard API
        const ta = document.createElement("textarea");
        ta.value = displayMessage.text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silent fail — user can still select and copy manually
    }
  }, [displayMessage.text]);

  const handlePersonalize = useCallback(async () => {
    setPersonalizing(true);
    setPersonalizeError(null);
    try {
      const res = await fetch("/api/outreach/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: task.contact, assignee: task.assignee }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { message: string; source: MessageSource; angle: "vision" | "technical" | "strategic" };
      setDisplayMessage({ text: data.message, source: data.source, angle: data.angle });
    } catch {
      setPersonalizeError("Personalization failed — using template.");
    } finally {
      setPersonalizing(false);
    }
  }, [task.contact, task.assignee]);

  const fitColors: Record<string, string> = {
    high: "bg-green-100 text-green-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-bisque-100 text-bisque-600",
  };

  const angleLabels: Record<string, string> = {
    vision: "Vision angle",
    technical: "Technical angle",
    strategic: "Strategic angle",
  };

  return (
    <div className="bg-white rounded-xl border border-bisque-100 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-bisque-900 text-base">
                {contact.name}
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  fitColors[contact.fitTier] ?? fitColors.high
                }`}
              >
                fit-{contact.fitTier}
              </span>
            </div>
            <p className="text-sm text-bisque-600 mt-0.5">
              {contact.title}
              {contact.company ? ` · ${contact.company}` : ""}
            </p>
            {contact.sector.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {contact.sector.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 rounded-full text-xs bg-bisque-100 text-bisque-600"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {claudeEnabled && displayMessage.source === "template" && (
              <button
                onClick={handlePersonalize}
                disabled={personalizing}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {personalizing ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Personalizing…
                  </>
                ) : (
                  <>✦ Personalize with AI</>
                )}
              </button>
            )}
            {displayMessage.source === "claude" && (
              <span className="px-2 py-1 text-xs font-medium rounded-lg bg-violet-50 border border-violet-200 text-violet-600">
                ✦ AI-personalized
              </span>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-bisque-200 text-bisque-700 hover:bg-bisque-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
            >
              {expanded ? "Hide message" : "Show message"}
            </button>
          </div>
        </div>
        {personalizeError && (
          <p className="text-xs text-amber-600 mt-2">{personalizeError}</p>
        )}
      </div>

      {/* Expandable message panel */}
      {expanded && (
        <div className="border-t border-bisque-100 bg-bisque-50/50 px-5 py-4 space-y-3">
          {/* Angle badge + copy button */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-medium text-bisque-500 uppercase tracking-wide">
              LinkedIn outreach — {angleLabels[displayMessage.angle] ?? displayMessage.angle}
              {displayMessage.source === "claude" && (
                <span className="ml-2 text-violet-500">· AI-personalized</span>
              )}
            </span>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 ${
                copied
                  ? "bg-green-100 text-green-700 border border-green-200"
                  : "bg-bisque-700 text-bisque-50 hover:bg-bisque-600"
              }`}
              aria-label="Copy message to clipboard"
            >
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>

          {/* Message text */}
          <div className="bg-white rounded-lg border border-bisque-100 p-4">
            <p className="text-sm text-bisque-800 leading-relaxed whitespace-pre-wrap">
              {displayMessage.text}
            </p>
          </div>

          {/* Provenance note */}
          <p className="text-xs text-bisque-400">
            Generated {new Date(task.generatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })} · Contact ID: {contact.id.slice(0, 8)}… · Source: {displayMessage.source}
          </p>
        </div>
      )}
    </div>
  );
}
