#!/usr/bin/env npx tsx
/**
 * Narrowly-scoped re-run of the Kissinger -> Postgres title/org backfill,
 * limited to the Contacts behind today's *active* OutreachQueueEntry rows
 * (990 as of writing) — the population scripts/verify-outreach-parity.ts
 * gates the /outreach read-path cutover on.
 *
 * Why scoped instead of re-running scripts/backfill-kissinger.ts in full:
 * a full run's fetchAll() calls Kissinger's edgesFrom for every org AND
 * person entity in the graph (~5800 orgs + ~1500 persons). edgesFrom's
 * resolver has, at times, rejected some relation types (observed:
 * may_know/buys_from/contract_mfg_for/supplies_to) with a resolver-level
 * "Unknown relation type" error — backfill-kissinger.ts now isolates that
 * per-entity so one bad edge type can't abort the whole run, but a full run
 * is still the larger, slower, riskier surface to re-verify against a live
 * production graph when the actual fix (GH parity-retry) only concerns 990
 * specific Contacts. This script:
 *
 *  - Fetches Kissinger entity detail + works_at edges for ONLY those 990
 *    contacts (not the full graph).
 *  - Recomputes title/metaCompanyName with the corrected, shared fallback
 *    chain (src/lib/kissinger-meta.ts) instead of build-plan.ts's old,
 *    narrower one.
 *  - Auto-creates a synthetic Organization (see
 *    scripts/backfill/relationships.ts findSyntheticOrgCandidates) for any
 *    contact whose company/org meta text doesn't match an existing
 *    Organization by name and has no works_at edge.
 *  - Updates only Contact.title / Contact.organizationId /
 *    Contact.roleAtOrg / Contact.orgStrength and the denormalized
 *    OutreachQueueEntry.organizationId — nothing else on Contact/Organization
 *    is touched, and only when the newly-resolved value is non-empty (never
 *    regresses a previously-set field to null/empty).
 *
 * Usage:
 *   npx tsx scripts/backfill-active-queue-fixup.ts --dry-run   # fetch + plan, no writes
 *   npx tsx scripts/backfill-active-queue-fixup.ts             # real run
 */

import { loadEnvFile } from "./backfill/env";

import type { PrismaClient } from "@prisma/client";
// eslint-disable-next-line prefer-const -- assigned once in main() before any use, see backfill-kissinger.ts for why
let prisma: PrismaClient;

import { fetchEntityDetail, fetchEdgesFrom, mapWithConcurrency, type KissingerEdge } from "./backfill/kissinger-client";
import { buildSyntheticOrganizationPlan } from "./backfill/build-plan";
import { resolveContactOrganization, findSyntheticOrgCandidates } from "./backfill/relationships";
import { parseNestedMeta, resolveTitleFromMeta, resolveCompanyFromMeta } from "../src/lib/kissinger-meta";

interface Args {
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes("--dry-run") };
}

interface ContactRow {
  id: string;
  kissingerId: string;
  name: string;
  title: string | null;
  organizationId: string | null;
}

async function main() {
  const loadedEnvFile = loadEnvFile([".env.production.local", ".env.local", ".env"]);
  console.log(`Loaded env from: ${loadedEnvFile ?? "(none found — using pre-set process.env only)"}`);
  ({ prisma } = await import("../src/lib/prisma"));

  const args = parseArgs(process.argv.slice(2));
  console.log(`=== Active-queue title/org fixup ===`);
  console.log(`Mode: ${args.dryRun ? "DRY RUN (no Postgres writes)" : "REAL RUN (writing to Postgres)"}`);

  // ---------------------------------------------------------------------
  // Scope: contacts behind today's active OutreachQueueEntry rows only.
  // ---------------------------------------------------------------------
  const queueEntries = await prisma.outreachQueueEntry.findMany({
    where: { isActive: true },
    select: {
      id: true,
      contact: { select: { id: true, kissingerId: true, name: true, title: true, organizationId: true } },
    },
  });
  const contacts: ContactRow[] = [];
  const seenContactIds = new Set<string>();
  for (const qe of queueEntries) {
    if (!qe.contact.kissingerId) continue; // shouldn't happen; guards the type
    if (seenContactIds.has(qe.contact.id)) continue;
    seenContactIds.add(qe.contact.id);
    contacts.push({
      id: qe.contact.id,
      kissingerId: qe.contact.kissingerId,
      name: qe.contact.name,
      title: qe.contact.title,
      organizationId: qe.contact.organizationId,
    });
  }
  console.log(`Active OutreachQueueEntry rows: ${queueEntries.length}; distinct contacts: ${contacts.length}`);

  // ---------------------------------------------------------------------
  // Fetch Kissinger entity detail + works_at edges for exactly these contacts.
  // Per-entity error isolation — see backfill-kissinger.ts's fetchAll() for
  // why (Kissinger's edgesFrom resolver has, at times, rejected some edge
  // relation types outright for a given entity).
  // ---------------------------------------------------------------------
  console.log("Fetching Kissinger entity detail + works_at edges...");
  let edgeFetchErrors = 0;
  const worksAtBySource = new Map<string, KissingerEdge[]>();
  const metaByContactId = new Map<string, { title: string; metaCompanyName: string | null }>();

  await mapWithConcurrency(contacts, 15, async (c) => {
    const entity = await fetchEntityDetail(c.kissingerId);
    const meta: Record<string, string> = {};
    for (const m of entity.meta) meta[m.key] = m.value;
    const nestedMeta = parseNestedMeta(meta);

    metaByContactId.set(c.id, {
      title: resolveTitleFromMeta(meta, nestedMeta),
      metaCompanyName: resolveCompanyFromMeta(meta, nestedMeta) || null,
    });

    try {
      const edges = await fetchEdgesFrom(c.kissingerId);
      const worksAt = edges.filter((e) => e.relation === "works_at");
      if (worksAt.length > 0) worksAtBySource.set(c.kissingerId, worksAt);
    } catch (err) {
      edgeFetchErrors++;
      console.warn(`  fetchEdgesFrom(${c.kissingerId}) [${c.name}] failed, treating as no edges: ${(err as Error).message}`);
    }
  });
  console.log(`Done. edgesFrom fetch errors: ${edgeFetchErrors}`);

  // ---------------------------------------------------------------------
  // Existing Organization name map (from Postgres — no need to re-fetch
  // Kissinger's full org list for this scoped run).
  // ---------------------------------------------------------------------
  const existingOrgs = await prisma.organization.findMany({ select: { id: true, kissingerId: true, name: true } });
  const orgIdByKissingerId = new Map<string, string>();
  const orgKissingerIdByLowerName = new Map<string, string>();
  for (const o of existingOrgs) {
    if (!o.kissingerId) continue;
    orgIdByKissingerId.set(o.kissingerId, o.id);
    const key = o.name.trim().toLowerCase();
    if (!orgKissingerIdByLowerName.has(key)) orgKissingerIdByLowerName.set(key, o.kissingerId);
  }
  console.log(`Existing Organizations loaded: ${existingOrgs.length}`);

  // ---------------------------------------------------------------------
  // Auto-create synthetic Organizations for unmatched company/org meta.
  // ---------------------------------------------------------------------
  const candidateInput = contacts.map((c) => ({
    kissingerId: c.kissingerId,
    metaCompanyName: metaByContactId.get(c.id)?.metaCompanyName ?? null,
  }));
  const syntheticCandidates = findSyntheticOrgCandidates(candidateInput, worksAtBySource, orgKissingerIdByLowerName);
  console.log(`Synthetic Organizations to create: ${syntheticCandidates.length}`);

  if (!args.dryRun) {
    for (const candidate of syntheticCandidates) {
      const plan = buildSyntheticOrganizationPlan(candidate.kissingerId, candidate.name);
      const org = await prisma.organization.upsert({
        where: { kissingerId: plan.kissingerId },
        update: {},
        create: {
          kissingerId: plan.kissingerId,
          name: plan.name,
          isArchived: plan.isArchived,
          isProspect: plan.isProspect,
          isVcFirm: plan.isVcFirm,
          notes: plan.notes,
          funnelStage: plan.funnelStage as never,
          investorPipeline: plan.investorPipeline as never,
        },
      });
      orgIdByKissingerId.set(candidate.kissingerId, org.id);
    }
  }
  for (const candidate of syntheticCandidates) {
    orgKissingerIdByLowerName.set(candidate.name.trim().toLowerCase(), candidate.kissingerId);
  }

  // ---------------------------------------------------------------------
  // Resolve + write per-contact title/organizationId/roleAtOrg/orgStrength.
  // Additive only: never overwrites an existing non-empty value with an
  // empty one.
  // ---------------------------------------------------------------------
  let titleUpdated = 0;
  let orgUpdated = 0;
  let queueEntryOrgSynced = 0;

  for (const c of contacts) {
    const meta = metaByContactId.get(c.id);
    const resolution = resolveContactOrganization(
      worksAtBySource.get(c.kissingerId) ?? [],
      meta?.metaCompanyName ?? null,
      orgKissingerIdByLowerName
    );

    const newTitle = meta?.title || null;
    const newOrgId = resolution.organizationKissingerId
      ? orgIdByKissingerId.get(resolution.organizationKissingerId) ?? null
      : null;

    const data: Record<string, unknown> = {};
    if (newTitle && newTitle !== c.title) {
      data.title = newTitle;
      titleUpdated++;
    }
    if (newOrgId && newOrgId !== c.organizationId) {
      data.organizationId = newOrgId;
      data.roleAtOrg = resolution.roleAtOrg;
      data.orgStrength = resolution.orgStrength;
      orgUpdated++;
    }

    if (Object.keys(data).length === 0) continue;
    if (args.dryRun) continue;

    await prisma.contact.update({ where: { id: c.id }, data });
    if (data.organizationId) {
      const updated = await prisma.outreachQueueEntry.updateMany({
        where: { contactId: c.id, isActive: true },
        data: { organizationId: data.organizationId as string },
      });
      queueEntryOrgSynced += updated.count;
    }
  }

  console.log("\n=== Fixup summary ===");
  console.log(`Contacts with title newly set/changed:          ${titleUpdated}`);
  console.log(`Contacts with organizationId newly set/changed: ${orgUpdated}`);
  console.log(`OutreachQueueEntry rows synced with new org:    ${queueEntryOrgSynced}`);
  console.log(`Synthetic Organizations created:                ${syntheticCandidates.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fixup failed:", err);
  process.exitCode = 1;
});
