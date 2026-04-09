"use client";

import { useState } from "react";

export type TeamMember = "Ben" | "Jake" | "Drew";

const TEAM_MEMBERS: TeamMember[] = ["Ben", "Jake", "Drew"];

interface OutreachTabsProps {
  /** Optional task content per team member. Defaults to empty (placeholder). */
  children?: (member: TeamMember) => React.ReactNode;
}

export default function OutreachTabs({ children }: OutreachTabsProps) {
  const [active, setActive] = useState<TeamMember>("Ben");

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-2 border-b border-bisque-200 pb-0">
        {TEAM_MEMBERS.map((member) => (
          <button
            key={member}
            onClick={() => setActive(member)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 ${
              active === member
                ? "bg-white border-bisque-200 text-bisque-900 -mb-px"
                : "bg-bisque-50 border-transparent text-bisque-500 hover:text-bisque-700 hover:bg-bisque-100"
            }`}
            aria-selected={active === member}
            role="tab"
          >
            {member}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div role="tabpanel" aria-label={`${active}'s outreach tasks`}>
        {children ? (
          children(active)
        ) : (
          <EmptyState member={active} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ member }: { member: TeamMember }) {
  return (
    <div className="bg-white rounded-xl border border-bisque-100 p-12 text-center">
      <div className="text-4xl mb-3">📋</div>
      <p className="text-bisque-600 font-medium">No tasks yet for {member}</p>
      <p className="text-bisque-400 text-sm mt-1">
        Outreach tasks will appear here once contacts are assigned.
      </p>
    </div>
  );
}
