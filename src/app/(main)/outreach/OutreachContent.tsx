import { fetchSignalContacts } from "@/lib/kissinger";
import {
  fetchProspectContactsFromPostgres,
  fetchSentContactsFromPostgres,
} from "@/lib/outreach-queue-read";
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
import OutreachPageClient from "./OutreachPageClient";

/**
 * Map raw contact data to the outreach ProspectContact type.
 * `ProspectContactRaw` is shared between the (still-used) Kissinger-backed
 * `fetchSignalContacts` and the Postgres-backed
 * `fetchProspectContactsFromPostgres`/`fetchSentContactsFromPostgres` — see
 * src/lib/outreach-queue-read.ts.
 */
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
    queueOwner: raw.queueOwner,
  };
}

/**
 * Inner async component — performs the heavy data fetches after the shell renders.
 * Lives in its own module (not page.tsx) — Next.js's Page type validation rejects
 * any named export from a page.tsx file other than the reserved route-config ones
 * (metadata, generateMetadata, etc.), so this can't be exported directly from
 * page.tsx. Exported here so tests can call it directly and assert which data
 * source it reads from, without needing to render the full RSC tree (see
 * src/app/(main)/outreach/__tests__/OutreachContent.test.ts, one directory up
 * from this file).
 */
export async function OutreachContent({ currentMember }: { currentMember: TeamMember | null }) {
  // Fetch active queue contacts (Postgres OutreachQueueEntry, isActive: true) scoped
  // to this user's queue, sent contacts (Postgres, isActive: false with a
  // "sent"/"responded" deactivation reason), and Trigify signal contacts (still
  // Kissinger-backed — narrow, documented exception, see docs/DEPLOYMENT.md) in
  // parallel. Active and sent are disjoint by construction (OutreachQueueEntry.isActive).
  // The assignee defaults to "drew" if the current member is unknown (unauthenticated)
  // so the page still renders; in practice all team members are authenticated.
  const assigneeKey = (currentMember ?? "drew").toLowerCase();
  const [rawContacts, rawSentContacts, rawSignalContacts] = await Promise.all([
    fetchProspectContactsFromPostgres(assigneeKey),
    fetchSentContactsFromPostgres(),
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
  // Scope to the logged-in user using a two-signal attribution strategy:
  //   1. outreachMessageSender (set when the message was generated via AI/template)
  //   2. queueOwner (derived from the queue:* tag on the entity — always present for
  //      contacts that went through a user's personal queue)
  // A contact is shown to the current user if EITHER signal matches them.
  // A contact with NO attribution signal at all (no sender, no queue tag) is shown
  // to all users as a fallback — these are rare edge cases from before queue scoping.
  const allSentMapped: ProspectContact[] = rawSentContacts.map(mapContact);
  const sentContacts: ProspectContact[] = allSentMapped.filter((c) => {
    if (!currentMember) {
      // Unauthenticated: show all sent contacts (fallback)
      return true;
    }
    const memberLower = currentMember.toLowerCase();
    // Signal 1: explicit sender attribution
    if (c.outreachMessageSender) {
      return c.outreachMessageSender.toLowerCase() === memberLower;
    }
    // Signal 2: queue owner (the user this contact was assigned to)
    if (c.queueOwner) {
      return c.queueOwner.toLowerCase() === memberLower;
    }
    // No attribution signal — show to all users (truly unattributed, extremely rare)
    return true;
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

  // Build distributed contact map.
  //
  // fetchProspectContactsFromPostgres is already queue-scoped: it returns ONLY the
  // given assignee's active OutreachQueueEntry rows. Re-distributing them via
  // distributeContacts() would split them across Ben/Jake/Drew by sector affinity,
  // causing the logged-in user to see only ~1/3 of their own queue in the Active tab.
  //
  // Fix: when the user is authenticated, put ALL their fetched contacts into their
  // own bucket (they're already theirs). Fall back to distributeContacts for the
  // unauthenticated case (no currentMember) where the old round-robin logic is needed.
  const now = new Date().toISOString();
  let distributed: Record<TeamMember, OutreachTask[]>;
  if (currentMember) {
    const myTasks: OutreachTask[] = contacts.map((contact) => ({
      id: `${contact.id}-${currentMember}`,
      contact,
      assignee: currentMember,
      generatedAt: now,
    }));
    distributed = { Ben: [], Jake: [], Drew: [], [currentMember]: myTasks };
  } else {
    distributed = distributeContacts(contacts);
  }

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
          Unable to load your outreach queue right now — please retry
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
