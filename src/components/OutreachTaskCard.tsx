"use client";

import { useState, useCallback } from "react";
import type { OutreachTask, GeneratedMessage, OutreachStage } from "@/lib/outreach";
import ResponseDrawer from "./ResponseDrawer";

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

// ---------------------------------------------------------------------------
// Stage badge helpers
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<OutreachStage, string> = {
  cold: "Cold",
  touched_1: "Touch 1",
  touched_2: "Touch 2",
  touched_3: "Touch 3",
  responded: "Responded",
};

const STAGE_COLORS: Record<OutreachStage, string> = {
  cold: "bg-bisque-100 text-bisque-500",
  touched_1: "bg-blue-50 text-blue-600 border border-blue-200",
  touched_2: "bg-amber-50 text-amber-700 border border-amber-200",
  touched_3: "bg-orange-50 text-orange-700 border border-orange-200",
  responded: "bg-green-50 text-green-700 border border-green-200",
};

/** Which touch number to send next from this stage (or null if not applicable). */
function nextTouchNumber(stage: OutreachStage): number | null {
  if (stage === "cold") return 1;
  if (stage === "touched_1") return 2;
  if (stage === "touched_2") return 3;
  return null; // touched_3 or responded — no more touches
}

function StageBadge({ stage }: { stage: OutreachStage }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[stage]}`}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OutreachTaskCard({ task, message, claudeEnabled = false }: OutreachTaskCardProps) {
  const { contact } = task;

  // Stage state — initialized from contact, can be updated optimistically
  const initialStage: OutreachStage = contact.outreachStage ?? "cold";
  const [stage, setStage] = useState<OutreachStage>(initialStage);

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [personalizing, setPersonalizing] = useState(false);
  // Track the timestamp of the most recent in-session generation.
  // null means no regeneration has happened this session — fall back to the
  // stored Kissinger value (contact.outreachMessageGeneratedAt).
  const [localGeneratedAt, setLocalGeneratedAt] = useState<string | null>(null);

  // If a stored outreach_message exists in Kissinger meta, show it immediately
  // without requiring the user to click "Personalize with AI".
  const storedMessage = contact.outreachMessage;
  const [displayMessage, setDisplayMessage] = useState<DisplayMessage>(() => {
    if (storedMessage) {
      return { text: storedMessage, source: "claude", angle: message.angle };
    }
    return { text: message.message, source: "template", angle: message.angle };
  });
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);

  // Mark Sent state
  const [markingTouch, setMarkingTouch] = useState(false);
  const [touchError, setTouchError] = useState<string | null>(null);

  // Skip state
  const [skipped, setSkipped] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // Log Response drawer
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Feedback state
  const [feedbackThumb, setFeedbackThumb] = useState<"up" | "down" | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);

  const touchNumber = nextTouchNumber(stage);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(displayMessage.text);
      } else {
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
      // Silent fail — user can select and copy manually
    }
  }, [displayMessage.text]);

  const handlePersonalize = useCallback(async () => {
    setPersonalizing(true);
    setPersonalizeError(null);
    try {
      const res = await fetch("/api/outreach/generate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: task.contact,
          assignee: task.assignee,
          entityId: task.contact.id,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { message: string; source: MessageSource; angle: "vision" | "technical" | "strategic" };
      setDisplayMessage({ text: data.message, source: data.source, angle: data.angle });
      // Record the actual generation time for this session so the provenance note
      // does not show the stale stored timestamp from Kissinger.
      setLocalGeneratedAt(new Date().toISOString());
    } catch {
      setPersonalizeError("Personalization failed — using template.");
    } finally {
      setPersonalizing(false);
    }
  }, [task.contact, task.assignee]);

  const handleMarkSent = useCallback(async () => {
    if (touchNumber === null) return;
    setMarkingTouch(true);
    setTouchError(null);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/outreach-touch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ touchNumber }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { newStage: OutreachStage };
      setStage(data.newStage);
    } catch (err) {
      setTouchError(err instanceof Error ? err.message : "Failed to mark sent");
    } finally {
      setMarkingTouch(false);
    }
  }, [contact.id, touchNumber]);

  const handleSkip = useCallback(async () => {
    setSkipping(true);
    try {
      const res = await fetch("/api/outreach/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: contact.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSkipped(true);
    } catch (err) {
      setTouchError(err instanceof Error ? err.message : "Failed to skip");
    } finally {
      setSkipping(false);
    }
  }, [contact.id]);

  const handleResponseSuccess = useCallback((responseType: string) => {
    setDrawerOpen(false);
    setStage("responded");
    // Brief confirmation in the touch error slot (green, not red)
    setTouchError(null);
    console.log("Response logged:", responseType);
  }, []);

  const handleFeedbackThumb = useCallback((thumb: "up" | "down") => {
    setFeedbackThumb(thumb);
    setShowFeedbackInput(true);
    setFeedbackSubmitted(false);
  }, []);

  const handleFeedbackSubmit = useCallback(async (thumbOverride?: "up" | "down") => {
    const thumb = thumbOverride ?? feedbackThumb;
    if (!thumb) return;
    setFeedbackSubmitting(true);
    try {
      await fetch("/api/outreach/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: contact.id,
          thumb,
          text: feedbackText || undefined,
        }),
      });
      setFeedbackSubmitted(true);
      setShowFeedbackInput(false);
    } catch {
      // Silent fail — feedback is non-critical
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [feedbackThumb, feedbackText, contact.id]);

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
    <>
      {drawerOpen && (
        <ResponseDrawer
          contactId={contact.id}
          contactName={contact.name}
          onClose={() => setDrawerOpen(false)}
          onSuccess={handleResponseSuccess}
        />
      )}

      <div className={`rounded-xl border shadow-sm overflow-hidden transition-all ${skipped ? "bg-gray-50 border-gray-200 opacity-60" : "bg-white border-bisque-100"}`}>
        {/* Card header */}
        <div className="px-4 md:px-5 py-4">
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
                {/* Outreach stage badge */}
                <StageBadge stage={stage} />
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

            {/* Desktop action buttons */}
            <div className="hidden md:flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {claudeEnabled && (
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
                  ) : displayMessage.source === "claude" ? (
                    <>↺ Regenerate</>
                  ) : (
                    <>✦ Personalize with AI</>
                  )}
                </button>
              )}
              {displayMessage.source === "claude" && !personalizing && (
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
              {/* Mark Sent button */}
              {touchNumber !== null && stage !== "responded" && (
                <button
                  onClick={handleMarkSent}
                  disabled={markingTouch}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {markingTouch ? "Marking…" : `Mark Sent (T${touchNumber})`}
                </button>
              )}
              {/* Log Response button — only show once at least one touch has been sent */}
              {stage !== "cold" && stage !== "responded" && (
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-bisque-200 bg-white text-bisque-700 hover:bg-bisque-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
                >
                  Log Response
                </button>
              )}
              {stage === "responded" && (
                <span className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-100 border border-green-200 text-green-700">
                  Responded ✓
                </span>
              )}
              {/* Skip button / Skipped badge */}
              {skipped ? (
                <span className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 border border-gray-200 text-gray-500">
                  Skipped ✓
                </span>
              ) : (
                <button
                  onClick={handleSkip}
                  disabled={skipping}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {skipping ? "Skipping…" : "Skip"}
                </button>
              )}
            </div>
          </div>

          {personalizeError && (
            <p className="text-xs text-amber-600 mt-2">{personalizeError}</p>
          )}
          {touchError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
              {touchError}
            </p>
          )}

          {/* Mobile action row */}
          <div className="flex md:hidden gap-2 mt-3 flex-wrap">
            {claudeEnabled && (
              <button
                onClick={handlePersonalize}
                disabled={personalizing}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg bg-violet-50 border border-violet-200 text-violet-700 transition-colors focus:outline-none disabled:opacity-50"
                aria-label={displayMessage.source === "claude" ? "Regenerate AI message" : "Personalize with AI"}
              >
                {personalizing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    …
                  </>
                ) : displayMessage.source === "claude" ? (
                  <>↺</>
                ) : (
                  <>✦</>
                )}
              </button>
            )}
            <button
              onClick={handleCopy}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-sm font-semibold rounded-lg transition-colors focus:outline-none ${
                copied
                  ? "bg-green-100 text-green-700 border border-green-200"
                  : "bg-bisque-700 text-bisque-50"
              }`}
              aria-label="Copy LinkedIn message to clipboard"
            >
              {copied ? (
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                  <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                </svg>
              )}
            </button>
            {/* Mobile: Mark Sent */}
            {touchNumber !== null && stage !== "responded" && (
              <button
                onClick={handleMarkSent}
                disabled={markingTouch}
                className="flex items-center justify-center px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg bg-blue-600 text-white transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                aria-label={`Mark touch ${touchNumber} sent`}
              >
                {markingTouch ? "…" : `✓ T${touchNumber}`}
              </button>
            )}
            {/* Mobile: Log Response */}
            {stage !== "cold" && stage !== "responded" && (
              <button
                onClick={() => setDrawerOpen(true)}
                className="flex items-center justify-center px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg border border-bisque-200 text-bisque-700 transition-colors focus:outline-none whitespace-nowrap"
                aria-label="Log response from contact"
              >
                Reply
              </button>
            )}
            {stage === "responded" && (
              <span className="flex items-center justify-center px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg bg-green-100 border border-green-200 text-green-700 whitespace-nowrap">
                Responded ✓
              </span>
            )}
            {/* Mobile: Skip / Skipped */}
            {skipped ? (
              <span className="flex items-center justify-center px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg bg-gray-100 border border-gray-200 text-gray-500 whitespace-nowrap">
                Skipped ✓
              </span>
            ) : (
              <button
                onClick={handleSkip}
                disabled={skipping}
                className="flex items-center justify-center px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg border border-gray-200 text-gray-400 transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                aria-label="Skip this prospect"
              >
                {skipping ? "…" : "Skip"}
              </button>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center justify-center px-3 py-2.5 min-h-[44px] rounded-lg border border-bisque-200 text-bisque-700 transition-colors focus:outline-none"
              aria-label={expanded ? "Hide message preview" : "Show message preview"}
            >
              <svg
                className={`w-5 h-5 transition-transform ${expanded ? "rotate-180" : ""}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Feedback row */}
        {!feedbackSubmitted ? (
          <div className="px-4 md:px-5 pb-3 pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-bisque-400">This prospect:</span>
              <button
                onClick={() => handleFeedbackThumb("up")}
                className={`text-base leading-none rounded px-1.5 py-0.5 transition-colors focus:outline-none ${
                  feedbackThumb === "up"
                    ? "bg-green-100 text-green-600"
                    : "text-bisque-400 hover:text-green-500 hover:bg-green-50"
                }`}
                aria-label="Thumbs up — good prospect"
                title="Good prospect"
              >
                👍
              </button>
              <button
                onClick={() => handleFeedbackThumb("down")}
                className={`text-base leading-none rounded px-1.5 py-0.5 transition-colors focus:outline-none ${
                  feedbackThumb === "down"
                    ? "bg-red-50 text-red-500"
                    : "text-bisque-400 hover:text-red-400 hover:bg-red-50"
                }`}
                aria-label="Thumbs down — bad prospect"
                title="Not a good prospect"
              >
                👎
              </button>
            </div>
            {showFeedbackInput && feedbackThumb && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFeedbackSubmit();
                  }}
                  placeholder="Optional: tell us why..."
                  className="flex-1 text-xs border border-bisque-200 rounded px-2 py-1.5 text-bisque-700 placeholder:text-bisque-300 focus:outline-none focus:ring-1 focus:ring-bisque-300"
                />
                <button
                  onClick={() => handleFeedbackSubmit()}
                  disabled={feedbackSubmitting}
                  className="px-2 py-1.5 text-xs font-medium rounded bg-bisque-100 text-bisque-700 hover:bg-bisque-200 transition-colors focus:outline-none disabled:opacity-50 whitespace-nowrap"
                >
                  {feedbackSubmitting ? "…" : "Submit"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 md:px-5 pb-3 pt-1">
            <span className="text-xs text-bisque-400">Thanks for the feedback!</span>
          </div>
        )}

        {/* Expandable message panel */}
        {expanded && (
          <div className="border-t border-bisque-100 bg-bisque-50/50 px-4 md:px-5 py-4 space-y-3">
            {/* Angle badge + copy button (desktop) */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-medium text-bisque-500 uppercase tracking-wide">
                LinkedIn outreach — {angleLabels[displayMessage.angle] ?? displayMessage.angle}
                {displayMessage.source === "claude" && (
                  <span className="ml-2 text-violet-500">· AI-personalized</span>
                )}
              </span>
              {/* Desktop copy button inside expanded panel */}
              <button
                onClick={handleCopy}
                className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 ${
                  copied
                    ? "bg-green-100 text-green-700 border border-green-200"
                    : "bg-bisque-700 text-bisque-50 hover:bg-bisque-600"
                }`}
                aria-label="Copy message to clipboard"
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
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

            {/* Provenance note.
                Use localGeneratedAt (set on regeneration in this session) in preference
                to contact.outreachMessageGeneratedAt (the stale stored value from Kissinger).
                This prevents the timestamp from showing the old generation date after a
                Regenerate click. */}
            <p className="text-xs text-bisque-400">
              {displayMessage.source === "claude" ? (
                (() => {
                  const ts = localGeneratedAt ?? contact.outreachMessageGeneratedAt;
                  const label = localGeneratedAt ? "Generated" : "Stored";
                  return ts ? (
                    <>{label} {new Date(ts).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })} · sender: {contact.outreachMessageSender ?? task.assignee.toLowerCase()} · </>
                  ) : (
                    <>AI-personalized · sender: {contact.outreachMessageSender ?? task.assignee.toLowerCase()} · </>
                  );
                })()
              ) : (
                <>Generated {new Date(task.generatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })} · </>
              )}
              Contact ID: {contact.id.slice(0, 8)}… · Source: {displayMessage.source}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
