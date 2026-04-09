/**
 * Contact scoring engine for Eloso CRM.
 *
 * Produces a 0–100 score for each contact, indicating fit as a potential
 * customer or design partner for Eloso's AI-driven supply chain optimization
 * platform.
 *
 * Six factors:
 *   1. titleRelevance    (30%) — Role alignment with Eloso ICP
 *   2. seniority         (25%) — Level within org
 *   3. orgType           (20%) — Prospect vs VC vs unknown
 *   4. interactionRecency (10%) — Freshness of last contact
 *   5. networkProximity  (8%)  — Connection to allies/prospects
 *   6. recordCompleteness (7%) — How complete the data is
 *
 * ICP: CSCO, VP/Director Supply Chain, Demand Planners at backlog-intensive
 * manufacturers ($100M+ revenue, aerospace / heavy equipment / industrial).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoringEdge {
  relation: string;
  strength: number;
  target_tags?: string[];
}

export interface ScoringContact {
  id?: string;
  name?: string;
  kind?: string;
  tags?: string[];
  notes?: string;
  /** Kissinger meta array */
  meta?: { key: string; value: string }[];
  updatedAt?: string;
  /** ISO string of most recent interaction (optional enrichment) */
  last_interaction_at?: string;
  /** Edges from this entity */
  edges?: ScoringEdge[];
  /** Tags of the org this person works at (optional enrichment) */
  org_tags?: string[];
}

export interface FactorResult {
  raw: number;
  weight: number;
  weighted: number;
  label: string;
}

export interface ScoreResult {
  score: number;
  breakdown: Record<string, FactorResult>;
}

// ---------------------------------------------------------------------------
// Weights — must sum to 1.0
// ---------------------------------------------------------------------------

const WEIGHTS = {
  titleRelevance: 0.30,
  seniority: 0.25,
  orgType: 0.20,
  interactionRecency: 0.10,
  networkProximity: 0.08,
  recordCompleteness: 0.07,
} as const;

// ---------------------------------------------------------------------------
// Title relevance
// ---------------------------------------------------------------------------

const TITLE_HIGH_PATTERNS = [
  /\bcsco\b/i,
  /\bchief supply chain\b/i,
  /\bvp.{0,10}supply chain\b/i,
  /\bvice president.{0,10}supply chain\b/i,
  /\bdirector.{0,10}supply chain\b/i,
  /\bhead of supply chain\b/i,
  /\bdemand plan/i,        // demand planner, demand planning
  /\bsupply plan/i,        // supply planner, supply planning
  /\bprocurement\b/i,
  /\boperations\b/i,
  /\blogistics\b/i,
  /\bmaterials management\b/i,
  /\binventory\b/i,
  /\bsupply chain\b/i,
];

const TITLE_MEDIUM_PATTERNS = [
  /\bceo\b/i,
  /\bchief executive\b/i,
  /\bcoo\b/i,
  /\bchief operating\b/i,
  /\bcio\b/i,
  /\bchief information\b/i,
  /\bchief technology\b/i,
  /\bcto\b/i,
  /\bvp.{0,10}operations\b/i,
  /\bvice president.{0,10}operations\b/i,
  /\bdirector.{0,10}operations\b/i,
  /\bmanufacturing\b/i,
  /\bplanning\b/i,
  /\bforecasting\b/i,
];

const SUPPLY_CHAIN_TAGS = new Set(["supply-chain", "supply_chain", "scm", "operations", "procurement", "logistics"]);

function scoreTitleRelevance(contact: ScoringContact): number {
  const title = getMeta(contact, "title") ?? "";
  const notes = contact.notes ?? "";
  const tags = (contact.tags ?? []).map((t) => t.toLowerCase());
  const text = `${title} ${notes}`.trim();

  if (TITLE_HIGH_PATTERNS.some((p) => p.test(text))) return 1.0;
  if (tags.some((t) => SUPPLY_CHAIN_TAGS.has(t))) return 1.0;
  if (TITLE_MEDIUM_PATTERNS.some((p) => p.test(text))) return 0.55;
  return 0.0;
}

// ---------------------------------------------------------------------------
// Seniority
// ---------------------------------------------------------------------------

const SENIORITY_CLEVEL = [/\bceo\b/i, /\bcoo\b/i, /\bcto\b/i, /\bcfo\b/i, /\bcio\b/i, /\bcsco\b/i, /\bchief\b/i, /\bpresident\b/i, /\bfounder\b/i, /\bco-founder\b/i];
const SENIORITY_VP = [/\bvp\b/i, /\bvice president\b/i, /\bsvp\b/i, /\bevp\b/i, /\bgm\b/i, /\bgeneral manager\b/i];
const SENIORITY_DIR = [/\bdirector\b/i, /\bhead of\b/i, /\bsenior director\b/i];
const SENIORITY_MGR = [/\bmanager\b/i, /\blead\b/i, /\bsenior\b/i, /\bprincipal\b/i];

function scoreSeniority(contact: ScoringContact): number {
  const title = getMeta(contact, "title") ?? "";
  if (!title) return 0.0;
  if (SENIORITY_CLEVEL.some((p) => p.test(title))) return 1.0;
  if (SENIORITY_VP.some((p) => p.test(title))) return 0.80;
  if (SENIORITY_DIR.some((p) => p.test(title))) return 0.65;
  if (SENIORITY_MGR.some((p) => p.test(title))) return 0.40;
  return 0.20;
}

// ---------------------------------------------------------------------------
// Org type
// ---------------------------------------------------------------------------

const PROSPECT_TAGS = new Set(["prospect", "eloso", "prospect-contact"]);
const VC_TAGS = new Set(["vc", "investor", "seed", "series-a", "series-b", "pre-seed"]);
const ALLY_TAGS = new Set(["ally", "advisor", "board", "partner"]);

function scoreOrgType(contact: ScoringContact): number {
  const tags = new Set((contact.tags ?? []).map((t) => t.toLowerCase()));
  const orgTags = new Set((contact.org_tags ?? []).map((t) => t.toLowerCase()));
  const combined = new Set([...tags, ...orgTags]);

  if ([...combined].some((t) => PROSPECT_TAGS.has(t))) return 1.0;
  if ([...combined].some((t) => ALLY_TAGS.has(t))) return 0.70;
  if ([...combined].some((t) => VC_TAGS.has(t))) return 0.45;
  return 0.15;
}

// ---------------------------------------------------------------------------
// Interaction recency
// ---------------------------------------------------------------------------

function recencyToScore(daysAgo: number): number {
  if (daysAgo <= 30) return 1.0;
  if (daysAgo <= 90) return 1.0 - 0.25 * (daysAgo - 30) / (90 - 30);
  if (daysAgo <= 180) return 0.75 - 0.35 * (daysAgo - 90) / (180 - 90);
  if (daysAgo <= 365) return 0.40 - 0.25 * (daysAgo - 180) / (365 - 180);
  return 0.05;
}

function scoreInteractionRecency(contact: ScoringContact): number {
  const now = Date.now();

  const lastInteraction = contact.last_interaction_at;
  if (lastInteraction) {
    const ts = Date.parse(lastInteraction);
    if (!isNaN(ts)) {
      const daysAgo = (now - ts) / (1000 * 60 * 60 * 24);
      return recencyToScore(daysAgo);
    }
  }

  // Fallback to updatedAt, capped at 0.6
  const updatedAt = contact.updatedAt;
  if (updatedAt) {
    const ts = Date.parse(updatedAt);
    if (!isNaN(ts)) {
      const daysAgo = (now - ts) / (1000 * 60 * 60 * 24);
      return Math.min(recencyToScore(daysAgo), 0.6);
    }
  }

  return 0.1;
}

// ---------------------------------------------------------------------------
// Network proximity
// ---------------------------------------------------------------------------

const STRONG_RELATIONS = new Set(["ally", "champion", "advisor", "sponsor", "board_member"]);
const WARM_RELATIONS = new Set(["works_at", "colleague", "knows", "referred_by", "connected"]);

function scoreNetworkProximity(contact: ScoringContact): number {
  const edges = contact.edges ?? [];
  if (edges.length === 0) return 0.1;

  let maxScore = 0.0;
  for (const edge of edges) {
    const relation = (edge.relation ?? "").toLowerCase();
    const strength = edge.strength ?? 0;
    const targetTags = new Set((edge.target_tags ?? []).map((t) => t.toLowerCase()));

    if (STRONG_RELATIONS.has(relation)) {
      maxScore = Math.max(maxScore, Math.min(0.9 + strength * 0.1, 1.0));
    } else if (WARM_RELATIONS.has(relation)) {
      if ([...targetTags].some((t) => PROSPECT_TAGS.has(t))) {
        maxScore = Math.max(maxScore, 0.80 * (0.5 + strength * 0.5));
      } else {
        maxScore = Math.max(maxScore, 0.50 * (0.5 + strength * 0.5));
      }
    } else if ([...targetTags].some((t) => PROSPECT_TAGS.has(t))) {
      maxScore = Math.max(maxScore, 0.60);
    }
  }

  return maxScore > 0 ? maxScore : 0.10;
}

// ---------------------------------------------------------------------------
// Record completeness
// ---------------------------------------------------------------------------

function scoreRecordCompleteness(contact: ScoringContact): number {
  let score = 0.0;
  const meta: Record<string, string> = {};
  for (const m of contact.meta ?? []) {
    meta[m.key] = m.value;
  }

  if (meta["email"]) score += 0.35;
  if (meta["title"]) score += 0.25;

  const hasCompany =
    !!meta["company"] ||
    (contact.edges ?? []).some((e) => (e.relation ?? "").toLowerCase() === "works_at");
  if (hasCompany) score += 0.20;

  if (meta["linkedin_url"] || meta["url"] || meta["linkedin"]) score += 0.10;
  if ((contact.notes ?? "").trim()) score += 0.10;

  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scoreContact(contact: ScoringContact): ScoreResult {
  const factors = {
    titleRelevance: scoreTitleRelevance(contact),
    seniority: scoreSeniority(contact),
    orgType: scoreOrgType(contact),
    interactionRecency: scoreInteractionRecency(contact),
    networkProximity: scoreNetworkProximity(contact),
    recordCompleteness: scoreRecordCompleteness(contact),
  };

  const FACTOR_LABELS: Record<string, string> = {
    titleRelevance: "Title / Role Relevance",
    seniority: "Seniority",
    orgType: "Organization Type",
    interactionRecency: "Interaction Recency",
    networkProximity: "Network Proximity",
    recordCompleteness: "Record Completeness",
  };

  let weightedSum = 0;
  const breakdown: Record<string, FactorResult> = {};

  for (const [key, raw] of Object.entries(factors)) {
    const weight = WEIGHTS[key as keyof typeof WEIGHTS];
    const weighted = raw * weight;
    weightedSum += weighted;
    breakdown[key] = {
      raw: Math.round(raw * 1000) / 1000,
      weight,
      weighted: Math.round(weighted * 10000) / 10000,
      label: FACTOR_LABELS[key] ?? key,
    };
  }

  const score = Math.max(0, Math.min(100, Math.round(weightedSum * 100)));
  return { score, breakdown };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getMeta(contact: ScoringContact, key: string): string | undefined {
  return (contact.meta ?? []).find((m) => m.key === key)?.value;
}
