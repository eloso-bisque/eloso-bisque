/**
 * Integration test: a contact deactivated TWICE must persist both
 * deactivations (GH #43 follow-up bug fix).
 *
 * Requires a real Postgres instance — `prisma/schema.prisma`'s
 * `OutreachQueueEntry` unique-index behavior cannot be exercised through the
 * mocked-`@/lib/prisma` unit tests in outreach-dual-write.test.ts (those
 * mocks never touch a real unique index, so they can't catch a real DB
 * constraint bug). This test drives the actual dual-write functions against
 * a real database and queries rows back afterward.
 *
 * The bug: prisma/schema.prisma originally declared
 *   @@unique([contactId, isActive], name: "unique_active_assignment")
 * `isActive` is NOT NULL, so a *plain* unique index on (contactId, isActive)
 * doesn't just enforce "at most one active row per contact" — it also caps
 * *inactive* rows at one per contact, which is wrong: inactive rows are
 * history, and a contact can legitimately be deactivated more than once
 * across its lifetime (assign -> mark sent -> reassign -> skip again is the
 * cycle exercised below, driven through `dualWriteNewBatchAssignment`'s
 * reassignment path). Because every dualWrite* function follows the "never
 * throw, log + swallow" contract, the second deactivation's unique-
 * constraint violation was silently eaten — the entry meant to be
 * deactivated stayed active forever, with no error surfaced anywhere. The
 * fix replaces the full unique index with a partial one scoped to
 * `isActive = true` (see
 * prisma/migrations/20260722114253_fix_outreach_queue_partial_unique_active_assignment/migration.sql).
 *
 * Opt-in (NOT opt-out like bulk-create-integration.test.ts): this test
 * performs real writes (create + delete) against the Postgres tables this
 * PR's dual-write functions target, not just reads against a sandboxed
 * Kissinger space. Requiring an explicit RUN_INTEGRATION=true avoids ever
 * running write-side integration tests against whatever DATABASE_URL
 * happens to be configured in an environment (e.g. a shared runner) without
 * deliberate intent.
 *
 * Run against a real prod Postgres (same `vercel env pull
 * --environment=production` pattern as bulk-create-integration.test.ts /
 * PR #47's seed scripts):
 *   cd ~/lobster-workspace/projects/eloso-bisque
 *   export $(grep -E '^DATABASE_URL=' .env.production.local | xargs)
 *   RUN_INTEGRATION=true npx vitest run src/lib/__tests__/integration/outreach-queue-second-deactivation-integration.test.ts
 *
 * Uses a freshly created synthetic Contact per run (`BulkTest ...` name,
 * `@example-test.invalid` email, fake kissingerId not backed by any real
 * Kissinger entity) so this NEVER advances the outreach state of a real
 * prospect. Kissinger itself is never called — these dual-write functions
 * are pure Postgres-side instrumentation, per GH #43's scope. The synthetic
 * Contact (and everything cascaded from it: OutreachQueueEntry,
 * OutreachTouch rows) is deleted in `afterAll`. The referenced User
 * (ben@eloso.ai) is looked up read-only and never modified.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "true";
const SKIP = !RUN_INTEGRATION || !process.env.DATABASE_URL;

describe.skipIf(SKIP)("outreach queue: second deactivation cycle (real Postgres)", () => {
  // Imported lazily inside the suite so this file never touches
  // src/lib/prisma.ts's module-level PrismaClient construction when the
  // suite is skipped (e.g. no DATABASE_URL in a plain `npm test` run).
  let prisma: typeof import("@/lib/prisma").prisma;
  let dualWriteNewBatchAssignment: typeof import("@/lib/outreach-dual-write").dualWriteNewBatchAssignment;
  let dualWriteMarkSent: typeof import("@/lib/outreach-dual-write").dualWriteMarkSent;
  let dualWriteSkip: typeof import("@/lib/outreach-dual-write").dualWriteSkip;
  let FIRST_TOUCH_NUMBER: typeof import("@/lib/outreach-dual-write").FIRST_TOUCH_NUMBER;

  const ASSIGNEE_LOWER = "ben";
  const ASSIGNEE_EMAIL = "ben@eloso.ai";

  let contactId: string;
  let kissingerId: string;

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ({ dualWriteNewBatchAssignment, dualWriteMarkSent, dualWriteSkip, FIRST_TOUCH_NUMBER } = await import(
      "@/lib/outreach-dual-write"
    ));

    const user = await prisma.user.findUnique({ where: { email: ASSIGNEE_EMAIL }, select: { id: true } });
    if (!user) {
      throw new Error(
        `Expected a Postgres User row for "${ASSIGNEE_EMAIL}" to already exist (seeded by scripts/seed-users.ts) ` +
          "— cannot run this integration test without it."
      );
    }

    const runId = `${Date.now()}`;
    kissingerId = `bulktest-outreach-fix-${runId}`;
    const contact = await prisma.contact.create({
      data: {
        name: `BulkTest OutreachFix ${runId}`,
        email: `bulktest-outreach-fix-${runId}@example-test.invalid`,
        kissingerId,
        isProspectContact: true,
        outreachStage: "cold",
      },
      select: { id: true },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    if (contactId) {
      // Cascades to OutreachQueueEntry / OutreachTouch rows created below.
      await prisma.contact.delete({ where: { id: contactId } }).catch(() => {
        // best-effort cleanup; nothing else references this synthetic contact
      });
    }
    await prisma.$disconnect();
  });

  it("persists a second deactivation after a reassignment cycle, not just the first", async () => {
    // 1. New Batch: create the first queue entry (isActive=true).
    await dualWriteNewBatchAssignment({ assigneeLower: ASSIGNEE_LOWER, kissingerContactIds: [kissingerId] });

    const entriesAfterFirstAssignment = await prisma.outreachQueueEntry.findMany({
      where: { contactId },
      orderBy: { assignedAt: "asc" },
    });
    expect(entriesAfterFirstAssignment).toHaveLength(1);
    const firstEntry = entriesAfterFirstAssignment[0];
    expect(firstEntry.isActive).toBe(true);

    // 2. Mark Sent (T1): deactivates the first entry — deactivation #1.
    await dualWriteMarkSent({
      kissingerContactId: kissingerId,
      touchNumber: FIRST_TOUCH_NUMBER,
      assigneeLower: ASSIGNEE_LOWER,
    });

    const firstEntryAfterSent = await prisma.outreachQueueEntry.findUniqueOrThrow({
      where: { id: firstEntry.id },
    });
    expect(firstEntryAfterSent.isActive).toBe(false);
    expect(firstEntryAfterSent.deactivatedReason).toBe("sent");

    // 3. New Batch again: this is a reassignment. dualWriteNewBatchAssignment's
    //    pre-deactivation updateMany is a no-op here (no active entry exists —
    //    it was already deactivated in step 2), then it creates a second
    //    queue entry (isActive=true).
    await dualWriteNewBatchAssignment({ assigneeLower: ASSIGNEE_LOWER, kissingerContactIds: [kissingerId] });

    const entriesAfterReassignment = await prisma.outreachQueueEntry.findMany({
      where: { contactId },
      orderBy: { assignedAt: "asc" },
    });
    expect(entriesAfterReassignment).toHaveLength(2);
    const secondEntry = entriesAfterReassignment[1];
    expect(secondEntry.isActive).toBe(true);

    // 4. Skip: attempts to deactivate the second entry — deactivation #2.
    //    Under the OLD full unique index on (contactId, isActive), this
    //    UPDATE collides with the first entry already occupying
    //    (contactId, isActive=false) and Postgres raises a unique
    //    violation. dualWriteSkip swallows it (never throws), so the only
    //    way to observe the bug is to query the row back.
    await dualWriteSkip({ kissingerContactId: kissingerId });

    const secondEntryAfterSkip = await prisma.outreachQueueEntry.findUniqueOrThrow({
      where: { id: secondEntry.id },
    });

    // This is the assertion that fails against the OLD (unfixed) migration:
    // the second deactivation silently never persisted, so isActive stayed
    // true and deactivatedReason stayed null.
    expect(secondEntryAfterSkip.isActive).toBe(false);
    expect(secondEntryAfterSkip.deactivatedReason).toBe("skipped");

    // The first (historical) entry must be untouched by the second
    // deactivation — both history rows persist independently.
    const firstEntryFinal = await prisma.outreachQueueEntry.findUniqueOrThrow({
      where: { id: firstEntry.id },
    });
    expect(firstEntryFinal.isActive).toBe(false);
    expect(firstEntryFinal.deactivatedReason).toBe("sent");
  });
});
