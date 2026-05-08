import { Suspense } from "react";
import { cookies } from "next/headers";
import { fetchProspectContacts, fetchSignalContacts, fetchSentContacts } from "@/lib/kissinger";
import {
  distributeContacts,
  generateMessage,
  isWarmSignal,
  isSignalSnoozed,
  computeSignalScore,
  TEAM_MEMBERS,
  type ProspectContact,
  type TeamMember,
  type OutreachTask,
  type GeneratedMessage,
} from "@/lib/outreach";
import type { ProspectContactRaw } from "@/lib/kissinger";
import { verifyToken } from "@/lib/auth";
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
    outreachMessage: raw.outreachMessage,
    outreachMessageGeneratedAt: raw.outreachMessageGeneratedAt,
    outreachMessageSender: raw.outreachMessageSender,
    lastSignalDate: raw.lastSignalDate,
    signalDismissed: raw.signalDismissed,
    signalSnoozedUntil: raw.signalSnoozedUntil,
    lastSignalKeyword: raw.lastSignalKeyword,
    lastSignalUrl: raw.lastSignalUrl,
  };
}

/** Map from login email to TeamMember name (case-insensitive). */
const EMAIL_TO_MEMBER: Record<string, TeamMember> = {
  "drew@eloso.ai": "Drew",
  "ben@eloso.ai": "Ben",
  "jake@eloso.ai": "Jake",
};

/** Inner async component — performs the heavy Kissinger fetches after the shell renders. */
async function OutreachContent({ currentMember }: { currentMember: TeamMember | null }) {
  // Fetch prospect contacts (tagged "prospect-contact") scoped to this user's queue,
  // sent contacts (tagged "outreach-sent"), and Trigify signal contacts in parallel.
  // prospect-contact and outreach-sent are disjoint — a contact is removed from
  // prospect-contact when touched and added to outreach-sent.
  // The assignee defaults to "drew" if the current member is unknown (unauthenticated)
  // so the page still renders; in practice all team members are authenticated.
  const assigneeKey = (currentMember ?? "drew").toLowerCase();
  const [rawContacts, rawSentContacts, rawSignalContacts] = await Promise.all([
    fetchProspectContacts(assigneeKey),
    fetchSentContacts(),
    fetchSignalContacts(),
  ]);
  const offline = rawContacts === null;

  // Map and sort active contacts: fit-high first, then alphabetically by company.
  // Filter to only cold (or no stage) — touched_1+ contacts are shown in the Sent tab.
  const fitOrder = { high: 0, medium: 1, low: 2 };
  const contacts: ProspectContact[] = (rawContacts ?? [])
    .map(mapContact)
    .filter((c) => c.outreachStage === "cold" || !c.outreachStage)
    .sort((a, b) => {
      const fitDiff = (fitOrder[a.fitTier] ?? 9) - (fitOrder[b.fitTier] ?? 9);
      if (fitDiff !== 0) return fitDiff;
      return a.company.localeCompare(b.company);
    });

  // Sent contacts come from the outreach-sent tag (disjoint from prospect-contact).
  // Scope to the logged-in user: show contacts where outreachMessageSender matches
  // the current user (case-insensitive), plus any contacts with no sender recorded
  // (contacts marked sent before sender attribution was added, or marked sent without
  // going through the generate-message flow). Unattributed contacts are shown to all
  // users since we cannot determine who sent them.
  const allSentMapped: ProspectContact[] = rawSentContacts.map(mapContact);
  const sentContacts: ProspectContact[] = allSentMapped.filter((c) => {
    if (!currentMember) {
      // Unauthenticated: show all sent contacts (fallback)
      return true;
    }
    // No sender recorded — show to all users (unattributed, can't scope to one person)
    if (!c.outreachMessageSender) return true;
    // Sender recorded — only show to the matching user
    return c.outreachMessageSender.toLowerCase() === currentMember.toLowerCase();
  });

  // Signal contacts: from Trigify signal entities (fetched separately) +
  // any active prospect-contact entities that also have warm signals.
  // De-duplicate by ID in case of overlap (shouldn't happen currently).
  // Only include cold/active contacts in signals (not already-sent ones).
  const prospectSignals: ProspectContact[] = contacts.filter(
    (c) =>
      isWarmSignal(c) &&
      !c.signalDismissed &&
      !isSignalSnoozed(c)
  );
  const trigifySignals: ProspectContact[] = rawSignalContacts
    .map(mapContact)
    .filter((c) => !c.signalDismissed && !isSignalSnoozed(c));

  // Merge, de-duplicate, sort by signal score
  const seenIds = new Set<string>();
  const signalContacts: ProspectContact[] = [...prospectSignals, ...trigifySignals]
    .filter((c) => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    })
    .sort((a, b) => computeSignalScore(b) - computeSignalScore(a));

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

  // Compute per-user counts for the stat line
  const myActiveCount = currentMember ? distributed[currentMember].length : contacts.length;
  const mySentCount = sentContacts.length;

  return (
    <>
      {offline && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          Kissinger offline — showing cached data
        </div>
      )}
      <p className="text-sm text-bisque-500">
        {myActiveCount} active
        {mySentCount > 0 ? ` · ${mySentCount} sent` : ""}
      </p>
      {/* Client component handles tab state */}
      <OutreachPageClient
        distributed={distributed}
        messagesPerMember={messagesPerMember}
        taskCounts={taskCounts}
        teamMembers={TEAM_MEMBERS}
        allTasks={allTasks}
        allMessages={allMessages}
        sentContacts={sentContacts}
        signalContacts={signalContacts}
        currentMember={currentMember}
      />
    </>
  );
}

/** Skeleton shown while OutreachContent is loading data. */
function OutreachSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 bg-bisque-200 rounded w-48" />
      <div className="h-10 bg-bisque-100 rounded" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-bisque-100 rounded" />
        ))}
      </div>
    </div>
  );
}

export default async function OutreachPage() {
  // Decode the session cookie to identify the logged-in user.
  // currentMember is used to scope the "Open Next 8" button to the user's own queue.
  // We do this outside the Suspense boundary so it resolves before the shell renders.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("eloso_session");
  let currentMember: TeamMember | null = null;
  if (sessionCookie?.value) {
    const payload = await verifyToken(sessionCookie.value);
    if (payload?.email) {
      currentMember = EMAIL_TO_MEMBER[payload.email.toLowerCase()] ?? null;
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header renders immediately — no Kissinger data needed */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-bisque-900">Outreach</h1>
          <p className="text-sm text-bisque-500 mt-1">
            Personalized LinkedIn outreach tasks
          </p>
        </div>
      </div>

      {/* Heavy data fetch deferred — page shell paints while Kissinger responds */}
      <Suspense fallback={<OutreachSkeleton />}>
        <OutreachContent currentMember={currentMember} />
      </Suspense>
    </div>
  );
}
