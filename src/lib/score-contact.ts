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

// ---------------------------------------------------------------------------
// Investor fit scoring (BIS-331)
//
// Five investor-specific factors, summing to 1.0:
//   stageFit          (30%) — stage focus matches Eloso's current round (Seed/Series A)
//   thesisAlignment   (25%) — thesis matches supply chain / AI / enterprise
//   checkSizeFit      (20%) — check size in range for Eloso ($500K–$5M)
//   warmIntroPath     (15%) — we have a path in via network
//   portfolioOverlap  (10%) — portfolio validates the thesis
// ---------------------------------------------------------------------------

const INVESTOR_WEIGHTS = {
  stageFit: 0.30,
  thesisAlignment: 0.25,
  checkSizeFit: 0.20,
  warmIntroPath: 0.15,
  portfolioOverlap: 0.10,
} as const;

/** Tags that signal stage alignment with Eloso's Seed/Series-A target round */
const ELOSO_STAGE_TAGS = new Set(["seed", "pre-seed", "series-a", "series-b"]);

/** Tags that signal thesis alignment with Eloso's domain */
const THESIS_TAGS = new Set([
  "supply-chain", "logistics", "manufacturing", "industrial",
  "enterprise", "ai", "b2b", "saas", "deep-tech", "freight",
]);

/** Tags that signal portfolio overlap */
const PORTFOLIO_TAGS = new Set([
  "supply-chain", "logistics", "manufacturing", "industrial", "enterprise",
]);

function scoreInvestorStageFit(contact: ScoringContact): number {
  const tags = new Set((contact.tags ?? []).map((t) => t.toLowerCase()));
  const stageStr = getMeta(contact, "stage")?.toLowerCase() ?? "";

  // Direct tag match
  if ([...tags].some((t) => ELOSO_STAGE_TAGS.has(t))) return 1.0;

  // Meta stage field
  if (stageStr.includes("seed") || stageStr.includes("series a") || stageStr.includes("series-a")) return 1.0;
  if (stageStr.includes("series b") || stageStr.includes("series-b")) return 0.6;
  if (stageStr.includes("growth") || stageStr.includes("late")) return 0.2;

  // Generic venture fund — moderate fit
  if (tags.has("venture") || tags.has("vc")) return 0.5;

  return 0.1;
}

function scoreInvestorThesisAlignment(contact: ScoringContact): number {
  const tags = new Set((contact.tags ?? []).map((t) => t.toLowerCase()));
  const thesis = (getMeta(contact, "thesis") ?? "").toLowerCase();
  const sectorFit = (getMeta(contact, "sector_fit") ?? "").toLowerCase();
  const notes = (contact.notes ?? "").toLowerCase();
  const combined = `${thesis} ${sectorFit} ${notes}`;

  const tagMatches = [...tags].filter((t) => THESIS_TAGS.has(t)).length;
  if (tagMatches >= 3) return 1.0;
  if (tagMatches >= 2) return 0.8;
  if (tagMatches >= 1) return 0.6;

  // Text-based matches
  const textMatches = [
    "supply chain", "logistics", "manufacturing", "enterprise", "b2b",
    "ai", "artificial intelligence", "saas", "deep tech",
  ].filter((term) => combined.includes(term)).length;

  if (textMatches >= 3) return 0.9;
  if (textMatches >= 2) return 0.7;
  if (textMatches >= 1) return 0.5;

  // Generalist fund — modest alignment
  const sectorFitVal = getMeta(contact, "sector_fit") ?? "";
  if (sectorFitVal.includes("generalist")) return 0.4;

  return 0.1;
}

function scoreInvestorCheckSizeFit(contact: ScoringContact): number {
  const checkSize = getMeta(contact, "check_size") ?? "";
  if (!checkSize) return 0.4; // unknown — assume possible

  // Parse out the upper bound of the check size range
  // Format examples: "$500K–$3M", "$25K–$500K", "$1M–$5M", "$5M–$15M"
  const millions = checkSize.match(/\$?([\d.]+)M/g);
  const thousands = checkSize.match(/\$?([\d.]+)K/g);

  const maxM = millions
    ? Math.max(...millions.map((m) => parseFloat(m.replace(/[$M]/g, ""))))
    : 0;
  const minK = thousands
    ? Math.min(...thousands.map((k) => parseFloat(k.replace(/[$K]/g, ""))))
    : 0;
  const minM = minK > 0 ? minK / 1000 : (millions ? Math.min(...millions.map((m) => parseFloat(m.replace(/[$M]/g, "")))) : 0);

  // Eloso target: $500K–$5M range
  const ELOSO_MIN = 0.5; // $500K
  const ELOSO_MAX = 5.0; // $5M

  // If check size overlaps with Eloso's range — good fit
  if (maxM >= ELOSO_MIN && minM <= ELOSO_MAX) return 1.0;
  // Upper range is above Eloso's stage (too big)
  if (minM > ELOSO_MAX) return 0.2;
  // Very small checks only (accelerator-style)
  if (maxM > 0 && maxM < ELOSO_MIN) return 0.3;

  return 0.4;
}

function scoreInvestorWarmIntroPath(contact: ScoringContact): number {
  const warmPath = getMeta(contact, "warm_intro_path") ?? "";
  if (warmPath && warmPath !== "") return 1.0;

  // Edges-based: any strong connection signals a possible warm path
  const edges = contact.edges ?? [];
  const strongEdges = edges.filter((e) =>
    ["knows", "advises", "partnered_with"].includes(e.relation ?? "")
  );
  if (strongEdges.length >= 2) return 0.7;
  if (strongEdges.length >= 1) return 0.5;

  // Priority tag = someone has identified this as reachable
  const priority = (getMeta(contact, "priority") ?? "").toLowerCase();
  if (priority === "high") return 0.6;
  if (priority === "medium") return 0.4;

  return 0.1;
}

function scoreInvestorPortfolioOverlap(contact: ScoringContact): number {
  const tags = new Set((contact.tags ?? []).map((t) => t.toLowerCase()));
  const matches = [...tags].filter((t) => PORTFOLIO_TAGS.has(t)).length;

  if (matches >= 2) return 1.0;
  if (matches >= 1) return 0.6;
  return 0.2;
}

export interface InvestorScoringContact extends ScoringContact {
  /** Whether this contact is an investor (firm or person) */
  isInvestor?: boolean;
}

/**
 * Score an investor firm or person using investor-specific weights.
 * Use scoreContact() for regular contacts.
 */
export function scoreInvestor(contact: InvestorScoringContact): ScoreResult {
  const factors = {
    stageFit: scoreInvestorStageFit(contact),
    thesisAlignment: scoreInvestorThesisAlignment(contact),
    checkSizeFit: scoreInvestorCheckSizeFit(contact),
    warmIntroPath: scoreInvestorWarmIntroPath(contact),
    portfolioOverlap: scoreInvestorPortfolioOverlap(contact),
  };

  const FACTOR_LABELS: Record<string, string> = {
    stageFit: "Stage Fit",
    thesisAlignment: "Thesis Alignment",
    checkSizeFit: "Check Size Fit",
    warmIntroPath: "Warm Intro Path",
    portfolioOverlap: "Portfolio Overlap",
  };

  let weightedSum = 0;
  const breakdown: Record<string, FactorResult> = {};

  for (const [key, raw] of Object.entries(factors)) {
    const weight = INVESTOR_WEIGHTS[key as keyof typeof INVESTOR_WEIGHTS];
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
