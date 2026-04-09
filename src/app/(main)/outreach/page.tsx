import { fetchProspectContacts } from "@/lib/kissinger";
import {
  distributeContacts,
  generateMessage,
  TEAM_MEMBERS,
  type ProspectContact,
  type TeamMember,
} from "@/lib/outreach";
import type { ProspectContactRaw } from "@/lib/kissinger";
import OutreachPageClient from "./OutreachPageClient";

export const metadata = {
  title: "Outreach — Eloso Bisque",
};

/** Map raw Kissinger data to the outreach ProspectContact type */
function mapContact(raw: ProspectContactRaw): ProspectContact {
  return {
    id: raw.id,
    name: raw.name,
    title: raw.title,
    company: raw.company,
    sector: raw.sector,
    fitTier: raw.fitTier,
    notes: raw.notes,
  };
}

export default async function OutreachPage() {
  const rawContacts = await fetchProspectContacts();
  const offline = rawContacts === null;

  // Map and sort: fit-high first, then alphabetically by company
  const fitOrder = { high: 0, medium: 1, low: 2 };
  const contacts: ProspectContact[] = (rawContacts ?? [])
    .map(mapContact)
    .sort((a, b) => {
      const fitDiff = (fitOrder[a.fitTier] ?? 9) - (fitOrder[b.fitTier] ?? 9);
      if (fitDiff !== 0) return fitDiff;
      return a.company.localeCompare(b.company);
    });

  // Distribute across Ben/Jake/Drew
  const distributed = distributeContacts(contacts);

  // Pre-generate all messages (server-side, no API key needed for templates)
  const messagesPerMember: Record<TeamMember, ReturnType<typeof generateMessage>[]> = {
    Ben: distributed.Ben.map(generateMessage),
    Jake: distributed.Jake.map(generateMessage),
    Drew: distributed.Drew.map(generateMessage),
  };

  const taskCounts: Record<TeamMember, number> = {
    Ben: distributed.Ben.length,
    Jake: distributed.Jake.length,
    Drew: distributed.Drew.length,
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-bisque-900">Outreach</h1>
          <p className="text-sm text-bisque-500 mt-1">
            Personalized LinkedIn outreach tasks · {contacts.length} prospect contact
            {contacts.length !== 1 ? "s" : ""}
          </p>
        </div>
        {offline && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            Kissinger offline — showing cached data
          </div>
        )}
      </div>

      {/* Client component handles tab state */}
      <OutreachPageClient
        distributed={distributed}
        messagesPerMember={messagesPerMember}
        taskCounts={taskCounts}
        teamMembers={TEAM_MEMBERS}
      />
    </div>
  );
}
