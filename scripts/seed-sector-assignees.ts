/**
 * One-time, idempotent seed for Sector.defaultAssignee (Prisma Phase 3.4,
 * GH #44). Populates the 9 Sector rows that have an unambiguous match in
 * SECTOR_SLUG_ASSIGNEE (src/lib/sectors-read.ts) — see that file's module
 * doc comment for why "ev", "chemicals", and "aerospace" are intentionally
 * left null rather than guessed.
 *
 * Additive-only: this only ever sets Sector.defaultAssignee (an existing
 * nullable column) from null to a string value. No schema change, no
 * deletion, no destructive write. Safely re-runnable — upserts the same
 * value every time.
 *
 * Run with:
 *   npx tsx scripts/seed-sector-assignees.ts --dry-run   # preview only
 *   npx tsx scripts/seed-sector-assignees.ts             # apply
 */

import { loadEnvFile } from "./backfill/env";

async function main() {
  loadEnvFile([".env.production.local", ".env.local"]);
  const dryRun = process.argv.includes("--dry-run");

  const { prisma } = await import("../src/lib/prisma");
  const { SECTOR_SLUG_ASSIGNEE } = await import("../src/lib/sectors-read");

  const sectors = await prisma.sector.findMany({
    select: { slug: true, displayName: true, defaultAssignee: true },
  });

  const toUpdate = sectors.filter((s) => {
    const target = SECTOR_SLUG_ASSIGNEE[s.slug];
    return target !== undefined && s.defaultAssignee !== target;
  });
  const unmapped = sectors.filter((s) => SECTOR_SLUG_ASSIGNEE[s.slug] === undefined);

  console.log(`Sector rows: ${sectors.length}`);
  console.log(`To update: ${toUpdate.length}`);
  for (const s of toUpdate) {
    console.log(`  ${s.slug} (${s.displayName}): ${s.defaultAssignee ?? "null"} -> ${SECTOR_SLUG_ASSIGNEE[s.slug]}`);
  }
  console.log(`Left unmapped (ambiguous or unknown, staying null): ${unmapped.map((s) => s.slug).join(", ") || "none"}`);

  if (dryRun) {
    console.log("\n--dry-run: no writes performed.");
    await prisma.$disconnect();
    return;
  }

  for (const s of toUpdate) {
    await prisma.sector.update({
      where: { slug: s.slug },
      data: { defaultAssignee: SECTOR_SLUG_ASSIGNEE[s.slug] },
    });
  }

  console.log(`\nApplied ${toUpdate.length} update(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
