/**
 * Verifies whether the Postgres-backed Outreach queue read path
 * (src/lib/outreach-queue-read.ts) is safe to wire into
 * src/app/(main)/outreach/page.tsx yet.
 *
 * Unlike the Activity Dashboard parity script (scripts/verify-activity-parity.ts),
 * this is not a "do the numbers match Kissinger" check — the dual-write
 * mutations in this PR are new, so there's no independent historical source
 * to diff against for the mutation-side state. What actually gates the
 * *read*-path cutover is data completeness in the GH #41 backfill: does
 * every (or nearly every) active queue entry's Contact have a resolvable
 * Organization (-> company name) and a title? Those two fields are rendered
 * prominently on every card (src/components/OutreachTaskCard.tsx,
 * SentContactsList.tsx) — if they're missing, cutting over blanks them for
 * real users.
 *
 * Run with:  npx tsx scripts/verify-outreach-parity.ts
 * Exits non-zero if completeness is below COMPLETENESS_THRESHOLD, so this
 * can gate a future "cut over the read path" PR/step.
 */

import { prisma } from "../src/lib/prisma";

/** Minimum fraction of active queue entries that must have a resolvable
 *  Organization + title before the Postgres read path is considered safe to
 *  wire into the Outreach page. Chosen conservatively — below this, most
 *  users would see blank company/title on a meaningful share of their queue. */
const COMPLETENESS_THRESHOLD = 0.9;

async function main() {
  const activeTotal = await prisma.outreachQueueEntry.count({ where: { isActive: true } });
  if (activeTotal === 0) {
    console.log("No active OutreachQueueEntry rows — nothing to verify yet.");
    return;
  }

  const activeWithOrg = await prisma.outreachQueueEntry.count({
    where: { isActive: true, contact: { organizationId: { not: null } } },
  });
  const activeWithTitle = await prisma.outreachQueueEntry.count({
    where: { isActive: true, contact: { title: { not: null } } },
  });

  const orgFraction = activeWithOrg / activeTotal;
  const titleFraction = activeWithTitle / activeTotal;

  console.log(`Active OutreachQueueEntry rows: ${activeTotal}`);
  console.log(
    `  with resolvable Organization (company name): ${activeWithOrg} (${(orgFraction * 100).toFixed(1)}%)`
  );
  console.log(`  with Contact.title set:                     ${activeWithTitle} (${(titleFraction * 100).toFixed(1)}%)`);
  console.log(`Threshold for read-path cutover: ${(COMPLETENESS_THRESHOLD * 100).toFixed(0)}%`);

  const ready = orgFraction >= COMPLETENESS_THRESHOLD && titleFraction >= COMPLETENESS_THRESHOLD;
  if (ready) {
    console.log(
      "\nREADY: data completeness meets the threshold. Safe to wire fetchProspectContactsFromPostgres/" +
        "fetchSentContactsFromPostgres into src/app/(main)/outreach/page.tsx (re-verify once more right before cutover)."
    );
  } else {
    console.log(
      "\nNOT READY: company/title completeness is below threshold. Cutting the read path over now would " +
        "blank these fields for real users. Complete the GH #41 backfill's organizationId (works_at edge) " +
        "and title extraction before wiring the Postgres read path in."
    );
  }

  await prisma.$disconnect();
  process.exit(ready ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
