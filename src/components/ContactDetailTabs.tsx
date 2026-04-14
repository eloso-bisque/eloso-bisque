"use client";

import { useState } from "react";
import ContactEventsTab from "@/components/ContactEventsTab";

type Tab = "overview" | "events" | "intro-path";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "events", label: "Events" },
  { id: "intro-path", label: "Intro Path" },
];

interface ContactDetailTabsProps {
  contactId: string;
  /** The full Overview content (server-rendered, passed as children) */
  overview: React.ReactNode;
}

export default function ContactDetailTabs({
  contactId,
  overview,
}: ContactDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex gap-1 bg-bisque-100 p-1 rounded-xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-white text-bisque-900 shadow-sm"
                : "text-bisque-600 hover:text-bisque-900"
            }`}
            role="tab"
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <div>{overview}</div>}

      {activeTab === "events" && (
        <ContactEventsTab contactId={contactId} />
      )}

      {activeTab === "intro-path" && (
        <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-12 text-center">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="text-bisque-600 font-medium">Intro Path</p>
          <p className="text-bisque-400 text-sm mt-1">
            Coming soon — warm intro path analysis will appear here (NET-5).
          </p>
        </div>
      )}
    </div>
  );
}
