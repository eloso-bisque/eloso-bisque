/**
 * Postgres-backed Outreach queue read path (Prisma Phase 3.2, GH #43).
 *
 * This module implements `fetchProspectContactsFromPostgres` and
 * `fetchSentContactsFromPostgres` as Postgres-native replacements for
 * `fetchProspectContacts`/`fetchSentContacts` in src/lib/kissinger.ts,
 * per the GH #43 read-migration scope. They are built, unit-tested, and
 * ready to use — but they are **deliberately not wired into**
 * src/app/(main)/outreach/page.tsx in this PR. See "Why the cutover is
 * gated" below.
 *
 * ---------------------------------------------------------------------
 * Why the cutover is gated (do not flip this without re-verifying first)
 * ---------------------------------------------------------------------
 *
 * The safety rules for this migration require verifying parity between the
 * Kissinger and Postgres data before cutting a read path over — not just
 * that the code compiles and returns the right shape. Verified against real
 * prod Postgres (Neon, eloso-bisque-prod) on 2026-07-22, scoped to exactly
 * the population this read path would serve (the 411 currently-active
 * OutreachQueueEntry rows):
 *
 *   - Only 8 / 411 (2%) have a resolvable Organization (Contact.organizationId
 *     is set) — the other 98% would render a BLANK company name.
 *   - Only 156 / 411 (38%) have Contact.title set — the other 62% would
 *     render a blank title.
 *   - RelationshipFrom (the works_at edges that would populate
 *     organizationId) has only 15 rows total across all 500 Contacts.
 *
 * Company and title are prominently rendered on every card in the Active and
 * Sent tabs (src/components/OutreachTaskCard.tsx, SentContactsList.tsx).
 * Cutting the read path over today would silently blank these fields for
 * the large majority of Drew/Ben/Jake's real outreach queue — a user-visible
 * regression, not an acceptable trade-off (per the same principle GH #43
 * was scoped with for the GeneratedMessage/Signal gap below).
 *
 * This is a data-completeness gap in the underlying Kissinger backfill
 * (GH #41 — organizationId/title extraction from Kissinger meta + works_at
 * edges), not something in scope to fix from within #43. Recommendation:
 * complete/re-run that backfill's org-linking + title-extraction step, then
 * re-run `scripts/verify-outreach-parity.ts` (added in this PR) to confirm
 * before wiring these functions into the page.
 *
 * The Kissinger-based read path in src/lib/kissinger.ts
 * (`fetchProspectContacts`/`fetchSentContacts`) is untouched and remains
 * what src/app/(main)/outreach/page.tsx uses today. To cut over once data
 * is complete: swap those two imports in page.tsx for the ones exported
 * here (`mapContact` already expects the exact same `ProspectContactRaw`
 * shape, so no frontend changes are needed). To roll back after cutting
 * over: swap the imports back.
 *
 * ---------------------------------------------------------------------
 * GeneratedMessage / Signal — why these do NOT block the cutover
 * ---------------------------------------------------------------------
 *
 * `GeneratedMessage` and `Signal` are also empty in Postgres today, but
 * neither blocks the read migration:
 *
 *   - Signal fields (lastSignalDate, lastSignalKeyword, lastSignalUrl,
 *     signalDismissed, signalSnoozedUntil) were captured as direct columns
 *     on `Contact` during the GH #41 backfill — independent of the (still
 *     empty) `Signal` history table. This read path uses those columns.
 *   - `outreachMessage`/`outreachMessageGeneratedAt` (from `GeneratedMessage`)
 *     are passed through in `ProspectContactRaw` but verified (by reading
 *     src/components/OutreachTaskCard.tsx) to only ever *upgrade* the
 *     display: `storedMessage` is used if present, and the card always
 *     falls back to the locally-computed template message
 *     (`generateMessage(task)`) when absent — never a blank message. An
 *     empty `GeneratedMessage` table degrades new/unregenerated cards from
 *     an AI-personalized message to a template message; it never blanks
 *     the card. New contacts assigned after this PR's dual-write ships will
 *     populate `GeneratedMessage` going forward.
 *   - `outreachMessageSender`/`queueOwner` (used for Sent-tab attribution)
 *     are derived here from `OutreachQueueEntry.userId`, which is always
 *     populated once a queue entry exists — no dependency on
 *     `GeneratedMessage` at all.
 */

import { prisma } from "@/lib/prisma";
import type { ProspectContactRaw, OutreachStage } from "@/lib/kissinger";

// ---------------------------------------------------------------------------
// Assignee <-> email (mirrors ASSIGNEE_EMAILS in outreach-dual-write.ts)
// ---------------------------------------------------------------------------

const ASSIGNEE_EMAILS: Record<string, string> = {
  drew: "drew@eloso.ai",
  ben: "ben@eloso.ai",
  jake: "jake@eloso.ai",
};

function assigneeFromEmail(email: string): string | undefined {
  const lower = email.toLowerCase();
  const match = Object.entries(ASSIGNEE_EMAILS).find(([, assigneeEmail]) => assigneeEmail === lower);
  return match?.[0];
}

// ---------------------------------------------------------------------------
// Pure row -> ProspectContactRaw mapper (no I/O — independently unit-tested)
// ---------------------------------------------------------------------------

export interface QueueEntryJoinRow {
  contact: {
    kissingerId: string | null;
    name: string;
    title: string | null;
    notes: string | null;
    outreachStage: string;
    linkedinUrl: string | null;
    lastSignalDate: Date | null;
    lastSignalKeyword: string | null;
    lastSignalUrl: string | null;
    signalDismissed: boolean;
    signalSnoozedUntil: Date | null;
    organization: { name: string; fitTier: string | null; tags: { tag: string }[] } | null;
  };
  user: { email: string };
  /** Most recently generated isActive GeneratedMessage row for this contact, if any. */
  activeGeneratedMessage: { messageBody: string; generatedAt: Date } | null;
}

const NON_SECTOR_ORG_TAGS = new Set(["prospect", "eloso"]);

/** Pure mapping from a joined Postgres row to the ProspectContactRaw shape the frontend renders. */
export function mapQueueEntryRowToProspectContactRaw(row: QueueEntryJoinRow): ProspectContactRaw {
  const { contact, user, activeGeneratedMessage } = row;
  const org = contact.organization;

  const sector = (org?.tags ?? [])
    .map((t) => t.tag)
    .filter((tag) => !NON_SECTOR_ORG_TAGS.has(tag) && !tag.startsWith("fit-"));

  const fitTier: ProspectContactRaw["fitTier"] =
    (org?.fitTier as ProspectContactRaw["fitTier"] | null) ?? "high";

  const assignee = assigneeFromEmail(user.email);

  const linkedinUrl =
    contact.linkedinUrl ||
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(contact.name)}`;

  return {
    id: contact.kissingerId ?? "",
    name: contact.name,
    title: contact.title ?? "",
    company: org?.name ?? "",
    sector,
    fitTier,
    notes: contact.notes ?? "",
    orgId: undefined,
    outreachStage: contact.outreachStage as OutreachStage,
    linkedinUrl,
    outreachMessage: activeGeneratedMessage?.messageBody,
    outreachMessageGeneratedAt: activeGeneratedMessage?.generatedAt.toISOString(),
    outreachMessageSender: assignee,
    lastSignalDate: contact.lastSignalDate?.toISOString(),
    signalDismissed: contact.signalDismissed,
    signalSnoozedUntil: contact.signalSnoozedUntil?.toISOString(),
    lastSignalKeyword: contact.lastSignalKeyword ?? undefined,
    lastSignalUrl: contact.lastSignalUrl ?? undefined,
    queueOwner: assignee,
  } satisfies ProspectContactRaw;
}

// ---------------------------------------------------------------------------
// Prisma-backed fetch functions
// ---------------------------------------------------------------------------

const QUEUE_ENTRY_INCLUDE = {
  contact: {
    select: {
      kissingerId: true,
      name: true,
      title: true,
      notes: true,
      outreachStage: true,
      linkedinUrl: true,
      lastSignalDate: true,
      lastSignalKeyword: true,
      lastSignalUrl: true,
      signalDismissed: true,
      signalSnoozedUntil: true,
      organization: {
        select: { name: true, fitTier: true, tags: { select: { tag: true } } },
      },
      generatedMessages: {
        where: { isActive: true },
        orderBy: { generatedAt: "desc" as const },
        take: 1,
        select: { messageBody: true, generatedAt: true },
      },
    },
  },
  user: { select: { email: true } },
} as const;

type RawQueueEntryRow = {
  contact: QueueEntryJoinRow["contact"] & {
    generatedMessages: { messageBody: string; generatedAt: Date }[];
  };
  user: { email: string };
};

function toJoinRow(row: RawQueueEntryRow): QueueEntryJoinRow {
  return {
    contact: row.contact,
    user: row.user,
    activeGeneratedMessage: row.contact.generatedMessages[0] ?? null,
  };
}

/**
 * Postgres equivalent of `fetchProspectContacts` (src/lib/kissinger.ts): all
 * *active* queue entries for the given assignee. Returns null on failure to
 * match the existing "Kissinger unreachable" contract consumed by
 * src/app/(main)/outreach/page.tsx (`offline = rawContacts === null`).
 *
 * NOT wired into page.tsx yet — see the module doc comment above.
 */
export async function fetchProspectContactsFromPostgres(
  assigneeLower: string
): Promise<ProspectContactRaw[] | null> {
  const email = ASSIGNEE_EMAILS[assigneeLower];
  if (!email) return [];
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return [];
    const entries = await prisma.outreachQueueEntry.findMany({
      where: { userId: user.id, isActive: true },
      include: QUEUE_ENTRY_INCLUDE,
    });
    return entries.map((e) => mapQueueEntryRowToProspectContactRaw(toJoinRow(e as RawQueueEntryRow)));
  } catch (err) {
    console.warn(
      "[outreach-queue-read] fetchProspectContactsFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Postgres equivalent of `fetchSentContacts` (src/lib/kissinger.ts): every
 * queue entry that left the active queue because a touch was sent or a
 * response was logged (deactivatedReason "sent" | "responded") — mirrors
 * the Kissinger "outreach-sent" tag semantics. Entries deactivated by
 * "skipped" or "reassigned" are excluded (skipped contacts never appear in
 * the Sent tab in the Kissinger-based version either).
 *
 * NOT wired into page.tsx yet — see the module doc comment above.
 */
export async function fetchSentContactsFromPostgres(): Promise<ProspectContactRaw[]> {
  try {
    const entries = await prisma.outreachQueueEntry.findMany({
      where: { isActive: false, deactivatedReason: { in: ["sent", "responded"] } },
      include: QUEUE_ENTRY_INCLUDE,
    });
    return entries.map((e) => mapQueueEntryRowToProspectContactRaw(toJoinRow(e as RawQueueEntryRow)));
  } catch (err) {
    console.warn(
      "[outreach-queue-read] fetchSentContactsFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
