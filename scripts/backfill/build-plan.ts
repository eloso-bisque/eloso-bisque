/**
 * Pure "plan builder" functions: turn a fetched Kissinger entity (+ meta)
 * into plain-data upsert plans. No Prisma import, no network I/O — this is
 * the functional core; scripts/backfill-kissinger.ts is the imperative shell
 * that executes these plans against Postgres.
 */

import type { KissingerEntity, KissingerMeta } from "./kissinger-client";
import {
  classifyOrgTags,
  classifyPersonTags,
  resolveHq,
  parseEmployeeCount,
  parseRevenueEstimate,
  mapFunnelStage,
  mapInvestorPipelineStage,
  mapOutreachStage,
  normalizeSectorSlug,
} from "./mappers";
import { parseNestedMeta, resolveTitleFromMeta, resolveCompanyFromMeta } from "../../src/lib/kissinger-meta";

export function metaToRecord(meta: KissingerMeta[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const m of meta) record[m.key] = m.value;
  return record;
}

function parseFloatOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}

export interface OrganizationPlan {
  kissingerId: string;
  name: string;
  isArchived: boolean;
  isProspect: boolean;
  isVcFirm: boolean;
  website: string | null;
  hq: string | null;
  notes: string | null;
  industry: string | null;
  sectorPrimary: string | null;
  employees: number | null;
  revenueUsd: number | null;
  icpScore: number | null;
  fitTier: string | null;
  apolloMarketSize: number | null;
  funnelStage: string;
  investmentStage: string | null;
  checkSize: string | null;
  thesis: string | null;
  sectorFit: string | null;
  investorPipeline: string;
  /** (slug, isPrimary) pairs to upsert as Sector + OrganizationSector rows. */
  sectors: { slug: string; isPrimary: boolean }[];
  /** Plain OrganizationTag rows (unmapped tags + synthetic tags like priority:<value>). */
  tags: string[];
  warnings: string[];
}

export function buildOrganizationPlan(entity: KissingerEntity): OrganizationPlan {
  const meta = metaToRecord(entity.meta);
  const classification = classifyOrgTags(entity.tags);
  const warnings: string[] = [];

  const funnelStage = mapFunnelStage(meta.funnel_stage);
  if (funnelStage.warning) warnings.push(funnelStage.warning);
  const investorPipeline = mapInvestorPipelineStage(meta.pipeline_stage);
  if (investorPipeline.warning) warnings.push(investorPipeline.warning);

  const sectors: { slug: string; isPrimary: boolean }[] = [];
  const seenSlugs = new Set<string>();
  const addSector = (rawSlug: string, isPrimary: boolean) => {
    const { slug } = normalizeSectorSlug(rawSlug);
    if (seenSlugs.has(slug)) return;
    seenSlugs.add(slug);
    sectors.push({ slug, isPrimary });
  };
  if (meta.sector_primary) addSector(meta.sector_primary, true);
  if (meta.sector_secondary) addSector(meta.sector_secondary, false);
  for (const slug of classification.sectorSlugs) addSector(slug, slug === meta.sector_primary);

  // Judgment call: Organization has no `priority` column (unlike Contact,
  // which does). Real VC-firm orgs carry a `priority` meta value with no
  // schema destination — preserved as a synthetic tag rather than dropped.
  const tags = [...classification.plainTags];
  if (meta.priority) tags.push(`priority:${meta.priority}`);

  return {
    kissingerId: entity.id,
    name: entity.name,
    isArchived: entity.archived,
    isProspect: classification.isProspect,
    isVcFirm: classification.isVcFirm,
    website: meta.website ?? null,
    hq: resolveHq(meta),
    notes: entity.notes || null,
    industry: meta.industry ?? null,
    sectorPrimary: meta.sector_primary ?? null,
    employees: parseEmployeeCount(meta.employee_count ?? meta.employees),
    revenueUsd: parseRevenueEstimate(meta.revenue_estimate ?? meta.revenue),
    icpScore: parseFloatOrNull(meta.icp_score),
    fitTier: classification.fitTier,
    apolloMarketSize: parseFloatOrNull(meta.apollo_market_size),
    funnelStage: funnelStage.value,
    investmentStage: meta.stage ?? null,
    checkSize: meta.check_size ?? null,
    thesis: meta.thesis ?? null,
    sectorFit: meta.sector_fit ?? null,
    investorPipeline: investorPipeline.value,
    sectors,
    tags,
    warnings,
  };
}

/**
 * Builds an OrganizationPlan for a freeform company/org name that has no
 * corresponding Kissinger Organization entity and no `works_at` edge from
 * any contact — see `findSyntheticOrgCandidates` (relationships.ts) for how
 * these names are identified, and `syntheticOrgKissingerId` for how
 * `kissingerId` is derived. Every field with no real signal is left at a
 * neutral default rather than guessed.
 */
export function buildSyntheticOrganizationPlan(kissingerId: string, name: string): OrganizationPlan {
  return {
    kissingerId,
    name,
    isArchived: false,
    isProspect: true,
    isVcFirm: false,
    website: null,
    hq: null,
    notes:
      "Auto-created from a prospect contact's company/org meta text; no matching Kissinger Organization entity or works_at edge existed for this name.",
    industry: null,
    sectorPrimary: null,
    employees: null,
    revenueUsd: null,
    icpScore: null,
    fitTier: null,
    apolloMarketSize: null,
    funnelStage: "Identified",
    investmentStage: null,
    checkSize: null,
    thesis: null,
    sectorFit: null,
    investorPipeline: "Research",
    sectors: [],
    tags: ["auto-created"],
    warnings: [],
  };
}

export interface ContactPlan {
  kissingerId: string;
  name: string;
  isArchived: boolean;
  email: string | null;
  linkedinUrl: string | null;
  linkedinConnectedOn: string | null;
  title: string | null;
  location: string | null;
  isProspectContact: boolean;
  isInvestorContact: boolean;
  notes: string | null;
  fitTier: string | null;
  outreachStage: string;
  lastSignalDate: string | null;
  lastSignalKeyword: string | null;
  lastSignalUrl: string | null;
  signalDismissed: boolean;
  signalSnoozedUntil: string | null;
  incentive: string | null;
  warmIntroPath: string | null;
  priority: string | null;
  /** Plain ContactTag rows (unmapped tags). */
  tags: string[];
  queueUserId: string | null;
  outreachSent: boolean;
  /** Company name from meta, used as a fallback org-resolution signal when no works_at edge exists. */
  metaCompanyName: string | null;
  warnings: string[];
}

export function buildContactPlan(entity: KissingerEntity): ContactPlan {
  const meta = metaToRecord(entity.meta);
  const classification = classifyPersonTags(entity.tags);
  const warnings: string[] = [];
  if (classification.warning) warnings.push(classification.warning);

  const outreachStage = mapOutreachStage(meta.outreach_stage);
  if (outreachStage.warning) warnings.push(outreachStage.warning);

  // Mirrors src/lib/kissinger.ts's live title/company resolution exactly
  // (shared helpers in src/lib/kissinger-meta.ts) — Apollo-re-enriched
  // contacts store title/org inside a JSON blob at meta key "meta" rather
  // than as direct top-level meta keys, and some LinkedIn-sourced contacts
  // use "headline" in lieu of "title".
  const nestedMeta = parseNestedMeta(meta);

  return {
    kissingerId: entity.id,
    name: entity.name,
    isArchived: entity.archived,
    email: meta.email ?? null,
    linkedinUrl: meta.linkedin_url ?? meta.linkedin ?? null,
    linkedinConnectedOn: meta.connected_on ?? null,
    title: resolveTitleFromMeta(meta, nestedMeta) || null,
    location: meta.location ?? null,
    isProspectContact: classification.isProspectContact,
    isInvestorContact: classification.isInvestorContact,
    notes: entity.notes || null,
    fitTier: classification.fitTier,
    outreachStage: outreachStage.value,
    lastSignalDate: meta.last_signal_date ?? null,
    lastSignalKeyword: meta.last_signal_keyword ?? null,
    lastSignalUrl: meta.last_signal_url ?? null,
    signalDismissed: meta.signal_dismissed === "true",
    signalSnoozedUntil: meta.signal_snoozed_until ?? null,
    incentive: meta.incentive ?? null,
    warmIntroPath: meta.warm_intro_path ?? null,
    priority: meta.priority ?? null,
    tags: classification.plainTags,
    queueUserId: classification.queueUserId,
    outreachSent: classification.outreachSent,
    metaCompanyName: resolveCompanyFromMeta(meta, nestedMeta) || null,
    warnings,
  };
}

export interface SignalPlan {
  keyword: string;
  postUrl: string | null;
  signalDate: string;
  action: "snoozed" | "dismissed" | null;
  snoozedUntil: string | null;
}

/**
 * Builds a Signal plan from a Contact's meta, or null if no `last_signal_date`
 * is present (Signal.signalDate is non-nullable, so this is the row's
 * existence condition — matches design doc 4.2).
 */
export function buildSignalPlan(meta: Record<string, string>): SignalPlan | null {
  if (!meta.last_signal_date) return null;
  return {
    // Judgment call: Signal.keyword is non-nullable; default to "" when
    // last_signal_date is present but last_signal_keyword is missing.
    keyword: meta.last_signal_keyword ?? "",
    postUrl: meta.last_signal_url ?? null,
    signalDate: meta.last_signal_date,
    action: meta.signal_dismissed === "true" ? "dismissed" : meta.signal_snoozed_until ? "snoozed" : null,
    snoozedUntil: meta.signal_snoozed_until ?? null,
  };
}

export interface GeneratedMessagePlan {
  angle: "vision" | "technical" | "strategic";
  messageBody: string;
  generatedAt: string | null;
}

/**
 * Builds a GeneratedMessage plan from meta, or null if no `outreach_message`
 * is present. `outreach_message_sender` (a user first name) maps to the
 * MessageAngle enum via SENDER_TO_ANGLE; unrecognized senders default to the
 * message-less state (angle is required) — see caller for the warning.
 */
export function buildGeneratedMessagePlan(
  meta: Record<string, string>,
  senderToAngle: Record<string, "vision" | "technical" | "strategic">
): { plan: GeneratedMessagePlan | null; warning?: string } {
  if (!meta.outreach_message) return { plan: null };

  const sender = meta.outreach_message_sender;
  const angle = sender ? senderToAngle[sender] : undefined;
  if (!angle) {
    return {
      plan: null,
      warning: `outreach_message present but outreach_message_sender ${JSON.stringify(
        sender
      )} doesn't map to a known angle; message skipped`,
    };
  }

  return {
    plan: {
      angle,
      messageBody: meta.outreach_message,
      generatedAt: meta.outreach_message_generated_at ?? null,
    },
  };
}
