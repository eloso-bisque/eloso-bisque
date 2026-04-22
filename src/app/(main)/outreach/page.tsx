import { fetchProspectContacts } from "@/lib/kissinger";
import {
  distributeContacts,
  generateMessage,
  TEAM_MEMBERS,
  type ProspectContact,
  type TeamMember,
  type OutreachTask,
  type GeneratedMessage,
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
    outreachStage: raw.outreachStage,
    linkedinUrl: raw.linkedinUrl || undefined,
  };
}

export default async function OutreachPage() {
  const rawContacts = await fetchProspectContacts();
  const offline = rawContacts === null;

  // Check if Claude API is available for personalization
  const claudeEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

  // Map and sort: fit-high first, then alphabetically by company
  const fitOrder = { high: 0, medium: 1, low: 2 };
  const allMappedContacts: ProspectContact[] = (rawContacts ?? [])
    .map(mapContact)
    .sort((a, b) => {
      const fitDiff = (fitOrder[a.fitTier] ?? 9) - (fitOrder[b.fitTier] ?? 9);
      if (fitDiff !== 0) return fitDiff;
      return a.company.localeCompare(b.company);
    });

  // Split into active (cold = not yet contacted) and sent (touched or responded)
  const sentContacts: ProspectContact[] = allMappedContacts.filter(
    (c) => c.outreachStage && c.outreachStage !== "cold"
  );
  const contacts: ProspectContact[] = allMappedContacts.filter(
    (c) => !c.outreachStage || c.outreachStage === "cold"
  );

  // Distribute active contacts across Ben/Jake/Drew
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

  // Build the "All" list: all active tasks in sorted order
  const allTasks: OutreachTask[] = TEAM_MEMBERS.flatMap((m) => distributed[m]).sort(
    (a, b) => {
      const fitOrder = { high: 0, medium: 1, low: 2 };
      const fitDiff = (fitOrder[a.contact.fitTier] ?? 9) - (fitOrder[b.contact.fitTier] ?? 9);
      if (fitDiff !== 0) return fitDiff;
      return a.contact.company.localeCompare(b.contact.company);
    }
  );
  const allMessages: GeneratedMessage[] = allTasks.map(generateMessage);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-bisque-900">Outreach</h1>
          <p className="text-sm text-bisque-500 mt-1">
            Personalized LinkedIn outreach tasks · {contacts.length} active
            {sentContacts.length > 0 ? ` · ${sentContacts.length} sent` : ""}
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
        allTasks={allTasks}
        allMessages={allMessages}
        claudeEnabled={claudeEnabled}
        sentContacts={sentContacts}
      />
    </div>
  );
}
