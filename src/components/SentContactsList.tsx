"use client";

import type { ProspectContact, OutreachStage } from "@/lib/outreach";

interface SentContactsListProps {
  contacts: ProspectContact[];
}

const STAGE_LABELS: Record<OutreachStage, string> = {
  cold: "Cold",
  touched_1: "Touch 1 sent",
  touched_2: "Touch 2 sent",
  touched_3: "Touch 3 sent",
  responded: "Responded",
};

const STAGE_COLORS: Record<OutreachStage, string> = {
  cold: "bg-bisque-100 text-bisque-500",
  touched_1: "bg-blue-50 text-blue-600 border border-blue-200",
  touched_2: "bg-amber-50 text-amber-700 border border-amber-200",
  touched_3: "bg-orange-50 text-orange-700 border border-orange-200",
  responded: "bg-green-50 text-green-700 border border-green-200",
};

export default function SentContactsList({ contacts }: SentContactsListProps) {
  if (contacts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-bisque-100 p-12 text-center">
        <div className="text-4xl mb-3">📤</div>
        <p className="text-bisque-600 font-medium">No sent contacts yet</p>
        <p className="text-bisque-400 text-sm mt-1">
          Contacts you&apos;ve clicked &ldquo;Mark Sent&rdquo; on will appear here.
        </p>
      </div>
    );
  }

  // Sort: responded first, then by stage descending, then alphabetically
  const stageOrder: Record<OutreachStage, number> = {
    responded: 0,
    touched_3: 1,
    touched_2: 2,
    touched_1: 3,
    cold: 4,
  };

  const sorted = [...contacts].sort((a, b) => {
    const aStage = a.outreachStage ?? "cold";
    const bStage = b.outreachStage ?? "cold";
    const stageDiff = (stageOrder[aStage] ?? 9) - (stageOrder[bStage] ?? 9);
    if (stageDiff !== 0) return stageDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-bisque-500">
        {contacts.length} contact{contacts.length !== 1 ? "s" : ""} sent
      </p>
      <div className="bg-white rounded-xl border border-bisque-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bisque-100 bg-bisque-50/60">
              <th className="text-left px-4 py-3 font-semibold text-bisque-600 text-xs uppercase tracking-wide">
                Name
              </th>
              <th className="hidden md:table-cell text-left px-4 py-3 font-semibold text-bisque-600 text-xs uppercase tracking-wide">
                Company / Title
              </th>
              <th className="text-left px-4 py-3 font-semibold text-bisque-600 text-xs uppercase tracking-wide">
                Stage
              </th>
              <th className="hidden md:table-cell text-left px-4 py-3 font-semibold text-bisque-600 text-xs uppercase tracking-wide">
                LinkedIn
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((contact, idx) => {
              const stage = contact.outreachStage ?? "cold";
              return (
                <tr
                  key={contact.id}
                  className={`border-b border-bisque-50 last:border-0 ${idx % 2 === 0 ? "" : "bg-bisque-50/30"}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-bisque-900">{contact.name}</div>
                    {/* Mobile: show company/title inline */}
                    <div className="md:hidden text-xs text-bisque-500 mt-0.5">
                      {contact.title}
                      {contact.company ? ` · ${contact.company}` : ""}
                    </div>
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-bisque-600">
                    <div className="font-medium text-bisque-800">{contact.company}</div>
                    {contact.title && (
                      <div className="text-xs text-bisque-500 mt-0.5">{contact.title}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[stage]}`}
                    >
                      {STAGE_LABELS[stage]}
                    </span>
                  </td>
                  <td className="hidden md:table-cell px-4 py-3">
                    {contact.linkedinUrl ? (
                      <a
                        href={
                          contact.linkedinUrl.startsWith("http")
                            ? contact.linkedinUrl
                            : `https://${contact.linkedinUrl}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline underline-offset-2 transition-colors text-xs"
                      >
                        <svg
                          className="w-3.5 h-3.5 shrink-0"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                        LinkedIn ↗
                      </a>
                    ) : (
                      <span className="text-bisque-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
