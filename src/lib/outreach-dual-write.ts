/**
 * Outreach Queue dual-write helpers (Prisma Phase 3.2, GH #43).
 *
 * Kissinger (GraphQL/CozoDB) remains the source of truth for outreach queue
 * mutations during this phase. These helpers run *alongside* the existing
 * Kissinger writes in each mutation route (never replacing them) and record
 * the same state changes in Postgres, per docs/prisma-schema-design.md
 * sections 3.1/3.2:
 *
 *   - New Batch      -> OutreachQueueEntry rows (isActive=true)
 *   - Skip           -> OutreachQueueEntry.isActive=false, reason="skipped"
 *   - Mark Sent (T1) -> OutreachTouch row + OutreachQueueEntry.isActive=false,
 *                       reason="sent" (T2/T3 also write OutreachTouch but do
 *                       not re-deactivate — the entry already left the
 *                       active queue on T1)
 *   - Log Response   -> OutreachResponse row + OutreachQueueEntry.isActive=false,
 *                       reason="responded"
 *   - Generate/regenerate message -> GeneratedMessage row (versioned)
 *
 * Every exported dual-write function here follows the same contract as
 * `logActivityEvent` (src/lib/activity-log.ts, Phase 3.1): it MUST NEVER
 * throw. A missing Postgres Contact/User row (backfill lag) or a Postgres
 * outage is logged and swallowed — the calling route's Kissinger write is
 * the operation of record and must never be blocked or failed by this
 * instrumentation.
 *
 * Invariant enforced here (not just by the DB): prisma/schema.prisma's
 * `@@unique([contactId, isActive], name: "unique_active_assignment")` means
 * at most one *active* queue entry can exist per contact. Application code
 * must deactivate any existing active entry for a contact before creating a
 * new one — see `dualWriteNewBatchAssignment`, which deactivates
 * (reason="reassigned") ahead of the create, with `skipDuplicates: true` on
 * the create as a defense-in-depth backstop against the DB constraint.
 */

import { prisma } from "@/lib/prisma";
import type { FeedbackThumb, MessageAngle, ResponseType } from "@prisma/client";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export type OutreachStageValue = "cold" | "touched_1" | "touched_2" | "touched_3" | "responded";

/** The touch number that removes a contact from the active queue (per design doc 3.2). */
export const FIRST_TOUCH_NUMBER = 1;

const TOUCH_TRANSITIONS: Record<number, { before: OutreachStageValue; after: OutreachStageValue }> = {
  1: { before: "cold", after: "touched_1" },
  2: { before: "touched_1", after: "touched_2" },
  3: { before: "touched_2", after: "touched_3" },
};

/**
 * Pure mapping from a touch number (1, 2, or 3) to the stage transition it
 * represents. Returns null for any other value — callers must treat that as
 * "do not write anything."
 */
export function nextStageForTouch(
  touchNumber: number
): { before: OutreachStageValue; after: OutreachStageValue } | null {
  return TOUCH_TRANSITIONS[touchNumber] ?? null;
}

// ---------------------------------------------------------------------------
// Identity resolution (Kissinger entity ID / lowercase assignee -> Postgres row)
// ---------------------------------------------------------------------------

/** Mirrors EMAIL_TO_ASSIGNEE / EMAIL_TO_MEMBER conventions used across the outreach routes. */
const ASSIGNEE_EMAILS: Record<string, string> = {
  drew: "drew@eloso.ai",
  ben: "ben@eloso.ai",
  jake: "jake@eloso.ai",
};

/**
 * Message angle per team member — mirrors SENDER_CONTEXT in src/lib/outreach.ts
 * (Ben: vision, Jake: strategic, Drew: technical).
 */
const ANGLE_BY_ASSIGNEE: Record<string, MessageAngle> = {
  ben: "vision",
  jake: "strategic",
  drew: "technical",
};

/** Resolve the MessageAngle enum value for a "Ben" | "Jake" | "Drew" (case-insensitive) team member name. */
export function angleForAssignee(assignee: string): MessageAngle | null {
  return ANGLE_BY_ASSIGNEE[assignee.toLowerCase()] ?? null;
}

/**
 * Resolve a lowercase assignee name ("ben" | "jake" | "drew") to the
 * Postgres User.id. Returns null (and logs) if the assignee is unrecognized,
 * the User row doesn't exist yet, or the lookup fails — never throws.
 */
export async function resolveUserIdForAssignee(assigneeLower: string): Promise<string | null> {
  const email = ASSIGNEE_EMAILS[assigneeLower];
  if (!email) {
    console.warn(`[outreach-dual-write] Unrecognized assignee "${assigneeLower}" — skipping dual-write.`);
    return null;
  }
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.warn(
        `[outreach-dual-write] No Postgres User row for "${email}" yet — skipping dual-write.`
      );
      return null;
    }
    return user.id;
  } catch (err) {
    console.warn(
      `[outreach-dual-write] User lookup failed for "${email}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

interface ResolvedContact {
  id: string;
  organizationId: string | null;
  outreachStage: string;
}

/**
 * Resolve a Kissinger entity ID to its Postgres Contact row. Returns null
 * (and logs) if the contact hasn't been backfilled yet or the lookup fails —
 * never throws.
 */
async function resolveContactByKissingerId(kissingerId: string): Promise<ResolvedContact | null> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { kissingerId },
      select: { id: true, organizationId: true, outreachStage: true },
    });
    if (!contact) {
      console.warn(
        `[outreach-dual-write] No Postgres Contact row for Kissinger entity "${kissingerId}" yet — skipping dual-write.`
      );
      return null;
    }
    return contact;
  } catch (err) {
    console.warn(
      `[outreach-dual-write] Contact lookup failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// New Batch -> OutreachQueueEntry (createMany)
// ---------------------------------------------------------------------------

export interface DualWriteNewBatchParams {
  /** Lowercase assignee name: "ben" | "jake" | "drew". */
  assigneeLower: string;
  /** Kissinger entity IDs that were just tagged queue:<assignee> in Kissinger. */
  kissingerContactIds: string[];
}

/**
 * Dual-write for POST /api/outreach/new-batch. Creates one OutreachQueueEntry
 * per contact that has already been backfilled into Postgres, scoped to the
 * resolved user. Contacts not yet in Postgres are skipped (logged), not
 * treated as an error.
 */
export async function dualWriteNewBatchAssignment(params: DualWriteNewBatchParams): Promise<void> {
  const { assigneeLower, kissingerContactIds } = params;
  if (kissingerContactIds.length === 0) return;

  const userId = await resolveUserIdForAssignee(assigneeLower);
  if (!userId) return;

  try {
    const resolved = await Promise.all(
      kissingerContactIds.map(async (kissingerId) => ({
        kissingerId,
        contact: await resolveContactByKissingerId(kissingerId),
      }))
    );
    const entries = resolved
      .filter((r): r is { kissingerId: string; contact: ResolvedContact } => r.contact !== null)
      .map((r) => ({
        contactId: r.contact.id,
        organizationId: r.contact.organizationId,
        stage: (r.contact.outreachStage as OutreachStageValue) ?? "cold",
      }));

    if (entries.length === 0) return;

    await prisma.$transaction(async (tx) => {
      // Invariant: never create a second live row for a contact that already
      // has one. Defensively deactivate any pre-existing active assignment
      // (e.g. a reassignment) before creating the new one.
      for (const entry of entries) {
        await tx.outreachQueueEntry.updateMany({
          where: { contactId: entry.contactId, isActive: true },
          data: { isActive: false, deactivatedReason: "reassigned", deactivatedAt: new Date() },
        });
      }
      await tx.outreachQueueEntry.createMany({
        data: entries.map((entry) => ({
          contactId: entry.contactId,
          userId,
          organizationId: entry.organizationId,
          stageAtAssignment: entry.stage,
          currentStage: entry.stage,
        })),
        // Defense-in-depth: if the pre-deactivation step above somehow raced
        // with another write, never let the DB-level unique_active_assignment
        // constraint surface as an unhandled error — skip instead.
        skipDuplicates: true,
      });
    });
  } catch (err) {
    console.warn(
      "[outreach-dual-write] dualWriteNewBatchAssignment failed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Skip -> OutreachQueueEntry.isActive=false, reason="skipped"
// ---------------------------------------------------------------------------

export interface DualWriteSkipParams {
  kissingerContactId: string;
}

/** Dual-write for POST /api/outreach/skip. */
export async function dualWriteSkip(params: DualWriteSkipParams): Promise<void> {
  const contact = await resolveContactByKissingerId(params.kissingerContactId);
  if (!contact) return;

  try {
    await prisma.outreachQueueEntry.updateMany({
      where: { contactId: contact.id, isActive: true },
      data: { isActive: false, deactivatedReason: "skipped", deactivatedAt: new Date() },
    });
  } catch (err) {
    console.warn("[outreach-dual-write] dualWriteSkip failed:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Mark Sent (T1/T2/T3) -> OutreachTouch + Contact/QueueEntry stage advance
// ---------------------------------------------------------------------------

export interface DualWriteMarkSentParams {
  kissingerContactId: string;
  touchNumber: number;
  /** Lowercase assignee name of whoever sent the touch. */
  assigneeLower: string;
}

/** Dual-write for POST /api/contacts/[id]/outreach-touch. */
export async function dualWriteMarkSent(params: DualWriteMarkSentParams): Promise<void> {
  const { kissingerContactId, touchNumber, assigneeLower } = params;

  const stages = nextStageForTouch(touchNumber);
  if (!stages) {
    console.warn(`[outreach-dual-write] Invalid touchNumber ${touchNumber} — skipping dual-write.`);
    return;
  }

  const contact = await resolveContactByKissingerId(kissingerContactId);
  if (!contact) return;

  const userId = await resolveUserIdForAssignee(assigneeLower);
  if (!userId) return;

  try {
    await prisma.$transaction(async (tx) => {
      const queueEntry = await tx.outreachQueueEntry.findFirst({
        where: { contactId: contact.id },
        orderBy: { assignedAt: "desc" },
      });

      await tx.outreachTouch.create({
        data: {
          contactId: contact.id,
          queueEntryId: queueEntry?.id ?? null,
          userId,
          touchNumber,
          stageBeforeTouch: stages.before,
          stageAfterTouch: stages.after,
        },
      });

      await tx.contact.update({
        where: { id: contact.id },
        data: { outreachStage: stages.after },
      });

      if (queueEntry) {
        if (touchNumber === FIRST_TOUCH_NUMBER) {
          await tx.outreachQueueEntry.update({
            where: { id: queueEntry.id },
            data: {
              currentStage: stages.after,
              isActive: false,
              deactivatedReason: "sent",
              deactivatedAt: new Date(),
            },
          });
        } else {
          await tx.outreachQueueEntry.update({
            where: { id: queueEntry.id },
            data: { currentStage: stages.after },
          });
        }
      }
    });
  } catch (err) {
    console.warn(
      "[outreach-dual-write] dualWriteMarkSent failed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Log Response -> OutreachResponse + Contact/QueueEntry -> responded
// ---------------------------------------------------------------------------

export interface DualWriteOutreachResponseParams {
  kissingerContactId: string;
  responseType: ResponseType;
  notes?: string;
  /** Lowercase assignee name of whoever logged the response, or null if unknown/system. */
  assigneeLower: string | null;
}

/** Dual-write for POST /api/contacts/[id]/outreach-response. */
export async function dualWriteOutreachResponse(params: DualWriteOutreachResponseParams): Promise<void> {
  const { kissingerContactId, responseType, notes, assigneeLower } = params;

  const contact = await resolveContactByKissingerId(kissingerContactId);
  if (!contact) return;

  const userId = assigneeLower ? await resolveUserIdForAssignee(assigneeLower) : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.outreachResponse.create({
        data: { contactId: contact.id, userId, responseType, notes },
      });

      await tx.contact.update({
        where: { id: contact.id },
        data: { outreachStage: "responded" },
      });

      const queueEntry = await tx.outreachQueueEntry.findFirst({
        where: { contactId: contact.id },
        orderBy: { assignedAt: "desc" },
      });

      if (queueEntry) {
        await tx.outreachQueueEntry.update({
          where: { id: queueEntry.id },
          data: {
            isActive: false,
            deactivatedReason: "responded",
            deactivatedAt: new Date(),
            currentStage: "responded",
          },
        });
      }
    });
  } catch (err) {
    console.warn(
      "[outreach-dual-write] dualWriteOutreachResponse failed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Feedback (thumbs up/down) -> OutreachFeedback
// ---------------------------------------------------------------------------

export interface DualWriteOutreachFeedbackParams {
  kissingerContactId: string;
  thumb: FeedbackThumb;
  text?: string;
  /** Lowercase assignee name ("ben" | "jake" | "drew") of whoever logged the
   *  feedback, or null if unknown/system. OutreachFeedback.loggedBy is a
   *  plain freeform string (not a User FK — see the model's doc comment in
   *  schema.prisma), so this is stored as-is with no User-row resolution. */
  assigneeLower: string | null;
}

/**
 * Dual-write for POST /api/outreach/feedback. Kissinger's entity-meta write
 * remains the operation of record for this route (the Outreach subsystem is
 * still on the Kissinger side of the PR #53 disconnect — see that route's
 * doc comment), so this follows the same never-throw contract as every other
 * function in this file: a missing Postgres Contact row or a Postgres outage
 * is logged and swallowed, never surfaced to the caller.
 */
export async function dualWriteOutreachFeedback(params: DualWriteOutreachFeedbackParams): Promise<void> {
  const { kissingerContactId, thumb, text, assigneeLower } = params;

  const contact = await resolveContactByKissingerId(kissingerContactId);
  if (!contact) return;

  try {
    await prisma.outreachFeedback.create({
      data: {
        contactId: contact.id,
        thumb,
        text: text || null,
        loggedBy: assigneeLower,
      },
    });
  } catch (err) {
    console.warn(
      "[outreach-dual-write] dualWriteOutreachFeedback failed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Generate/regenerate message -> GeneratedMessage (versioned)
// ---------------------------------------------------------------------------

export interface DualWriteGeneratedMessageParams {
  kissingerContactId: string;
  /** MessageAngle enum value: "vision" | "technical" | "strategic". */
  angle: MessageAngle;
  messageBody: string;
  /** "ai" | "template" — defaults to "template". */
  generationMethod?: string;
  modelId?: string;
}

/** Dual-write for POST /api/outreach/generate-message and /api/outreach/bulk-generate. */
export async function dualWriteGeneratedMessage(params: DualWriteGeneratedMessageParams): Promise<void> {
  const { kissingerContactId, angle, messageBody, generationMethod, modelId } = params;

  const contact = await resolveContactByKissingerId(kissingerContactId);
  if (!contact) return;

  try {
    await prisma.$transaction(async (tx) => {
      // Versioning (design doc 3.8): supersede the prior active message for
      // this exact (contact, angle) pair before inserting the new one.
      await tx.generatedMessage.updateMany({
        where: { contactId: contact.id, angle, isActive: true },
        data: { isActive: false },
      });
      await tx.generatedMessage.create({
        data: {
          contactId: contact.id,
          angle,
          messageBody,
          generationMethod: generationMethod ?? "template",
          modelId,
          isActive: true,
        },
      });
    });
  } catch (err) {
    console.warn(
      "[outreach-dual-write] dualWriteGeneratedMessage failed:",
      err instanceof Error ? err.message : err
    );
  }
}
