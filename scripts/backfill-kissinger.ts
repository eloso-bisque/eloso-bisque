#!/usr/bin/env npx tsx
/**
 * One-time (but safely re-runnable) backfill: Kissinger GraphQL -> Postgres.
 *
 * This is the imperative shell for scripts/backfill/*.ts's pure functional
 * core (kissinger-client, mappers, build-plan, relationships): it fetches
 * everything from Kissinger, turns each entity/edge/interaction into a plan
 * via the pure builders, then upserts those plans into Postgres via Prisma.
 *
 * Usage:
 *   npx tsx scripts/backfill-kissinger.ts --dry-run           # fetch + plan only, no writes
 *   npx tsx scripts/backfill-kissinger.ts                     # real run, upserts everything
 *   npx tsx scripts/backfill-kissinger.ts --dry-run --limit=25 # small smoke test (25 per kind)
 *   npx tsx scripts/backfill-kissinger.ts --limit=5           # small, explicitly-scoped real run
 *
 * Safety: idempotent. Every write is an upsert (Organization/Contact keyed
 * on kissingerId, tags/sectors on their natural compound keys,
 * OutreachQueueEntry on its (contactId, isActive) unique constraint) or an
 * app-level find-then-write for the handful of models with no natural
 * unique key against Kissinger data (RelationshipFrom, Signal,
 * GeneratedMessage, ContactEvent — see the upsert* functions below for the
 * dedup key used in each case). Never deletes or truncates anything.
 */

import { loadEnvFile } from "./backfill/env";

// NOTE: ES module `import` declarations are hoisted above all other
// top-level code in a file, regardless of source order — so a plain
// `import { prisma } from "../src/lib/prisma"` here would evaluate that
// module (which reads process.env.DATABASE_URL at import time to configure
// its adapter) *before* the loadEnvFile() call below ever runs, silently
// connecting with an empty/default connection string. `prisma` is therefore
// loaded lazily via dynamic import() inside main(), strictly after env
// loading, and stored in this module-level binding for the other functions
// in this file to use.
import type { PrismaClient } from "@prisma/client";
// eslint-disable-next-line prefer-const -- assigned once in main() before any use
let prisma: PrismaClient;

import type {
  OutreachStage,
  FunnelStage,
  InvestorPipelineStage,
  FitTier,
  ContactEventKind,
  RelationType,
  SignalAction,
  MessageAngle,
} from "@prisma/client";
import {
  fetchAllEntityIds,
  fetchEntityDetail,
  fetchEdgesFrom,
  fetchInteractions,
  fetchGraphStats,
  mapWithConcurrency,
  type KissingerEntity,
  type KissingerEdge,
} from "./backfill/kissinger-client";
import {
  buildOrganizationPlan,
  buildContactPlan,
  buildSignalPlan,
  buildGeneratedMessagePlan,
  metaToRecord,
  type OrganizationPlan,
  type ContactPlan,
} from "./backfill/build-plan";
import { normalizeSectorSlug } from "./backfill/mappers";
import { SEED_USERS, SENDER_TO_ANGLE } from "./backfill/constants";
import {
  buildRelationshipPlan,
  resolveContactOrganization,
  buildQueueEntryPlan,
  buildContactEventPlan,
  type EntityKind,
  type RelationshipPlan,
} from "./backfill/relationships";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface Args {
  dryRun: boolean;
  /** Caps how many person/org ids (each) are processed — for smoke tests and explicitly-scoped prod runs. */
  limit: number | null;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const dryRun = argv.includes("--dry-run");
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  const concurrencyArg = argv.find((a) => a.startsWith("--concurrency="));
  return {
    dryRun,
    limit: limitArg ? Number(limitArg.split("=")[1]) : null,
    concurrency: concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 20,
  };
}

// ---------------------------------------------------------------------------
// Warnings collection — never swallowed, always surfaced in the summary.
// ---------------------------------------------------------------------------

const warnings: string[] = [];
function warn(context: string, message: string) {
  warnings.push(`[${context}] ${message}`);
}

// ---------------------------------------------------------------------------
// Fetch phase
// ---------------------------------------------------------------------------

interface FetchResult {
  personIds: string[];
  orgIds: string[];
  entityById: Map<string, KissingerEntity>;
  kindById: Map<string, EntityKind>;
  allEdges: KissingerEdge[];
  interactionsByPersonId: Map<string, Awaited<ReturnType<typeof fetchInteractions>>>;
}

async function fetchAll(args: Args): Promise<FetchResult> {
  console.log("Fetching entity ids from Kissinger...");
  let personIds = await fetchAllEntityIds("person");
  let orgIds = await fetchAllEntityIds("org");
  if (args.limit !== null) {
    personIds = personIds.slice(0, args.limit);
    orgIds = orgIds.slice(0, args.limit);
  }
  console.log(`  person ids: ${personIds.length}, org ids: ${orgIds.length}`);

  const allIds = [...orgIds, ...personIds];

  console.log("Fetching entity detail (meta/tags/notes)...");
  const entities = await mapWithConcurrency(allIds, args.concurrency, fetchEntityDetail);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const kindById = new Map<string, EntityKind>(entities.map((e) => [e.id, e.kind as EntityKind]));

  console.log("Fetching edges (edgesFrom for every entity)...");
  // Every edge has exactly one source; scanning edgesFrom over every entity
  // (person AND org) covers the full edge set without needing an edgesTo query.
  const edgeLists = await mapWithConcurrency(allIds, args.concurrency, fetchEdgesFrom);
  const allEdges = edgeLists.flat();
  console.log(`  edges fetched: ${allEdges.length}`);

  console.log("Fetching interactions (persons only — ContactEvent has no organizationId)...");
  const interactionLists = await mapWithConcurrency(personIds, args.concurrency, fetchInteractions);
  const interactionsByPersonId = new Map(personIds.map((id, i) => [id, interactionLists[i]]));

  return { personIds, orgIds, entityById, kindById, allEdges, interactionsByPersonId };
}

// ---------------------------------------------------------------------------
// Plan phase (pure builders — see scripts/backfill/*.ts)
// ---------------------------------------------------------------------------

/** Keyed by `${reason}:${relation}` so "unmapped type" and "missing endpoint" skips are never conflated. */
type RelationSkipKey = string;

interface Plans {
  orgPlans: OrganizationPlan[];
  contactPlans: ContactPlan[];
  relationshipPlans: RelationshipPlan[];
  relationSkipCounts: Map<RelationSkipKey, number>;
  orgResolutionByContactId: Map<string, ReturnType<typeof resolveContactOrganization>>;
}

function buildPlans(fetched: FetchResult): Plans {
  const orgEntities = fetched.orgIds.map((id) => fetched.entityById.get(id)).filter((e): e is KissingerEntity => !!e);
  const personEntities = fetched.personIds
    .map((id) => fetched.entityById.get(id))
    .filter((e): e is KissingerEntity => !!e);

  const orgPlans = orgEntities.map(buildOrganizationPlan);
  const contactPlans = personEntities.map(buildContactPlan);

  for (const p of orgPlans) for (const w of p.warnings) warn(`org ${p.kissingerId} ${p.name}`, w);
  for (const p of contactPlans) for (const w of p.warnings) warn(`contact ${p.kissingerId} ${p.name}`, w);

  const orgKissingerIdByLowerName = new Map<string, string>();
  for (const p of orgPlans) {
    const key = p.name.trim().toLowerCase();
    if (!orgKissingerIdByLowerName.has(key)) orgKissingerIdByLowerName.set(key, p.kissingerId);
  }

  const worksAtBySource = new Map<string, KissingerEdge[]>();
  for (const e of fetched.allEdges) {
    if (e.relation !== "works_at") continue;
    const arr = worksAtBySource.get(e.source) ?? [];
    arr.push(e);
    worksAtBySource.set(e.source, arr);
  }

  const orgResolutionByContactId = new Map<string, ReturnType<typeof resolveContactOrganization>>();
  for (const cp of contactPlans) {
    const res = resolveContactOrganization(
      worksAtBySource.get(cp.kissingerId) ?? [],
      cp.metaCompanyName,
      orgKissingerIdByLowerName
    );
    orgResolutionByContactId.set(cp.kissingerId, res);
    if (res.warning) warn(`contact ${cp.kissingerId} ${cp.name}`, res.warning);
  }

  const relationshipPlans: RelationshipPlan[] = [];
  const relationSkipCounts = new Map<RelationSkipKey, number>();
  for (const e of fetched.allEdges) {
    const { plan, reason } = buildRelationshipPlan(e, fetched.kindById);
    if (plan) relationshipPlans.push(plan);
    if (reason) {
      const key = `${reason}:${e.relation}`;
      relationSkipCounts.set(key, (relationSkipCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of relationSkipCounts) {
    const [reason, relation] = key.split(":");
    const explanation =
      reason === "unmapped_type"
        ? "no RelationType enum value"
        : "target/source entity outside the fetched set (expected on --limit runs)";
    warn("relationships", `Skipped ${count} edge(s) of relation type ${JSON.stringify(relation)}: ${explanation}`);
  }

  return { orgPlans, contactPlans, relationshipPlans, relationSkipCounts, orgResolutionByContactId };
}

// ---------------------------------------------------------------------------
// Write phase — every function below is a no-op when args.dryRun is true.
// ---------------------------------------------------------------------------

async function seedUsers(dryRun: boolean): Promise<Map<string, string>> {
  const idByEmail = new Map<string, string>();
  for (const u of SEED_USERS) idByEmail.set(u.email, u.id);
  if (dryRun) return idByEmail;

  for (const u of SEED_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        // Placeholder — KV remains the auth source of truth for now;
        // User.passwordHash is not read by any auth path yet.
        passwordHash: "MIGRATED_PLACEHOLDER_NOT_A_REAL_HASH",
        messageAngle: u.messageAngle as MessageAngle,
      },
    });
    idByEmail.set(u.email, user.id);
  }
  return idByEmail;
}

async function upsertSectors(orgPlans: OrganizationPlan[], dryRun: boolean): Promise<void> {
  const slugs = new Map<string, string>();
  for (const p of orgPlans) for (const s of p.sectors) {
    if (!slugs.has(s.slug)) slugs.set(s.slug, normalizeSectorSlug(s.slug).displayName);
  }
  if (dryRun) return;
  await Promise.all(
    [...slugs.entries()].map(([slug, displayName]) =>
      prisma.sector.upsert({ where: { slug }, update: { displayName }, create: { slug, displayName } })
    )
  );
}

async function upsertOrganizations(orgPlans: OrganizationPlan[], args: Args): Promise<Map<string, string>> {
  const idByKissingerId = new Map<string, string>();
  if (args.dryRun) {
    for (const p of orgPlans) idByKissingerId.set(p.kissingerId, `dry-run:${p.kissingerId}`);
    return idByKissingerId;
  }

  const results = await mapWithConcurrency(orgPlans, args.concurrency, async (p) => {
    const org = await prisma.organization.upsert({
      where: { kissingerId: p.kissingerId },
      update: {
        name: p.name,
        isArchived: p.isArchived,
        isProspect: p.isProspect,
        isVcFirm: p.isVcFirm,
        website: p.website,
        hq: p.hq,
        notes: p.notes,
        industry: p.industry,
        sectorPrimary: p.sectorPrimary,
        employees: p.employees,
        revenueUsd: p.revenueUsd,
        icpScore: p.icpScore,
        fitTier: p.fitTier as FitTier | null,
        apolloMarketSize: p.apolloMarketSize,
        funnelStage: p.funnelStage as FunnelStage,
        investmentStage: p.investmentStage,
        checkSize: p.checkSize,
        thesis: p.thesis,
        sectorFit: p.sectorFit,
        investorPipeline: p.investorPipeline as InvestorPipelineStage,
      },
      create: {
        kissingerId: p.kissingerId,
        name: p.name,
        isArchived: p.isArchived,
        isProspect: p.isProspect,
        isVcFirm: p.isVcFirm,
        website: p.website,
        hq: p.hq,
        notes: p.notes,
        industry: p.industry,
        sectorPrimary: p.sectorPrimary,
        employees: p.employees,
        revenueUsd: p.revenueUsd,
        icpScore: p.icpScore,
        fitTier: p.fitTier as FitTier | null,
        apolloMarketSize: p.apolloMarketSize,
        funnelStage: p.funnelStage as FunnelStage,
        investmentStage: p.investmentStage,
        checkSize: p.checkSize,
        thesis: p.thesis,
        sectorFit: p.sectorFit,
        investorPipeline: p.investorPipeline as InvestorPipelineStage,
      },
    });
    return { kissingerId: p.kissingerId, id: org.id };
  });

  for (const r of results) idByKissingerId.set(r.kissingerId, r.id);
  return idByKissingerId;
}

async function upsertOrgSectorsAndTags(
  orgPlans: OrganizationPlan[],
  orgIdByKissingerId: Map<string, string>,
  args: Args
): Promise<void> {
  if (args.dryRun) return;

  await mapWithConcurrency(orgPlans, args.concurrency, async (p) => {
    const orgId = orgIdByKissingerId.get(p.kissingerId);
    if (!orgId) return;
    for (const s of p.sectors) {
      await prisma.organizationSector.upsert({
        where: { organizationId_sectorSlug: { organizationId: orgId, sectorSlug: s.slug } },
        update: { isPrimary: s.isPrimary },
        create: { organizationId: orgId, sectorSlug: s.slug, isPrimary: s.isPrimary },
      });
    }
  });

  const tagRows = orgPlans.flatMap((p) => {
    const orgId = orgIdByKissingerId.get(p.kissingerId);
    if (!orgId) return [];
    return p.tags.map((tag) => ({ organizationId: orgId, tag }));
  });
  for (let i = 0; i < tagRows.length; i += 1000) {
    await prisma.organizationTag.createMany({ data: tagRows.slice(i, i + 1000), skipDuplicates: true });
  }
}

async function upsertContacts(
  contactPlans: ContactPlan[],
  orgResolutionByContactId: Map<string, ReturnType<typeof resolveContactOrganization>>,
  orgIdByKissingerId: Map<string, string>,
  args: Args
): Promise<Map<string, string>> {
  const idByKissingerId = new Map<string, string>();
  if (args.dryRun) {
    for (const p of contactPlans) idByKissingerId.set(p.kissingerId, `dry-run:${p.kissingerId}`);
    return idByKissingerId;
  }

  const results = await mapWithConcurrency(contactPlans, args.concurrency, async (p) => {
    const resolution = orgResolutionByContactId.get(p.kissingerId);
    const organizationId = resolution?.organizationKissingerId
      ? orgIdByKissingerId.get(resolution.organizationKissingerId) ?? null
      : null;
    if (resolution?.organizationKissingerId && !organizationId) {
      warn(`contact ${p.kissingerId} ${p.name}`, `resolved org ${resolution.organizationKissingerId} was not found among upserted Organizations (likely a --limit run); organizationId left null`);
    }

    const fields = {
      name: p.name,
      isArchived: p.isArchived,
      email: p.email,
      linkedinUrl: p.linkedinUrl,
      linkedinConnectedOn: p.linkedinConnectedOn,
      title: p.title,
      location: p.location,
      isProspectContact: p.isProspectContact,
      isInvestorContact: p.isInvestorContact,
      notes: p.notes,
      fitTier: p.fitTier as FitTier | null,
      outreachStage: p.outreachStage as OutreachStage,
      lastSignalDate: p.lastSignalDate ? new Date(p.lastSignalDate) : null,
      lastSignalKeyword: p.lastSignalKeyword,
      lastSignalUrl: p.lastSignalUrl,
      signalDismissed: p.signalDismissed,
      signalSnoozedUntil: p.signalSnoozedUntil ? new Date(p.signalSnoozedUntil) : null,
      incentive: p.incentive,
      warmIntroPath: p.warmIntroPath,
      priority: p.priority,
      organizationId,
      roleAtOrg: resolution?.roleAtOrg ?? null,
      orgStrength: resolution?.orgStrength ?? null,
    };

    const contact = await prisma.contact.upsert({
      where: { kissingerId: p.kissingerId },
      update: fields,
      create: { kissingerId: p.kissingerId, ...fields },
    });
    return { kissingerId: p.kissingerId, id: contact.id };
  });

  for (const r of results) idByKissingerId.set(r.kissingerId, r.id);
  return idByKissingerId;
}

async function upsertContactTags(
  contactPlans: ContactPlan[],
  contactIdByKissingerId: Map<string, string>,
  args: Args
): Promise<void> {
  if (args.dryRun) return;
  const tagRows = contactPlans.flatMap((p) => {
    const contactId = contactIdByKissingerId.get(p.kissingerId);
    if (!contactId) return [];
    return p.tags.map((tag) => ({ contactId, tag }));
  });
  for (let i = 0; i < tagRows.length; i += 1000) {
    await prisma.contactTag.createMany({ data: tagRows.slice(i, i + 1000), skipDuplicates: true });
  }
}

async function upsertQueueEntries(
  contactPlans: ContactPlan[],
  contactIdByKissingerId: Map<string, string>,
  orgResolutionByContactId: Map<string, ReturnType<typeof resolveContactOrganization>>,
  orgIdByKissingerId: Map<string, string>,
  args: Args
): Promise<number> {
  let count = 0;
  const withPlans = contactPlans
    .map((p) => ({ p, queuePlan: buildQueueEntryPlan(p.queueUserId, p.outreachSent) }))
    .filter((x): x is { p: ContactPlan; queuePlan: NonNullable<ReturnType<typeof buildQueueEntryPlan>> } => x.queuePlan !== null);

  count = withPlans.length;
  if (args.dryRun) return count;

  await mapWithConcurrency(withPlans, args.concurrency, async ({ p, queuePlan }) => {
    const contactId = contactIdByKissingerId.get(p.kissingerId);
    if (!contactId) return;
    const resolution = orgResolutionByContactId.get(p.kissingerId);
    const organizationId = resolution?.organizationKissingerId
      ? orgIdByKissingerId.get(resolution.organizationKissingerId) ?? null
      : null;

    // NOTE (fixed as part of GH #44, pre-existing build break): this used to be
    // a single `prisma.outreachQueueEntry.upsert({ where: { unique_active_assignment: ... } })`.
    // PR #48 (bd6ad5b) replaced the full `@@unique([contactId, isActive])` with
    // a hand-authored partial index (`WHERE "isActive" = true`) to fix an
    // invariant bug — see docs/prisma-schema-design.md / prisma/schema.prisma
    // comment on OutreachQueueEntry. Prisma's schema DSL can't express a
    // partial index, so it no longer generates a `unique_active_assignment`
    // compound-unique input type, which made this script fail `next build`'s
    // typecheck (and therefore `vercel --prod`) ever since. find-then-write
    // reproduces the same idempotent upsert-on-(contactId, isActive) semantics
    // without depending on a named unique index Prisma doesn't know about.
    const existing = await prisma.outreachQueueEntry.findFirst({
      where: { contactId, isActive: queuePlan.isActive },
      select: { id: true },
    });
    if (existing) {
      await prisma.outreachQueueEntry.update({
        where: { id: existing.id },
        data: {
          userId: queuePlan.userId,
          organizationId,
          deactivatedReason: queuePlan.deactivatedReason,
          currentStage: p.outreachStage as OutreachStage,
        },
      });
    } else {
      await prisma.outreachQueueEntry.create({
        data: {
          contactId,
          userId: queuePlan.userId,
          organizationId,
          isActive: queuePlan.isActive,
          deactivatedReason: queuePlan.deactivatedReason,
          // Judgment call: Kissinger has no historical record of the contact's
          // stage at the moment they were queued — the current outreachStage
          // is the best available proxy for both fields on initial backfill.
          stageAtAssignment: p.outreachStage as OutreachStage,
          currentStage: p.outreachStage as OutreachStage,
          deactivatedAt: queuePlan.isActive ? null : new Date(),
        },
      });
    }
  });

  return count;
}

async function upsertGeneratedMessages(
  contactPlans: ContactPlan[],
  entityById: Map<string, KissingerEntity>,
  contactIdByKissingerId: Map<string, string>,
  args: Args
): Promise<{ created: number; skippedNoAngle: number }> {
  let created = 0;
  let skippedNoAngle = 0;

  await mapWithConcurrency(contactPlans, args.concurrency, async (p) => {
    const entity = entityById.get(p.kissingerId);
    if (!entity) return;
    const meta = metaToRecord(entity.meta);
    const { plan, warning } = buildGeneratedMessagePlan(meta, SENDER_TO_ANGLE);
    if (warning) {
      warn(`contact ${p.kissingerId} ${p.name}`, warning);
      skippedNoAngle++;
    }
    if (!plan) return;
    created++;
    if (args.dryRun) return;

    const contactId = contactIdByKissingerId.get(p.kissingerId);
    if (!contactId) return;

    // No natural unique key against Kissinger data — dedup on
    // (contactId, angle, isActive=true): the backfill treats itself as
    // syncing a single current snapshot per contact+angle, not appending a
    // new version each re-run, so a matching active row is updated in place
    // rather than superseded.
    const existing = await prisma.generatedMessage.findFirst({
      where: { contactId, angle: plan.angle as MessageAngle, isActive: true },
    });
    const data = {
      messageBody: plan.messageBody,
      generatedAt: plan.generatedAt ? new Date(plan.generatedAt) : new Date(),
      generationMethod: "ai",
    };
    if (existing) {
      await prisma.generatedMessage.update({ where: { id: existing.id }, data });
    } else {
      await prisma.generatedMessage.create({
        data: { contactId, angle: plan.angle as MessageAngle, isActive: true, ...data },
      });
    }
  });

  return { created, skippedNoAngle };
}

async function upsertSignals(
  contactPlans: ContactPlan[],
  entityById: Map<string, KissingerEntity>,
  contactIdByKissingerId: Map<string, string>,
  args: Args
): Promise<number> {
  let count = 0;

  await mapWithConcurrency(contactPlans, args.concurrency, async (p) => {
    const entity = entityById.get(p.kissingerId);
    if (!entity) return;
    const meta = metaToRecord(entity.meta);
    const plan = buildSignalPlan(meta);
    if (!plan) return;
    count++;
    if (args.dryRun) return;

    const contactId = contactIdByKissingerId.get(p.kissingerId);
    if (!contactId) return;

    const signalDate = new Date(plan.signalDate);
    // No natural unique key against Kissinger data — dedup on
    // (contactId, keyword, signalDate), which together identify the same
    // source signal on re-run.
    const existing = await prisma.signal.findFirst({ where: { contactId, keyword: plan.keyword, signalDate } });
    const data = {
      postUrl: plan.postUrl,
      action: plan.action as SignalAction | null,
      snoozedUntil: plan.snoozedUntil ? new Date(plan.snoozedUntil) : null,
    };
    if (existing) {
      await prisma.signal.update({ where: { id: existing.id }, data });
    } else {
      await prisma.signal.create({ data: { contactId, keyword: plan.keyword, signalDate, ...data } });
    }
  });

  return count;
}

async function upsertContactEvents(
  personIds: string[],
  interactionsByPersonId: FetchResult["interactionsByPersonId"],
  contactIdByKissingerId: Map<string, string>,
  args: Args
): Promise<number> {
  let count = 0;

  await mapWithConcurrency(personIds, args.concurrency, async (personId) => {
    const interactions = interactionsByPersonId.get(personId) ?? [];
    for (const interaction of interactions) {
      const plan = buildContactEventPlan(interaction);
      count++;
      if (args.dryRun) continue;

      const contactId = contactIdByKissingerId.get(personId);
      if (!contactId) continue;

      const occurredAt = new Date(plan.occurredAt);
      // No natural unique key against Kissinger data — dedup on
      // (contactId, kind, occurredAt, subject), which together identify the
      // same source interaction on re-run. Events are immutable history,
      // so an existing match is left as-is (no update needed).
      const existing = await prisma.contactEvent.findFirst({
        where: { contactId, kind: plan.kind as ContactEventKind, occurredAt, subject: plan.subject },
      });
      if (!existing) {
        await prisma.contactEvent.create({
          data: { contactId, kind: plan.kind as ContactEventKind, occurredAt, subject: plan.subject, notes: plan.notes },
        });
      }
    }
  });

  return count;
}

async function upsertRelationships(
  relationshipPlans: RelationshipPlan[],
  contactIdByKissingerId: Map<string, string>,
  orgIdByKissingerId: Map<string, string>,
  args: Args
): Promise<{ created: number; skippedMissingEndpoint: number }> {
  let created = 0;
  let skippedMissingEndpoint = 0;

  function resolveEndpoint(kissingerId: string, kind: EntityKind): { personId: string | null; orgId: string | null } {
    if (kind === "person") return { personId: contactIdByKissingerId.get(kissingerId) ?? null, orgId: null };
    return { personId: null, orgId: orgIdByKissingerId.get(kissingerId) ?? null };
  }

  await mapWithConcurrency(relationshipPlans, args.concurrency, async (plan) => {
    const source = resolveEndpoint(plan.sourceKissingerId, plan.sourceKind);
    const target = resolveEndpoint(plan.targetKissingerId, plan.targetKind);
    if ((!source.personId && !source.orgId) || (!target.personId && !target.orgId)) {
      skippedMissingEndpoint++;
      warn(
        "relationships",
        `${plan.relationType} ${plan.sourceKissingerId} -> ${plan.targetKissingerId}: endpoint not found among upserted rows (likely a --limit run); skipped`
      );
      return;
    }

    created++;
    if (args.dryRun) return;

    const relationType = plan.relationType as RelationType;
    // No natural unique key against Kissinger data — dedup on the full
    // (relationType, source, target) tuple, which is the edge's identity.
    const existing = await prisma.relationshipFrom.findFirst({
      where: {
        relationType,
        sourcePersonId: source.personId,
        sourceOrgId: source.orgId,
        targetPersonId: target.personId,
        targetOrgId: target.orgId,
      },
    });
    const data = { strength: plan.strength, notes: plan.notes };
    if (existing) {
      await prisma.relationshipFrom.update({ where: { id: existing.id }, data });
    } else {
      await prisma.relationshipFrom.create({
        data: {
          relationType,
          sourcePersonId: source.personId,
          sourceOrgId: source.orgId,
          targetPersonId: target.personId,
          targetOrgId: target.orgId,
          ...data,
        },
      });
    }
  });

  return { created, skippedMissingEndpoint };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

async function printParityReport(kissingerStats: Awaited<ReturnType<typeof fetchGraphStats>>, args: Args) {
  if (args.dryRun) {
    console.log("\n(dry run — no Postgres parity check; counts above are Kissinger-side only)");
    return;
  }

  const [orgCount, contactCount, userCount, sectorCount, orgSectorCount, orgTagCount, contactTagCount, relCount, queueCount, msgCount, sigCount, eventCount] =
    await Promise.all([
      prisma.organization.count(),
      prisma.contact.count(),
      prisma.user.count(),
      prisma.sector.count(),
      prisma.organizationSector.count(),
      prisma.organizationTag.count(),
      prisma.contactTag.count(),
      prisma.relationshipFrom.count(),
      prisma.outreachQueueEntry.count(),
      prisma.generatedMessage.count(),
      prisma.signal.count(),
      prisma.contactEvent.count(),
    ]);

  const kissingerOrgCount = kissingerStats.entitiesByKind.find((k) => k.kind === "org")?.count ?? 0;
  const kissingerPersonCount = kissingerStats.entitiesByKind.find((k) => k.kind === "person")?.count ?? 0;

  console.log("\n=== Parity report (Postgres row counts) ===");
  console.log(`Organization:       ${orgCount}  (Kissinger org entities: ${kissingerOrgCount})${args.limit ? " [partial: --limit applied]" : orgCount === kissingerOrgCount ? "  MATCH" : "  MISMATCH"}`);
  console.log(`Contact:            ${contactCount}  (Kissinger person entities: ${kissingerPersonCount})${args.limit ? " [partial: --limit applied]" : contactCount === kissingerPersonCount ? "  MATCH" : "  MISMATCH"}`);
  console.log(`User:               ${userCount}`);
  console.log(`Sector:             ${sectorCount}`);
  console.log(`OrganizationSector: ${orgSectorCount}`);
  console.log(`OrganizationTag:    ${orgTagCount}`);
  console.log(`ContactTag:         ${contactTagCount}`);
  console.log(`RelationshipFrom:   ${relCount}`);
  console.log(`OutreachQueueEntry: ${queueCount}`);
  console.log(`GeneratedMessage:   ${msgCount}`);
  console.log(`Signal:             ${sigCount}`);
  console.log(`ContactEvent:       ${eventCount}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const loadedEnvFile = loadEnvFile([".env.production.local", ".env.local", ".env"]);
  console.log(`Loaded env from: ${loadedEnvFile ?? "(none found — using pre-set process.env only)"}`);
  // Deferred until after loadEnvFile() so src/lib/prisma.ts's module-level
  // adapter construction reads the DATABASE_URL we just loaded (see the
  // NOTE at the top of this file on import hoisting).
  ({ prisma } = await import("../src/lib/prisma"));

  const args = parseArgs(process.argv.slice(2));
  console.log(`=== Kissinger -> Postgres backfill ===`);
  console.log(`Mode: ${args.dryRun ? "DRY RUN (no Postgres writes)" : "REAL RUN (writing to Postgres)"}`);
  if (args.limit !== null) console.log(`Limit: ${args.limit} ids per kind (person/org)`);
  console.log(`Concurrency: ${args.concurrency}`);

  const kissingerStats = await fetchGraphStats();
  console.log("\nKissinger graphStats:", JSON.stringify(kissingerStats, null, 2));

  const fetched = await fetchAll(args);
  const plans = buildPlans(fetched);

  console.log("\n=== Plan summary ===");
  console.log(`Organizations to upsert: ${plans.orgPlans.length}`);
  console.log(`Contacts to upsert:      ${plans.contactPlans.length}`);
  console.log(`Relationships to upsert (edges mapped): ${plans.relationshipPlans.length}`);
  for (const [key, count] of plans.relationSkipCounts) {
    const [reason, relation] = key.split(":");
    console.log(`  skipped ${count} edge(s) of relation type ${relation} (${reason})`);
  }

  const userIdByEmail = await seedUsers(args.dryRun);
  console.log(`\nSeed users: ${[...userIdByEmail.entries()].map(([e, id]) => `${e}=${id}`).join(", ")}`);

  await upsertSectors(plans.orgPlans, args.dryRun);
  const orgIdByKissingerId = await upsertOrganizations(plans.orgPlans, args);
  await upsertOrgSectorsAndTags(plans.orgPlans, orgIdByKissingerId, args);

  const contactIdByKissingerId = await upsertContacts(
    plans.contactPlans,
    plans.orgResolutionByContactId,
    orgIdByKissingerId,
    args
  );
  await upsertContactTags(plans.contactPlans, contactIdByKissingerId, args);

  const queueCount = await upsertQueueEntries(
    plans.contactPlans,
    contactIdByKissingerId,
    plans.orgResolutionByContactId,
    orgIdByKissingerId,
    args
  );
  const { created: msgCount, skippedNoAngle } = await upsertGeneratedMessages(
    plans.contactPlans,
    fetched.entityById,
    contactIdByKissingerId,
    args
  );
  const sigCount = await upsertSignals(plans.contactPlans, fetched.entityById, contactIdByKissingerId, args);
  const eventCount = await upsertContactEvents(
    fetched.personIds,
    fetched.interactionsByPersonId,
    contactIdByKissingerId,
    args
  );
  const { created: relCreated, skippedMissingEndpoint } = await upsertRelationships(
    plans.relationshipPlans,
    contactIdByKissingerId,
    orgIdByKissingerId,
    args
  );

  console.log("\n=== Write summary ===");
  console.log(`OutreachQueueEntry: ${queueCount}`);
  console.log(`GeneratedMessage:   ${msgCount} (skipped, unmapped sender: ${skippedNoAngle})`);
  console.log(`Signal:             ${sigCount}`);
  console.log(`ContactEvent:       ${eventCount}`);
  console.log(`RelationshipFrom:   ${relCreated} (skipped, missing endpoint: ${skippedMissingEndpoint})`);

  await printParityReport(kissingerStats, args);

  console.log(`\n=== Warnings (${warnings.length}) ===`);
  const WARNING_PRINT_LIMIT = 50;
  for (const w of warnings.slice(0, WARNING_PRINT_LIMIT)) console.log(`  - ${w}`);
  if (warnings.length > WARNING_PRINT_LIMIT) {
    console.log(`  ... and ${warnings.length - WARNING_PRINT_LIMIT} more (see full log if written to file)`);
  }

  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
