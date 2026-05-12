"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import OutreachTaskList from "@/components/OutreachTaskList";
import SentContactsList from "@/components/SentContactsList";
import SignalsTab from "@/components/SignalsTab";
import type { OutreachTask, GeneratedMessage, TeamMember, ProspectContact } from "@/lib/outreach";

type ActiveTab = "Active" | "Sent" | "Signals";

interface OutreachPageClientProps {
  distributed: Record<TeamMember, OutreachTask[]>;
  messagesPerMember: Record<TeamMember, GeneratedMessage[]>;
  taskCounts: Record<TeamMember, number>;
  teamMembers: TeamMember[];
  allTasks: OutreachTask[];
  allMessages: GeneratedMessage[];
  sentContacts?: ProspectContact[];
  signalContacts?: ProspectContact[];
  /** The logged-in user's TeamMember name, or null if unknown/unauthenticated. */
  currentMember?: TeamMember | null;
}

const BATCH_SIZE = 8;

interface NewBatchResult {
  added: number;
  entityIds: string[];
  note?: string;
}

export default function OutreachPageClient({
  distributed,
  messagesPerMember,
  taskCounts,
  teamMembers,
  allTasks,
  allMessages,
  sentContacts = [],
  signalContacts = [],
  currentMember = null,
}: OutreachPageClientProps) {
  const router = useRouter();
  const [active, setActive] = useState<ActiveTab>("Active");
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<NewBatchResult | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // Optimistic pending count: how many new contacts are loading after New Batch.
  // Shown as a badge until router.refresh() completes and real cards arrive.
  const [pendingCount, setPendingCount] = useState(0);

  // Optimistic removal: IDs removed client-side immediately on "Mark Sent"
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  const handleMarkSentOptimistic = useCallback((id: string) => {
    console.log("[OutreachPage] optimistic remove", id);
    setRemovedIds((prev) => new Set(prev).add(id));
  }, []);

  const handleUnmarkSentOptimistic = useCallback((id: string) => {
    console.log("[OutreachPage] optimistic restore", id);
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleReloadTasks = useCallback(async () => {
    setReloading(true);
    setReloadResult(null);
    setReloadError(null);
    setPendingCount(0);
    try {
      const res = await fetch("/api/outreach/new-batch", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        setReloadError((body.error as string) ?? `Server error ${res.status}`);
        return;
      }
      const data = await res.json() as NewBatchResult;
      setReloadResult(data);
      // Show optimistic "loading" badge immediately while router.refresh() runs
      if (data.added > 0) {
        setPendingCount(data.added);
      }
      // Refresh server data — re-runs the page Server Component
      await router.refresh();
      // Real cards have arrived — clear the pending badge
      setPendingCount(0);
    } catch {
      setReloadError("Network error — check connection and try again.");
      setPendingCount(0);
    } finally {
      setReloading(false);
    }
  }, [router]);

  // batchOffset tracks how many LinkedIn profiles have already been opened
  // across the full allTasks list (not the active tab) — button always works
  // through the entire "Personalized LinkedIn outreach tasks" list.
  const [batchOffset, setBatchOffset] = useState(0);

  // Active tasks are always scoped to the logged-in user's queue.
  // Falls back to all tasks if currentMember is null (unauthenticated/unknown).
  const myTasks = currentMember ? distributed[currentMember] : allTasks;
  const myMessages = currentMember ? messagesPerMember[currentMember] : allMessages;

  const tabs: { label: ActiveTab; count: number; signal?: boolean }[] = [
    { label: "Active", count: myTasks.length },
    { label: "Signals", count: signalContacts.length, signal: signalContacts.length > 0 },
    { label: "Sent", count: sentContacts.length },
  ];

  const isSentTab = active === "Sent";
  const isSignalsTab = active === "Signals";
  const visibleTasks = myTasks.filter((t) => !removedIds.has(t.contact.id));
  const activeTasks = isSentTab || isSignalsTab ? [] : visibleTasks;
  const activeMessages = isSentTab || isSignalsTab ? [] : myMessages;

  // Contacts scoped to the logged-in user's task queue.
  // When currentMember is known, only open that user's assigned contacts.
  // Falls back to the full list if currentMember is null (unauthenticated/unknown).
  const queueTasks = currentMember ? distributed[currentMember] : allTasks;

  /**
   * Return a usable LinkedIn URL for a contact, or null if none is available.
   * Only returns direct profile URLs — search URLs are rejected.
   */
  function getLinkedinUrl(contact: { linkedinUrl?: string }): string | null {
    if (!contact.linkedinUrl) return null;
    const u = contact.linkedinUrl;
    if (u.includes("linkedin.com/search")) return null;
    return u.startsWith("http") ? u : `https://${u}`;
  }

  // Include contacts that have a direct LinkedIn profile URL (no search URL fallbacks).
  const linkedinContacts = queueTasks
    .map((t) => t.contact)
    .filter((c) => getLinkedinUrl(c) !== null);

  // totalWithLinkedin = contacts with a direct LinkedIn profile URL
  const totalWithLinkedin = linkedinContacts.length;
  const exhausted = batchOffset >= totalWithLinkedin;
  const nextBatch = linkedinContacts.slice(batchOffset, batchOffset + BATCH_SIZE);

  const handleOpenNext8 = useCallback(() => {
    if (nextBatch.length === 0) {
      // All batches done — reset
      setBatchOffset(0);
      return;
    }
    for (const contact of nextBatch) {
      const url = getLinkedinUrl(contact);
      if (!url) continue; // skip contacts without a real profile URL
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setBatchOffset((prev) => prev + nextBatch.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextBatch]);

  const handleTabChange = (tab: ActiveTab) => {
    setActive(tab);
    // Do NOT reset batchOffset — the opener works through the user's own queue
    // independent of which tab is currently active in the UI.
  };

  // Button label — reflects progress through the current user's queue
  const queueLabel = currentMember ? `${currentMember}'s` : "all";
  let openButtonLabel: string;
  if (totalWithLinkedin === 0) {
    openButtonLabel = currentMember ? `No contacts in ${currentMember}'s queue` : "No contacts in queue";
  } else if (exhausted) {
    openButtonLabel = "All profiles opened — Reset";
  } else {
    const remaining = totalWithLinkedin - batchOffset;
    const batchCount = Math.min(BATCH_SIZE, remaining);
    openButtonLabel = `Open Next ${batchCount} LinkedIn (${queueLabel} queue${batchOffset > 0 ? `, ${batchOffset}/${totalWithLinkedin} done` : `, ${totalWithLinkedin} total`})`;
  }

  return (
    <div className="space-y-4">
      {/* Mobile: horizontally scrollable pill tabs */}
      <div className="md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {tabs.map(({ label, count, signal }) => (
            <button
              key={label}
              onClick={() => handleTabChange(label)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold min-h-[44px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 ${
                active === label
                  ? "bg-bisque-700 text-bisque-50"
                  : "bg-bisque-100 text-bisque-600"
              }`}
              aria-selected={active === label}
              role="tab"
            >
              {label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  active === label
                    ? "bg-bisque-600 text-bisque-100"
                    : signal
                    ? "bg-amber-500 text-white"
                    : "bg-bisque-200 text-bisque-500"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Reload result / error banner */}
      {reloadResult && (
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {reloadResult.added > 0
            ? `New Batch — ${reloadResult.added} fresh prospects added to your queue. Messages generating…`
            : (reloadResult.note ?? "No new prospects available in the pool.")}
        </div>
      )}
      {reloadError && (
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {reloadError}
        </div>
      )}

      {/* Desktop: tab bar + Open Next 8 button (hidden on mobile) */}
      <div className="hidden md:flex items-end justify-between gap-4 border-b border-bisque-200">
        <div className="flex gap-1">
          {tabs.map(({ label, count, signal }) => (
            <button
              key={label}
              onClick={() => handleTabChange(label)}
              className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 flex items-center gap-2 ${
                active === label
                  ? "bg-white border-bisque-200 text-bisque-900 -mb-px relative z-10"
                  : "bg-bisque-50 border-transparent text-bisque-500 hover:text-bisque-700 hover:bg-bisque-100"
              }`}
              aria-selected={active === label}
              role="tab"
            >
              {label}
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  active === label
                    ? "bg-bisque-100 text-bisque-700"
                    : signal
                    ? "bg-amber-500 text-white"
                    : "bg-bisque-200 text-bisque-500"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-1">
          {/* Reload Outreach Tasks button */}
          <button
            onClick={handleReloadTasks}
            disabled={reloading}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 flex items-center gap-2 border ${
              reloading
                ? "bg-bisque-50 text-bisque-400 cursor-not-allowed border-bisque-100"
                : "bg-bisque-50 text-bisque-700 border-bisque-200 hover:bg-bisque-100"
            }`}
            title="Pull 12 fresh prospects into your personal queue, scored by sector affinity"
          >
            <svg
              className={`w-4 h-4 shrink-0 ${reloading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {reloading ? "Loading…" : "New Batch"}
          </button>

          {/* Open Next 8 LinkedIn Profiles button */}
          <button
            onClick={handleOpenNext8}
            disabled={totalWithLinkedin === 0}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 flex items-center gap-2 ${
              totalWithLinkedin === 0
                ? "bg-bisque-50 text-bisque-300 cursor-not-allowed border border-bisque-100"
                : exhausted
                ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
            title={
              totalWithLinkedin === 0
                ? currentMember
                  ? `No contacts in ${currentMember}'s assigned queue`
                  : "No contacts in queue"
                : exhausted
                ? "All profiles have been opened. Click to reset."
                : `Opens ${Math.min(BATCH_SIZE, totalWithLinkedin - batchOffset)} LinkedIn profiles from ${queueLabel} queue (${totalWithLinkedin} total)`
            }
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            {openButtonLabel}
          </button>
        </div>
      </div>

      {/* Mobile: Reload Tasks button */}
      <div className="md:hidden">
        <button
          onClick={handleReloadTasks}
          disabled={reloading}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-lg text-sm font-semibold transition-colors focus:outline-none border ${
            reloading
              ? "bg-bisque-50 text-bisque-400 cursor-not-allowed border-bisque-100"
              : "bg-bisque-50 text-bisque-700 border-bisque-200"
          }`}
        >
          <svg
            className={`w-4 h-4 shrink-0 ${reloading ? "animate-spin" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {reloading ? "Loading…" : "New Batch"}
        </button>
        {reloadResult && (
          <p className="mt-1 text-xs text-green-700 text-center">
            {reloadResult.added > 0
              ? `${reloadResult.added} fresh prospects added`
              : (reloadResult.note ?? "No new prospects available.")}
          </p>
        )}
        {reloadError && (
          <p className="mt-1 text-xs text-red-600 text-center">{reloadError}</p>
        )}
      </div>

      {/* Mobile: Open Next 8 button (shown below tabs) */}
      {totalWithLinkedin > 0 && (
        <div className="md:hidden">
          <button
            onClick={handleOpenNext8}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-lg text-sm font-semibold transition-colors focus:outline-none ${
              exhausted
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-blue-600 text-white"
            }`}
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            {openButtonLabel}
          </button>
        </div>
      )}

      {/* Tab panel */}
      <div
        role="tabpanel"
        aria-label={
          active === "Sent"
            ? "Sent contacts"
            : active === "Signals"
            ? "Signal contacts"
            : "Active outreach tasks"
        }
      >
        {isSentTab ? (
          <SentContactsList contacts={sentContacts} />
        ) : isSignalsTab ? (
          <SignalsTab contacts={signalContacts} />
        ) : (
          <>
            {pendingCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 mb-3 bg-bisque-50 border border-bisque-200 rounded-lg text-sm text-bisque-600 animate-pulse">
                <svg className="w-4 h-4 shrink-0 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                + {pendingCount} new contact{pendingCount !== 1 ? "s" : ""} loading…
              </div>
            )}
            <OutreachTaskList
              tasks={activeTasks}
              messages={activeMessages}
              onMarkSent={handleMarkSentOptimistic}
              onUnmarkSent={handleUnmarkSentOptimistic}
            />
          </>
        )}
      </div>
    </div>
  );
}
