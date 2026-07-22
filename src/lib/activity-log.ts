import { prisma } from '@/lib/prisma';
import type { ActivityEventType, Prisma } from '@prisma/client';

/**
 * The 3 internal team members the Activity Dashboard reports on. This is the
 * canonical roster used both by the dual-write helper (to resolve which
 * Postgres User row an event belongs to) and by the Activity Dashboard read
 * route (to enumerate which users to render).
 *
 * NOTE: as of Prisma Phase 3.1, the Postgres `User` table is not yet
 * populated (that happens in the Kissinger backfill script, Phase 2). Code
 * that consumes this list must tolerate a missing Postgres User row for any
 * of these emails and degrade gracefully rather than throwing.
 */
export const KNOWN_ACTIVITY_USERS: ReadonlyArray<{ email: string; name: string }> = [
  { email: 'drew@eloso.ai', name: 'Drew' },
  { email: 'ben@eloso.ai', name: 'Ben' },
  { email: 'jake@eloso.ai', name: 'Jake' },
];

export interface LogActivityEventParams {
  /** Email of the user the event belongs to — resolved to a Postgres User.id via lookup. */
  email: string;
  eventType: ActivityEventType;
  /** Optional contact reference (used for outreach events). */
  contactId?: string;
  /** Free-form metadata bag, mirrors ActivityLog.metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Dual-write helper: records one ActivityLog row in Postgres for the given
 * user (resolved by email) and event type.
 *
 * This runs alongside the existing Vercel KV counters (Phase 3 dual-write
 * period) and is purely additive instrumentation. It MUST NEVER throw —
 * a Postgres outage, or a user that hasn't been backfilled into Postgres
 * yet (the Kissinger backfill script seeds the 3 User rows separately),
 * cannot be allowed to break the calling request (login, outreach-touch).
 * Any failure is logged and swallowed.
 */
export async function logActivityEvent(params: LogActivityEventParams): Promise<void> {
  const { email, eventType, contactId, metadata } = params;
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      console.warn(
        `[activity-log] No Postgres User row for "${email}" yet (eventType=${eventType}) — ` +
          'skipping ActivityLog dual-write. Expected until the Kissinger backfill seeds Users.'
      );
      return;
    }

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        eventType,
        contactId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    console.warn(
      `[activity-log] Failed to record ActivityLog for "${email}" (eventType=${eventType}):`,
      err instanceof Error ? err.message : err
    );
  }
}
