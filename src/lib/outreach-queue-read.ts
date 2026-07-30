/**
 * Postgres-backed Outreach queue read path (Prisma Phase 3.2, GH #43).
 *
 * This module implements `fetchProspectContactsFromPostgres` and
 * `fetchSentContactsFromPostgres` as Postgres-native replacements for
 * `fetchProspectContacts`/`fetchSentContacts` in src/lib/kissinger.ts.
 *
 * **Status: wired into src/app/(main)/outreach/page.tsx as of the
 * 2026-07-30 cutover.** The Kissinger-based `fetchProspectContacts`/
 * `fetchSentContacts` in src/lib/kissinger.ts are no longer called from the
 * Outreach page (they remain in kissinger.ts, unused by this call site, in
 * case a rollback is needed). `fetchSignalContacts` — the Trigify-signal
 * read — is untouched and still Kissinger-backed; it was never in scope for
 * this migration. See "History: why the cutover was originally gated,
 * and what changed" below for the full trail, since the org/title
 * completeness numbers referenced there are the reason this took two
 * PRs to land.
 *
 * ---------------------------------------------------------------------
 * History: why the cutover was originally gated, and what changed
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
 * Note on the 411 vs. 990 discrepancy (flagged in independent PR review):
 * the PR description's "Read-path cutover" section cites 990 active
 * OutreachQueueEntry rows from a later run of the same
 * `scripts/verify-outreach-parity.ts` query (`isActive: true` count) on the
 * same day. Both figures are real, from the same query, at two different
 * points in time — not a mislabeling. Querying prod directly (grouping
 * active rows by `assignedAt` hour) shows exactly why: 411 rows were
 * assigned in the 10:00 UTC hour and a further 579 in the 11:00 UTC hour
 * (411 + 579 = 990) — this comment was written while a backfill/assignment
 * process was still populating OutreachQueueEntry rows mid-run, and the PR
 * body's figure was captured after it had progressed further. It does not
 * change the "defer read-path cutover" conclusion at the time — company/title
 * completeness is a per-row property, and the completeness *fraction*
 * (411-row snapshot: 2% org / 38% title; 990-row snapshot: 25.2% org /
 * 62.3% title) stayed well below the 90% `COMPLETENESS_THRESHOLD` at both
 * points in time.
 *
 * A follow-up backfill fix (PR #58, 2026-07-29/30) corrected synthetic-org
 * auto-creation for contacts with unmatched company text, raising org
 * completeness on the 990 active-queue contacts from 25.2% to 97.6%.
 * Title completeness stayed exactly 62.3% — PR #58 confirmed this is a hard
 * ceiling, not a bug: it dumped every meta key across all 990 active-queue
 * contacts directly from Kissinger and found zero have `title`, `headline`,
 * or nested-JSON-blob signal for the missing 373. This matches exactly the
 * 4-field fallback chain `resolveTitleFromMeta` (src/lib/kissinger-meta.ts)
 * uses. Re-verified directly on 2026-07-30 (`scripts/verify-title-sample.ts`):
 * for a live sample of 20 of the 373 titleless contacts, the *live Kissinger*
 * title resolution (same `resolveTitleFromMeta`/`parseNestedMeta` chain
 * `_fetchProspectContacts` calls) also returns `""` for all 20 — i.e. the
 * current production page, reading from Kissinger today, already renders a
 * blank title for these exact rows. Cutting the read path over does not
 * change what a real user sees for title on any of these rows; it is
 * provable parity, not an accepted regression. On that basis the 90%
 * `COMPLETENESS_THRESHOLD` gate in `scripts/verify-outreach-parity.ts` was
 * overridden for title specifically (org already cleared the gate at 97.6%).
 *
 * The underlying data-completeness gap (no title signal anywhere in
 * Kissinger for these 373 contacts) is real and is not fixed by this
 * cutover — it would require real external enrichment (Apollo/Clearbit/
 * LinkedIn-style), tracked as separate follow-up scope, not part of
 * finishing this migration.
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
