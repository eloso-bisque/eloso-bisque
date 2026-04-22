"use client";

import { useState, useCallback } from "react";
import OutreachTaskList from "@/components/OutreachTaskList";
import type { OutreachTask, GeneratedMessage, TeamMember } from "@/lib/outreach";

type ActiveTab = "All" | TeamMember;

interface OutreachPageClientProps {
  distributed: Record<TeamMember, OutreachTask[]>;
  messagesPerMember: Record<TeamMember, GeneratedMessage[]>;
  taskCounts: Record<TeamMember, number>;
  teamMembers: TeamMember[];
  allTasks: OutreachTask[];
  allMessages: GeneratedMessage[];
  claudeEnabled?: boolean;
}

const BATCH_SIZE = 8;

export default function OutreachPageClient({
  distributed,
  messagesPerMember,
  taskCounts,
  teamMembers,
  allTasks,
  allMessages,
  claudeEnabled = false,
}: OutreachPageClientProps) {
  const [active, setActive] = useState<ActiveTab>("All");
  // batchOffset tracks how many LinkedIn profiles have already been opened
  // across the full allTasks list (not the active tab) — button always works
  // through the entire "Personalized LinkedIn outreach tasks" list.
  const [batchOffset, setBatchOffset] = useState(0);

  const tabs: { label: ActiveTab; count: number }[] = [
    { label: "All", count: allTasks.length },
    ...teamMembers.map((m) => ({ label: m as ActiveTab, count: taskCounts[m] })),
  ];

  const activeTasks = active === "All" ? allTasks : distributed[active];
  const activeMessages = active === "All" ? allMessages : messagesPerMember[active];

  // Contacts with LinkedIn URLs from the FULL list (not filtered by tab).
  // The batch opener always steps through all prospect contacts in order,
  // regardless of which team-member tab is currently selected.
  const linkedinContacts = allTasks
    .map((t) => t.contact)
    .filter((c) => c.linkedinUrl);

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
      const url = contact.linkedinUrl!;
      window.open(url.startsWith("http") ? url : `https://${url}`, "_blank");
    }
    setBatchOffset((prev) => prev + nextBatch.length);
  }, [nextBatch]);

  const handleTabChange = (tab: ActiveTab) => {
    setActive(tab);
    // Do NOT reset batchOffset — the opener works through the full list
    // independent of which team tab is active.
  };

  // Button label — reflects progress through the full prospect list
  let openButtonLabel: string;
  if (totalWithLinkedin === 0) {
    openButtonLabel = "No LinkedIn profiles";
  } else if (exhausted) {
    openButtonLabel = "All profiles opened — Reset";
  } else {
    const remaining = totalWithLinkedin - batchOffset;
    const batchCount = Math.min(BATCH_SIZE, remaining);
    openButtonLabel = `Open Next ${batchCount} LinkedIn${batchOffset > 0 ? ` (${batchOffset}/${totalWithLinkedin} done)` : ` (${totalWithLinkedin} total)`}`;
  }

  return (
    <div className="space-y-4">
      {/* Mobile: horizontally scrollable pill tabs */}
      <div className="md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {tabs.map(({ label, count }) => (
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
                    : "bg-bisque-200 text-bisque-500"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: tab bar + Open Next 8 button (hidden on mobile) */}
      <div className="hidden md:flex items-end justify-between gap-4 border-b border-bisque-200">
        <div className="flex gap-1">
          {tabs.map(({ label, count }) => (
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
                    : "bg-bisque-200 text-bisque-500"
                }`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Open Next 8 LinkedIn Profiles button */}
        <button
          onClick={handleOpenNext8}
          disabled={totalWithLinkedin === 0}
          className={`mb-1 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 flex items-center gap-2 ${
            totalWithLinkedin === 0
              ? "bg-bisque-50 text-bisque-300 cursor-not-allowed border border-bisque-100"
              : exhausted
              ? "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
          title={
            totalWithLinkedin === 0
              ? "No prospect contacts have LinkedIn URLs"
              : exhausted
              ? "All profiles have been opened. Click to reset."
              : `Opens ${Math.min(BATCH_SIZE, totalWithLinkedin - batchOffset)} LinkedIn profiles in new tabs (works through all ${totalWithLinkedin} prospects regardless of active tab)`
          }
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
          {openButtonLabel}
        </button>
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
      <div role="tabpanel" aria-label={active === "All" ? "All outreach tasks" : `${active}'s outreach tasks`}>
        <OutreachTaskList
          tasks={activeTasks}
          messages={activeMessages}
          claudeEnabled={claudeEnabled}
        />
      </div>
    </div>
  );
}
