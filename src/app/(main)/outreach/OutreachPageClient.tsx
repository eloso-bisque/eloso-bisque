"use client";

import { useState } from "react";
import OutreachTaskList from "@/components/OutreachTaskList";
import type { OutreachTask, GeneratedMessage, TeamMember } from "@/lib/outreach";

interface OutreachPageClientProps {
  distributed: Record<TeamMember, OutreachTask[]>;
  messagesPerMember: Record<TeamMember, GeneratedMessage[]>;
  taskCounts: Record<TeamMember, number>;
  teamMembers: TeamMember[];
}

export default function OutreachPageClient({
  distributed,
  messagesPerMember,
  taskCounts,
  teamMembers,
}: OutreachPageClientProps) {
  const [active, setActive] = useState<TeamMember>(teamMembers[0]);

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-bisque-200">
        {teamMembers.map((member) => (
          <button
            key={member}
            onClick={() => setActive(member)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg border border-b-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-bisque-400 flex items-center gap-2 ${
              active === member
                ? "bg-white border-bisque-200 text-bisque-900 -mb-px relative z-10"
                : "bg-bisque-50 border-transparent text-bisque-500 hover:text-bisque-700 hover:bg-bisque-100"
            }`}
            aria-selected={active === member}
            role="tab"
          >
            {member}
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                active === member
                  ? "bg-bisque-100 text-bisque-700"
                  : "bg-bisque-200 text-bisque-500"
              }`}
            >
              {taskCounts[member]}
            </span>
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div role="tabpanel" aria-label={`${active}'s outreach tasks`}>
        <OutreachTaskList
          tasks={distributed[active]}
          messages={messagesPerMember[active]}
        />
      </div>
    </div>
  );
}
