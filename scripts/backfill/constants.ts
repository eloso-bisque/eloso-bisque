/**
 * Constants and lookup tables for the Kissinger -> Postgres backfill.
 *
 * These encode the mapping decisions documented in docs/prisma-schema-design.md
 * sections 4.2/4.3, plus a handful of judgment calls made after inspecting the
 * *real* production Kissinger data (see PR description for #41 for the full
 * rationale on each deviation from the design doc's literal examples).
 */

// ---------------------------------------------------------------------------
// Users (step 1 of the issue) — ids match the `usr_<name>` convention so
// later dual-write code can reference stable user ids. Email/name pulled
// from scripts/seed-users.ts.
// ---------------------------------------------------------------------------

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  /** Message angle assigned to this user for outreach generation (see User.messageAngle). */
  messageAngle: "vision" | "technical" | "strategic";
}

export const SEED_USERS: SeedUser[] = [
  { id: "usr_ben", email: "ben@eloso.ai", name: "Ben Roome", messageAngle: "vision" },
  { id: "usr_jake", email: "jake@eloso.ai", name: "Jake Metcalf", messageAngle: "strategic" },
  { id: "usr_drew", email: "drew@eloso.ai", name: "Drew Winget", messageAngle: "technical" },
];

/** queue:<name> tag suffix -> seed user id. Only these three names are recognized. */
export const QUEUE_TAG_TO_USER_ID: Record<string, string> = {
  ben: "usr_ben",
  jake: "usr_jake",
  drew: "usr_drew",
};

/** outreach_message_sender meta value -> MessageAngle, mirrors QUEUE_TAG_TO_USER_ID. */
export const SENDER_TO_ANGLE: Record<string, "vision" | "technical" | "strategic"> = {
  ben: "vision",
  jake: "strategic",
  drew: "technical",
};

// ---------------------------------------------------------------------------
// Enum value sets (mirrors prisma/schema.prisma — kept here rather than
// importing from @prisma/client so mapper unit tests stay decoupled from a
// generated client / live DB connection).
// ---------------------------------------------------------------------------

export const OUTREACH_STAGES = ["cold", "touched_1", "touched_2", "touched_3", "responded"] as const;
export type OutreachStageValue = (typeof OUTREACH_STAGES)[number];

/**
 * Judgment call: real Kissinger data uses "new" for the initial stage, not
 * "cold" (the schema's default/first enum value). Treated as a direct alias.
 */
export const OUTREACH_STAGE_ALIASES: Record<string, OutreachStageValue> = {
  new: "cold",
};

export const FUNNEL_STAGES = [
  "Identified",
  "Researched",
  "Contacted",
  "Engaged",
  "MeetingBooked",
  "ProposalSent",
  "ClosedNurture",
] as const;
export type FunnelStageValue = (typeof FUNNEL_STAGES)[number];

export const INVESTOR_PIPELINE_STAGES = [
  "Research",
  "WarmIntro",
  "FirstMeeting",
  "PartnerMeeting",
  "TermSheet",
  "Closed",
  "Passed",
] as const;
export type InvestorPipelineStageValue = (typeof INVESTOR_PIPELINE_STAGES)[number];

export const FIT_TIERS = ["high", "medium", "low"] as const;
export type FitTierValue = (typeof FIT_TIERS)[number];

export const CONTACT_EVENT_KINDS = ["Note", "Meeting", "Email", "Call", "Custom"] as const;
export type ContactEventKindValue = (typeof CONTACT_EVENT_KINDS)[number];

/**
 * RelationType enum values actually defined in prisma/schema.prisma.
 *
 * Judgment call: the real Kissinger graph also contains edges of type
 * `buys_from`, `contract_mfg_for`, `may_know`, and `supplies_to` (confirmed
 * via graphStats.edgesByType against the live instance) that have NO
 * corresponding Postgres enum value. Postgres will reject any insert with a
 * value outside the enum, so these edges are skipped (not force-mapped to a
 * lookalike value) and counted/logged instead. See PR description.
 */
export const RELATION_TYPES = [
  "works_at",
  "knows",
  "funded_by",
  "part_of",
  "works_on",
  "ally",
  "champion",
  "advisor",
  "sponsor",
  "board_member",
  "referred_by",
] as const;
export type RelationTypeValue = (typeof RELATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Tags with an explicit, structured destination (section 4.3 of the design
// doc, plus real-data-informed additions noted below). Any tag NOT listed
// here (and not a queue:/vertical: prefixed tag) falls through to a plain
// ContactTag/OrganizationTag row.
// ---------------------------------------------------------------------------

export const ORG_PROSPECT_TAG = "prospect";
export const ORG_VC_TAGS = ["vc", "investor"];
export const PERSON_PROSPECT_CONTACT_TAG = "prospect-contact";
/**
 * GH #45 correction: a prior pass here used only "investor" (not "vc"),
 * reasoning that "vc" was too broad/ambiguous a signal for a person. Real
 * prod data contradicts that: Kissinger's own live classification —
 * `INVESTOR_PERSON_TAGS = new Set(["vc", "investor"])` in src/lib/
 * kissinger.ts, used by `isInvestorPerson()` and the Contacts-page investor
 * exclusion filter everywhere the app has run in production — already
 * treats "vc" as sufficient on its own. Auditing the live Kissinger graph
 * during the #45 parity check found 65 person entities tagged "vc" without
 * "investor" (Hunter Walk, Mark Mullen, Jonathan Lehr, etc. — all
 * unambiguous VC partners/founders), 32 of which never set
 * isInvestorContact=true under the old single-tag check: a 32/65 (49%)
 * false-negative rate. This mirrors the org-side mapping (`vc`,`investor`
 * -> isVcFirm, ORG_VC_TAGS above) instead of diverging from it.
 */
export const PERSON_INVESTOR_TAGS = ["vc", "investor"];
export const OUTREACH_SENT_TAG = "outreach-sent";
export const FIT_TAG_PREFIX = "fit-";
export const VERTICAL_TAG_PREFIX = "vertical:";
export const QUEUE_TAG_PREFIX = "queue:";
