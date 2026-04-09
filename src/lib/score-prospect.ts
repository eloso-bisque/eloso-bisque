/**
 * Prospect (company) ICP scoring engine for Eloso CRM.
 *
 * Produces a 0–100 ICP score for each prospect org, indicating alignment with
 * Eloso's ideal customer profile: large North American manufacturers ($100M–$5B),
 * backlog accounting (ASC 606), aerospace/defense/heavy equipment/contract
 * manufacturing/capital goods, CSCO buyer persona.
 *
 * Five factors:
 *   1. verticalFit         (30%) — Vertical/industry alignment with ICP
 *   2. sizeFit             (25%) — Revenue band alignment
 *   3. supplyChainComplexity (20%) — Complexity of the supply chain
 *   4. buyerAccessibility  (15%) — Access to CSCO/VP Supply Chain contact
 *   5. warmIntroPath       (10%) — Path to a warm introduction
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProspectScoringEdge {
  relation: string;
  strength: number;
  target_tags?: string[];
  target_kind?: string;
}

export interface ScoringProspect {
  id?: string;
  name?: string;
  kind?: string;
  tags?: string[];
  notes?: string;
  /** Kissinger meta array */
  meta?: { key: string; value: string }[];
  updatedAt?: string;
  /** Edges from/to this entity */
  edges?: ProspectScoringEdge[];
  /**
   * People at this org (reverse works_at edges).
   * Used for buyerAccessibility scoring.
   */
  people?: { tags?: string[]; meta?: { key: string; value: string }[] }[];
}

export interface FactorResult {
  raw: number;
  weight: number;
  weighted: number;
  label: string;
}

export interface ProspectScoreResult {
  icp_score: number;
  breakdown: Record<string, FactorResult>;
}

// ---------------------------------------------------------------------------
// Weights — must sum to 1.0
// ---------------------------------------------------------------------------

const WEIGHTS = {
  verticalFit: 0.30,
  sizeFit: 0.25,
  supplyChainComplexity: 0.20,
  buyerAccessibility: 0.15,
  warmIntroPath: 0.10,
} as const;

// ---------------------------------------------------------------------------
// Vertical fit (30%)
//
// Tiers:
//   1.0  — aerospace, defense, heavy-equipment, contract manufacturing, capital goods
//   0.85 — rail, transportation equipment
//   0.75 — chemicals, specialty chemicals
//   0.6  — other industrial (general mfg, industrial equipment, metals, auto)
//   0.1  — unrelated
// ---------------------------------------------------------------------------

const VERTICAL_TIER_1 = new Set([
  "aerospace", "aerospace-defense", "aerospace_defense", "defense",
  "heavy-equipment", "heavy_equipment", "contract-manufacturing",
  "contract_manufacturing", "capital-goods", "capital_goods",
]);

const VERTICAL_TIER_1_PATTERNS = [
  /\baerospace\b/i,
  /\bdefense\b/i,
  /\bheavy.{0,5}equipment\b/i,
  /\bcontract.{0,5}mfg\b/i,
  /\bcontract.{0,5}manufactur/i,
  /\bcapital.{0,5}goods\b/i,
];

const VERTICAL_TIER_2 = new Set(["rail", "railroad", "railway", "transportation-equipment", "transportation_equipment"]);
const VERTICAL_TIER_2_PATTERNS = [/\brail(road|way)?\b/i, /\btransportation.{0,10}equipment\b/i];

const VERTICAL_TIER_3 = new Set(["chemicals", "chemical", "specialty-chemicals", "specialty_chemicals"]);
const VERTICAL_TIER_3_PATTERNS = [/\bchemical(s)?\b/i, /\bspecialty.{0,10}chem/i];

const VERTICAL_TIER_4 = new Set([
  "manufacturing", "industrial", "metals", "auto", "automotive",
  "industrial-equipment", "industrial_equipment", "electronics", "semiconductor",
  "energy", "oil-gas", "oil_gas",
]);
const VERTICAL_TIER_4_PATTERNS = [
  /\bmanufactur/i,
  /\bindustrial\b/i,
  /\bmetals?\b/i,
  /\bauto(motive)?\b/i,
  /\belectronics?\b/i,
  /\bsemiconductor\b/i,
];

function scoreVerticalFit(prospect: ScoringProspect): number {
  const tags = (prospect.tags ?? []).map((t) => t.toLowerCase());
  const industry = getMeta(prospect, "industry")?.toLowerCase() ?? "";
  const vertical = getMeta(prospect, "vertical")?.toLowerCase() ?? "";
  const notes = (prospect.notes ?? "").toLowerCase();
  const allText = `${industry} ${vertical} ${notes}`;

  // Check tags first (exact set membership)
  if (tags.some((t) => VERTICAL_TIER_1.has(t))) return 1.0;
  if (tags.some((t) => VERTICAL_TIER_2.has(t))) return 0.85;
  if (tags.some((t) => VERTICAL_TIER_3.has(t))) return 0.75;
  if (tags.some((t) => VERTICAL_TIER_4.has(t))) return 0.6;

  // Text pattern matching
  if (VERTICAL_TIER_1_PATTERNS.some((p) => p.test(allText))) return 1.0;
  if (VERTICAL_TIER_2_PATTERNS.some((p) => p.test(allText))) return 0.85;
  if (VERTICAL_TIER_3_PATTERNS.some((p) => p.test(allText))) return 0.75;
  if (VERTICAL_TIER_4_PATTERNS.some((p) => p.test(allText))) return 0.6;

  return 0.1;
}

// ---------------------------------------------------------------------------
// Size fit (25%)
//
// Tiers based on revenue meta (string like "$2B", "$500M", "$50M"):
//   1.0  — enterprise ($1B+)
//   0.85 — mid-market ($100M–$1B)
//   0.3  — SMB (<$100M or <100 employees with no revenue data)
//   0.5  — unknown (no signal)
// ---------------------------------------------------------------------------

/**
 * Parse a revenue string like "$2B", "$500M", "$1.2B", "2000000000" → dollars.
 * Returns null if unparseable.
 */
export function parseRevenue(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  // Billions
  const bMatch = cleaned.match(/^([\d.]+)[Bb]/);
  if (bMatch) return parseFloat(bMatch[1]) * 1e9;
  // Millions
  const mMatch = cleaned.match(/^([\d.]+)[Mm]/);
  if (mMatch) return parseFloat(mMatch[1]) * 1e6;
  // Thousands
  const kMatch = cleaned.match(/^([\d.]+)[Kk]/);
  if (kMatch) return parseFloat(kMatch[1]) * 1e3;
  // Plain number
  const num = parseFloat(cleaned);
  if (!isNaN(num) && num > 0) return num;
  return null;
}

function scoreSizeFit(prospect: ScoringProspect): number {
  const revenueRaw = getMeta(prospect, "revenue") ?? getMeta(prospect, "revenue_est") ?? "";
  const revenue = parseRevenue(revenueRaw);

  if (revenue !== null) {
    if (revenue >= 1e9) return 1.0;      // $1B+
    if (revenue >= 1e8) return 0.85;     // $100M–$1B
    return 0.3;                           // <$100M
  }

  // Fallback: check size-related tags
  const tags = (prospect.tags ?? []).map((t) => t.toLowerCase());
  if (tags.includes("enterprise") || tags.includes("large-enterprise")) return 1.0;
  if (tags.includes("mid-market") || tags.includes("midmarket")) return 0.85;
  if (tags.includes("smb") || tags.includes("small-business")) return 0.3;

  // Fallback: employees
  const empRaw = getMeta(prospect, "employees") ?? getMeta(prospect, "headcount") ?? "";
  const emp = parseInt(empRaw.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(emp) && emp > 0) {
    if (emp >= 5000) return 1.0;   // Large enterprise
    if (emp >= 500) return 0.85;   // Mid-market
    return 0.3;                     // SMB
  }

  return 0.5; // Unknown — give neutral score
}

// ---------------------------------------------------------------------------
// Supply chain complexity (20%)
//
// Determined by a tag, meta key "supply_chain_complexity", or fallback signal:
//   1.0  — complex (tag or meta = "complex")
//   0.7  — moderate (tag or meta = "moderate")
//   0.3  — simple (tag or meta = "simple")
//   0.5  — unknown (no signal)
// ---------------------------------------------------------------------------

function scoreSupplyChainComplexity(prospect: ScoringProspect): number {
  const tags = (prospect.tags ?? []).map((t) => t.toLowerCase());
  const complexityMeta = getMeta(prospect, "supply_chain_complexity")?.toLowerCase() ?? "";

  // Direct tag checks
  if (tags.includes("supply-chain-complex") || tags.includes("supply_chain_complex")) return 1.0;
  if (tags.includes("supply-chain-moderate") || tags.includes("supply_chain_moderate")) return 0.7;
  if (tags.includes("supply-chain-simple") || tags.includes("supply_chain_simple")) return 0.3;

  // Meta key check
  if (complexityMeta === "complex") return 1.0;
  if (complexityMeta === "moderate") return 0.7;
  if (complexityMeta === "simple") return 0.3;

  // Heuristic: verticals with known complex supply chains
  const isTier1Vertical = VERTICAL_TIER_1_PATTERNS.some((p) =>
    p.test(`${getMeta(prospect, "industry") ?? ""} ${(prospect.tags ?? []).join(" ")}`)
  );
  if (isTier1Vertical) return 1.0; // Aerospace/defense/heavy equip → complex by definition

  // Known supplier/customer connections (from edges or meta)
  const knownSuppliers = parseInt(getMeta(prospect, "known_suppliers") ?? "0", 10);
  const knownCustomers = parseInt(getMeta(prospect, "known_customers") ?? "0", 10);
  const total = knownSuppliers + knownCustomers;
  if (total >= 10) return 1.0;
  if (total >= 3) return 0.7;

  return 0.5; // Unknown
}

// ---------------------------------------------------------------------------
// Buyer accessibility (15%)
//
// Based on available contacts (people) at the org:
//   1.0  — has CSCO / VP Supply Chain contact in Kissinger
//   0.6  — has any contact at org
//   0.2  — no contacts
// ---------------------------------------------------------------------------

const BUYER_HIGH_PATTERNS = [
  /\bcsco\b/i,
  /\bchief supply chain\b/i,
  /\bvp.{0,10}supply chain\b/i,
  /\bvice president.{0,10}supply chain\b/i,
  /\bdirector.{0,10}supply chain\b/i,
  /\bhead of supply chain\b/i,
  /\bvp.{0,10}operations\b/i,
  /\bvice president.{0,10}operations\b/i,
];

function scoreBuyerAccessibility(prospect: ScoringProspect): number {
  const people = prospect.people ?? [];

  if (people.length === 0) return 0.2;

  for (const person of people) {
    const title = person.meta?.find((m) => m.key === "title")?.value ?? "";
    const personTags = (person.tags ?? []).join(" ");
    if (BUYER_HIGH_PATTERNS.some((p) => p.test(title) || p.test(personTags))) {
      return 1.0;
    }
  }

  // Has contacts but none are ideal buyer
  return 0.6;
}

// ---------------------------------------------------------------------------
// Warm intro path (10%)
//
//   1.0  — has warm_intro_path meta set
//   0.7  — team member connected (edge from team to this org, or "connected" tag)
//   0.1  — cold (no path)
// ---------------------------------------------------------------------------

function scoreWarmIntroPath(prospect: ScoringProspect): number {
  const warmPath = getMeta(prospect, "warm_intro_path") ?? "";
  if (warmPath.trim() !== "") return 1.0;

  // Edges: any relation indicating a warm connection
  const edges = prospect.edges ?? [];
  const warmEdgeRelations = new Set([
    "knows", "advises", "partnered_with", "connected", "referred_by",
    "ally", "champion", "sponsor",
  ]);
  const hasWarmEdge = edges.some((e) =>
    warmEdgeRelations.has((e.relation ?? "").toLowerCase())
  );
  if (hasWarmEdge) return 0.7;

  // Tags that suggest a warm path
  const tags = (prospect.tags ?? []).map((t) => t.toLowerCase());
  if (tags.includes("warm") || tags.includes("warm-intro") || tags.includes("team-connected")) return 0.7;

  return 0.1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const FACTOR_LABELS: Record<string, string> = {
  verticalFit: "Vertical Fit",
  sizeFit: "Size Fit",
  supplyChainComplexity: "Supply Chain Complexity",
  buyerAccessibility: "Buyer Accessibility",
  warmIntroPath: "Warm Intro Path",
};

export function scoreProspect(prospect: ScoringProspect): ProspectScoreResult {
  const factors = {
    verticalFit: scoreVerticalFit(prospect),
    sizeFit: scoreSizeFit(prospect),
    supplyChainComplexity: scoreSupplyChainComplexity(prospect),
    buyerAccessibility: scoreBuyerAccessibility(prospect),
    warmIntroPath: scoreWarmIntroPath(prospect),
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

  const icp_score = Math.max(0, Math.min(100, Math.round(weightedSum * 100)));
  return { icp_score, breakdown };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getMeta(prospect: ScoringProspect, key: string): string | undefined {
  return (prospect.meta ?? []).find((m) => m.key === key)?.value;
}
