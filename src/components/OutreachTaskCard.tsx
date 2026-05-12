"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { OutreachTask, GeneratedMessage, OutreachStage } from "@/lib/outreach";
import { isHotSignal, isWarmSignal, daysSince } from "@/lib/outreach";
import ResponseDrawer from "./ResponseDrawer";

function relativeSignalDate(dateStr: string): string {
  const days = Math.floor(daysSince(dateStr));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

interface OutreachTaskCardProps {
  task: OutreachTask;
  /** Template/AI message. May be undefined when the contact was just added and
   *  async generation hasn't completed yet — card shows a skeleton in that case. */
  message?: GeneratedMessage;
  onMarkSent?: (id: string) => void;
  onUnmarkSent?: (id: string) => void;
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

export default function OutreachTaskCard({ task, message, onMarkSent, onUnmarkSent }: OutreachTaskCardProps) {
  const { contact } = task;
  const router = useRouter();

  // Stage state — initialized from contact, can be updated optimistically
  const initialStage: OutreachStage = contact.outreachStage ?? "cold";
  const [stage, setStage] = useState<OutreachStage>(initialStage);

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // If a stored outreach_message exists in Kissinger meta, show it immediately.
  const storedMessage = contact.outreachMessage;

  // messageGenerating: true when neither a Kissinger-stored message nor a
  // template-generated message is available yet (contact just added to queue).
  const messageGenerating = !storedMessage && !message;

  const displayMessage: DisplayMessage | null = messageGenerating
    ? null
    : storedMessage
      ? { text: storedMessage, source: "claude", angle: message!.angle }
      : { text: message!.message, source: "template", angle: message!.angle };

  // Poll every 10 seconds for a freshly-generated message when none exists yet.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!messageGenerating) {
      // Message is ready — stop any active poll
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    // Start polling — re-fetch server data which will pick up the message once generated
    pollTimerRef.current = setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [messageGenerating, router]);

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
    if (!displayMessage) return;
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
  }, [displayMessage]);

  const handleMarkSent = useCallback(async () => {
    if (touchNumber === null) return;
    // Optimistic removal — card disappears immediately
    onMarkSent?.(contact.id);
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
      // Card is already removed — no need to update internal stage state.
      // Refresh server data so the contact moves to the Sent tab on next render.
      router.refresh();
    } catch (err) {
      // API failed — restore the card
      onUnmarkSent?.(contact.id);
      setTouchError(err instanceof Error ? err.message : "Failed to mark sent");
    } finally {
      setMarkingTouch(false);
    }
  }, [contact.id, touchNumber, router, onMarkSent, onUnmarkSent]);

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
      // Refresh server data so the skipped contact disappears on next render
      router.refresh();
    } catch (err) {
      setTouchError(err instanceof Error ? err.message : "Failed to skip");
    } finally {
      setSkipping(false);
    }
  }, [contact.id, router]);

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
                {/* LinkedIn profile button — only for direct profile URLs, not search fallbacks */}
                {contact.linkedinUrl && !contact.linkedinUrl.includes("linkedin.com/search") && (
                  <a
                    href={contact.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open LinkedIn profile"
                    aria-label="Open LinkedIn profile"
                    className="inline-flex items-center justify-center w-6 h-6 rounded hover:opacity-80 transition-opacity shrink-0"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="24" height="24" rx="4" fill="#0A66C2" />
                      <path d="M7.5 9.5H5V19H7.5V9.5Z" fill="white" />
                      <circle cx="6.25" cy="6.75" r="1.5" fill="white" />
                      <path d="M19 19H16.5V14.25C16.5 13.0074 15.4926 12 14.25 12C13.0074 12 12 13.0074 12 14.25V19H9.5V9.5H12V10.9272C12.6671 10.0313 13.7712 9.5 15 9.5C17.2091 9.5 19 11.2909 19 13.5V19Z" fill="white" />
                    </svg>
                  </a>
                )}
              </div>
              {contact.title && (
                <p className="text-sm text-bisque-600 mt-0.5">{contact.title}</p>
              )}
              {contact.company && (
                <p className="text-sm text-bisque-500 mt-0">{contact.company}</p>
              )}
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
              {contact.lastSignalDate && isWarmSignal(contact) && (
                <div className="mt-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${
                      isHotSignal(contact)
                        ? "bg-amber-100 text-amber-700 border-amber-200"
                        : "bg-green-50 text-green-700 border-green-200"
                    }`}
                  >
                    ⚡ Signalled {relativeSignalDate(contact.lastSignalDate)}
                    {contact.lastSignalKeyword && ` · "${contact.lastSignalKeyword}"`}
                  </span>
                </div>
              )}
            </div>

            {/* Desktop action buttons */}
            <div className="hidden md:flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {messageGenerating ? (
                <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-bisque-100 bg-bisque-50 text-bisque-400">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a10 10 0 100 10h-4a8 8 0 01-8-8z" />
                  </svg>
                  Message generating…
                </span>
              ) : (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-bisque-200 text-bisque-700 hover:bg-bisque-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400"
                >
                  {expanded ? "Hide message" : "Show message"}
                </button>
              )}
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

          {touchError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
              {touchError}
            </p>
          )}

          {/* Mobile action row */}
          <div className="flex md:hidden gap-2 mt-3 flex-wrap">
            {messageGenerating ? (
              <span className="flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] text-sm font-medium rounded-lg bg-bisque-50 border border-bisque-100 text-bisque-400 whitespace-nowrap">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a10 10 0 100 10h-4a8 8 0 01-8-8z" />
                </svg>
                Generating…
              </span>
            ) : (
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
            )}
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

        {/* Expandable message panel — only when not in generating state */}
        {expanded && !messageGenerating && displayMessage && (
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

            {/* Provenance note */}
            <p className="text-xs text-bisque-400">
              {displayMessage.source === "claude" ? (
                (() => {
                  const ts = contact.outreachMessageGeneratedAt;
                  return ts ? (
                    <>Stored {new Date(ts).toLocaleDateString("en-US", {
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
