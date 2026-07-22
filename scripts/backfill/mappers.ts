/**
 * Pure mapping/parsing functions for the Kissinger -> Postgres backfill.
 *
 * These functions have no I/O — they take Kissinger's raw strings/tags/meta
 * and return typed values (plus an optional human-readable `warning` for
 * anything that had to fall back to a default). Keeping them pure makes the
 * many data-mapping judgment calls independently testable, without a live
 * GraphQL server or database.
 */

import {
  OUTREACH_STAGES,
  OUTREACH_STAGE_ALIASES,
  type OutreachStageValue,
  FUNNEL_STAGES,
  type FunnelStageValue,
  INVESTOR_PIPELINE_STAGES,
  type InvestorPipelineStageValue,
  type FitTierValue,
  type ContactEventKindValue,
  ORG_PROSPECT_TAG,
  ORG_VC_TAGS,
  PERSON_PROSPECT_CONTACT_TAG,
  PERSON_INVESTOR_TAG,
  OUTREACH_SENT_TAG,
  FIT_TAG_PREFIX,
  VERTICAL_TAG_PREFIX,
  QUEUE_TAG_PREFIX,
  QUEUE_TAG_TO_USER_ID,
} from "./constants";

export interface MappedValue<T> {
  value: T;
  /** Present when the raw input didn't match a known value and a default was used. */
  warning?: string;
}

function mapEnumWithAlias<T extends string>(
  raw: string | undefined,
  validValues: readonly T[],
  defaultValue: T,
  aliases: Record<string, T> = {},
  fieldLabel: string,
  caseInsensitive = false
): MappedValue<T> {
  if (raw === undefined || raw === null || raw === "") {
    return { value: defaultValue };
  }

  if ((validValues as readonly string[]).includes(raw)) {
    return { value: raw as T };
  }

  if (raw in aliases) {
    return { value: aliases[raw] };
  }

  if (caseInsensitive) {
    const lowerMatch = validValues.find((v) => v.toLowerCase() === raw.toLowerCase());
    if (lowerMatch) return { value: lowerMatch };
  }

  return {
    value: defaultValue,
    warning: `Unrecognized ${fieldLabel} value ${JSON.stringify(raw)}; defaulted to ${defaultValue}`,
  };
}

export function mapOutreachStage(raw: string | undefined): MappedValue<OutreachStageValue> {
  return mapEnumWithAlias(raw, OUTREACH_STAGES, "cold", OUTREACH_STAGE_ALIASES, "outreach_stage");
}

export function mapFunnelStage(raw: string | undefined): MappedValue<FunnelStageValue> {
  return mapEnumWithAlias(raw, FUNNEL_STAGES, "Identified", {}, "funnel_stage");
}

export function mapInvestorPipelineStage(raw: string | undefined): MappedValue<InvestorPipelineStageValue> {
  return mapEnumWithAlias(raw, INVESTOR_PIPELINE_STAGES, "Research", {}, "pipeline_stage", true);
}

// ---------------------------------------------------------------------------
// Numeric parsers for messy free-text meta values.
// ---------------------------------------------------------------------------

/** Matches a dollar amount like "$400M", "$2.5B", "$800K", "$0". */
const MONEY_TOKEN = /\$?([\d,.]+)\s*([BbMmKk]?)/;
const MONEY_MULTIPLIER: Record<string, number> = { b: 1e9, m: 1e6, k: 1e3, "": 1 };

/**
 * Parses free-text revenue estimates such as "$400M-$600M", "$2B+ (est.)",
 * or "$0 revenue (pre-revenue); ~$800M raised".
 *
 * Judgment call: only a leading "$X-$Y" range (immediately adjacent, no
 * intervening text) is averaged. A single leading amount is used as-is
 * otherwise — this deliberately avoids misinterpreting trailing unrelated
 * dollar figures (e.g. capital raised) as part of a revenue range.
 */
export function parseRevenueEstimate(raw: string | undefined): number | null {
  if (!raw) return null;

  const rangeMatch = raw.match(
    /^\$?([\d,.]+)\s*([BbMmKk]?)\s*-\s*\$?([\d,.]+)\s*([BbMmKk]?)/
  );
  if (rangeMatch) {
    const [, n1, u1, n2, u2] = rangeMatch;
    const low = parseFloat(n1.replace(/,/g, "")) * MONEY_MULTIPLIER[u1.toLowerCase()];
    const high = parseFloat(n2.replace(/,/g, "")) * MONEY_MULTIPLIER[u2.toLowerCase()];
    if (!Number.isNaN(low) && !Number.isNaN(high)) {
      return (low + high) / 2;
    }
  }

  const singleMatch = raw.match(MONEY_TOKEN);
  if (singleMatch) {
    const [, n, u] = singleMatch;
    const amount = parseFloat(n.replace(/,/g, "")) * MONEY_MULTIPLIER[u.toLowerCase()];
    if (!Number.isNaN(amount)) return amount;
  }

  return null;
}

/**
 * Parses free-text employee counts such as "~1,200" or "~400-600".
 * Ranges are averaged; single values are used as-is.
 */
export function parseEmployeeCount(raw: string | undefined): number | null {
  if (!raw) return null;

  const cleaned = raw.replace(/~/g, "").trim();
  const rangeMatch = cleaned.match(/^([\d,]+)\s*-\s*([\d,]+)/);
  if (rangeMatch) {
    const low = parseInt(rangeMatch[1].replace(/,/g, ""), 10);
    const high = parseInt(rangeMatch[2].replace(/,/g, ""), 10);
    if (!Number.isNaN(low) && !Number.isNaN(high)) {
      return Math.round((low + high) / 2);
    }
  }

  const singleMatch = cleaned.match(/^([\d,]+)/);
  if (singleMatch) {
    const value = parseInt(singleMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(value)) return value;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tag classification
// ---------------------------------------------------------------------------

export interface OrgTagClassification {
  isProspect: boolean;
  isVcFirm: boolean;
  fitTier: FitTierValue | null;
  /** Sector slugs found via `vertical:<slug>` tags (raw, not yet normalized). */
  sectorSlugs: string[];
  /** Tags with no structured destination — persisted as plain OrganizationTag rows. */
  plainTags: string[];
}

export function classifyOrgTags(tags: string[]): OrgTagClassification {
  const sectorSlugs: string[] = [];
  const plainTags: string[] = [];
  let fitTier: FitTierValue | null = null;

  for (const tag of tags) {
    if (tag === ORG_PROSPECT_TAG || ORG_VC_TAGS.includes(tag)) continue;
    if (tag.startsWith(VERTICAL_TAG_PREFIX)) {
      sectorSlugs.push(tag.slice(VERTICAL_TAG_PREFIX.length));
      continue;
    }
    if (tag.startsWith(FIT_TAG_PREFIX)) {
      const tier = tag.slice(FIT_TAG_PREFIX.length);
      if (tier === "high" || tier === "medium" || tier === "low") {
        fitTier = tier;
        continue;
      }
    }
    plainTags.push(tag);
  }

  return {
    isProspect: tags.includes(ORG_PROSPECT_TAG),
    // Judgment call: isProspect and isVcFirm are set independently (not
    // mutually exclusive) — real data has orgs tagged both "prospect" and
    // "vc"/"investor" simultaneously, contradicting the schema comment.
    isVcFirm: ORG_VC_TAGS.some((t) => tags.includes(t)),
    fitTier,
    sectorSlugs,
    plainTags,
  };
}

export interface PersonTagClassification {
  isProspectContact: boolean;
  isInvestorContact: boolean;
  fitTier: FitTierValue | null;
  queueUserId: string | null;
  outreachSent: boolean;
  plainTags: string[];
  warning?: string;
}

export function classifyPersonTags(tags: string[]): PersonTagClassification {
  const plainTags: string[] = [];
  let fitTier: FitTierValue | null = null;
  let queueUserId: string | null = null;
  let warning: string | undefined;

  for (const tag of tags) {
    if (tag === PERSON_PROSPECT_CONTACT_TAG || tag === PERSON_INVESTOR_TAG || tag === OUTREACH_SENT_TAG) {
      continue;
    }
    if (tag.startsWith(QUEUE_TAG_PREFIX)) {
      const name = tag.slice(QUEUE_TAG_PREFIX.length);
      const userId = QUEUE_TAG_TO_USER_ID[name];
      if (userId) {
        queueUserId = userId;
        continue;
      }
      warning = `Unrecognized queue tag ${JSON.stringify(tag)}; no matching user, kept as plain tag`;
      plainTags.push(tag);
      continue;
    }
    if (tag.startsWith(FIT_TAG_PREFIX)) {
      const tier = tag.slice(FIT_TAG_PREFIX.length);
      if (tier === "high" || tier === "medium" || tier === "low") {
        fitTier = tier;
        continue;
      }
    }
    plainTags.push(tag);
  }

  return {
    isProspectContact: tags.includes(PERSON_PROSPECT_CONTACT_TAG),
    isInvestorContact: tags.includes(PERSON_INVESTOR_TAG),
    fitTier,
    queueUserId,
    outreachSent: tags.includes(OUTREACH_SENT_TAG),
    plainTags,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Meta field helpers
// ---------------------------------------------------------------------------

/**
 * Resolves an Organization's HQ location from whichever meta key is present.
 * Judgment call: real data has three overlapping keys (`hq`, `hq_location`,
 * `location`); `hq` is the most literal so it wins when multiple are set.
 */
export function resolveHq(meta: Record<string, string | undefined>): string | null {
  return meta.hq ?? meta.hq_location ?? meta.location ?? null;
}

const CONTACT_EVENT_KIND_MAP: Record<string, ContactEventKindValue> = {
  note: "Note",
  meeting: "Meeting",
  email: "Email",
  call: "Call",
};

/**
 * Maps a raw Kissinger interaction `kind` string to ContactEventKind.
 * Judgment call: real interactions include `outreach_touch_1`/`outreach_touch_2`
 * records (no participant/user/stage data attached) which have no dedicated
 * enum value and aren't safely reconstructable as OutreachTouch rows (that
 * model requires a non-null userId + stage transition we can't derive from
 * the interaction alone). They're preserved as Custom ContactEvents instead
 * of being dropped or guessed into OutreachTouch.
 */
export function mapContactEventKind(rawKind: string): ContactEventKindValue {
  return CONTACT_EVENT_KIND_MAP[rawKind.toLowerCase()] ?? "Custom";
}

/**
 * Extracts a role/title from a works_at edge's notes field, which typically
 * reads like "Co-Founder & COO at Anduril Industries" — strips the trailing
 * " at <OrgName>" suffix. Mirrors src/lib/kissinger.ts's extractRole().
 */
export function extractRoleFromEdgeNotes(edgeNotes: string): string | null {
  if (!edgeNotes) return null;
  const atIdx = edgeNotes.lastIndexOf(" at ");
  if (atIdx > 0) return edgeNotes.slice(0, atIdx);
  return edgeNotes;
}

/**
 * Normalizes a sector slug from either `sector_primary`/`sector_secondary`
 * meta (snake_case, e.g. "defense_aerospace") or a `vertical:<slug>` tag
 * (already hyphenated or snake_case) into the hyphenated form + display name
 * used by the Sector model (matching the design doc's examples, e.g.
 * "defense-aerospace").
 */
export function normalizeSectorSlug(raw: string): { slug: string; displayName: string } {
  const slug = raw.replace(/_/g, "-").toLowerCase();
  const displayName = slug
    .split("-")
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
  return { slug, displayName };
}
