/**
 * One-time corrective script for the #41 backfill classification bug found
 * during GH #45's parity check (see scripts/backfill/constants.ts's
 * PERSON_INVESTOR_TAGS comment for the full root-cause writeup).
 *
 * Root cause: the original #41 backfill's `classifyPersonTags()` set
 * `Contact.isInvestorContact` from a single literal "investor" tag check,
 * while the org-side equivalent (`classifyOrgTags()` -> `Organization.
 * isVcFirm`) correctly checked BOTH "vc" and "investor" — matching
 * Kissinger's own live classification (`INVESTOR_PERSON_TAGS = new
 * Set(["vc", "investor"])` in src/lib/kissinger.ts). Result: any real
 * investor person tagged only "vc" (no literal "investor" tag) was
 * imported into Postgres correctly (the row exists, with "vc" preserved as
 * a plain ContactTag row) but with isInvestorContact left false. Confirmed
 * against live Kissinger + prod Postgres on 2026-07-22: 65 live Kissinger
 * person entities tagged "vc"/"investor" (non-archived), all present in
 * Postgres, but only 33 had isInvestorContact=true — a 32/65 (49%)
 * false-negative rate that would have made the GH #45 Investors "People" tab
 * cutover silently drop half of all real investor contacts.
 *
 * scripts/backfill/mappers.ts's `classifyPersonTags()` is fixed as part of
 * this PR so future backfill runs get this right. This script corrects the
 * already-migrated prod rows without re-running the full (much larger
 * blast-radius) backfill: it sets isInvestorContact=true for exactly the
 * Contacts that have a "vc" ContactTag but isInvestorContact=false. It does
 * NOT touch ContactTag rows (the "vc" tag itself, or anything else) — purely
 * additive, single-column correction.
 *
 * Safety checks performed before writing (per the #48 partial-unique-index
 * precedent: verify against real prod data before applying):
 *   - Confirms every target row is currently isInvestorContact=false (so the
 *     UPDATE can't accidentally touch an already-correct row).
 *   - Confirms none of the target rows also have isProspectContact=true
 *     (would indicate a genuinely ambiguous/conflicting classification that
 *     needs a human decision, not an automatic fix).
 *   - Prints the full before/after count and a sample of affected names for
 *     review before writing.
 *
 * Usage:
 *   npx tsx scripts/fix-investor-contact-classification.ts          # dry run (default)
 *   npx tsx scripts/fix-investor-contact-classification.ts --apply  # actually writes
 */

import { loadEnvFile } from "./backfill/env";

const APPLY = process.argv.includes("--apply");

async function main() {
  loadEnvFile([".env.production.local", ".env.local"]);
  const { prisma } = await import("../src/lib/prisma");

  const targets = await prisma.contact.findMany({
    where: {
      isInvestorContact: false,
      tags: { some: { tag: "vc" } },
    },
    select: { id: true, kissingerId: true, name: true, isProspectContact: true },
  });

  console.log(`Found ${targets.length} contact(s) tagged 'vc' with isInvestorContact=false.`);

  const conflicting = targets.filter((c) => c.isProspectContact);
  if (conflicting.length > 0) {
    console.error(
      `ABORTING: ${conflicting.length} target row(s) also have isProspectContact=true — ` +
        `ambiguous classification requires a human decision, not an automatic fix:`,
      conflicting.map((c) => ({ id: c.id, kissingerId: c.kissingerId, name: c.name }))
    );
    process.exit(1);
  }

  console.log("Sample (up to 10):", targets.slice(0, 10).map((c) => ({ kissingerId: c.kissingerId, name: c.name })));

  if (!APPLY) {
    console.log("\nDry run only — no rows changed. Re-run with --apply to write.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.contact.updateMany({
    where: { id: { in: targets.map((c) => c.id) } },
    data: { isInvestorContact: true },
  });
  console.log(`\nApplied: set isInvestorContact=true on ${result.count} contact(s).`);

  const remaining = await prisma.contact.count({
    where: { isInvestorContact: false, tags: { some: { tag: "vc" } } },
  });
  console.log(`Verification: ${remaining} contact(s) tagged 'vc' still have isInvestorContact=false (expect 0).`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
