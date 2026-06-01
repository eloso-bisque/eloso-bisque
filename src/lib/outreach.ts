/**
 * Outreach Task Engine — core logic.
 *
 * Handles contact assignment across Ben / Jake / Drew and
 * LinkedIn message template generation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamMember = "Ben" | "Jake" | "Drew";

export const TEAM_MEMBERS: TeamMember[] = ["Ben", "Jake", "Drew"];

/** Outreach cadence stage for a prospect contact. */
export type OutreachStage = "cold" | "touched_1" | "touched_2" | "touched_3" | "responded";

export interface ProspectContact {
  id: string;
  name: string;
  title: string;
  company: string;
  /** Sector tags from the org, e.g. "defense", "evtol", "ev-battery" */
  sector: string[];
  /** Fit tier: "high" | "medium" | "low" */
  fitTier: "high" | "medium" | "low";
  /** Notes field from Kissinger */
  notes?: string;
  /** Current outreach cadence stage */
  outreachStage?: OutreachStage;
  /** LinkedIn profile URL */
  linkedinUrl?: string;
  /** Previously generated + stored outreach message */
  outreachMessage?: string;
  /** ISO timestamp when the stored message was generated */
  outreachMessageGeneratedAt?: string;
  /** Sender variant used for the stored message ("drew", "jake", "ben") */
  outreachMessageSender?: string;
  /** Signal fields from Kissinger entity meta (populated by Trigify daily sync) */
  lastSignalDate?: string;
  signalDismissed?: boolean;
  signalSnoozedUntil?: string;
  lastSignalKeyword?: string;
  /** URL of the specific LinkedIn post that triggered the signal */
  lastSignalUrl?: string;
  /** True if the contact has a warm intro path (from kissinger introPath query) */
  hasIntroPath?: boolean;
  /**
   * The team member this contact is/was queued for (extracted from queue:* tag).
   * Lowercase: "ben", "drew", "jake", or undefined.
   * Used by the Sent tab to attribute contacts that have no outreachMessageSender.
   */
  queueOwner?: string;
}

export interface OutreachTask {
  id: string;
  contact: ProspectContact;
  assignee: TeamMember;
  /** ISO 8601 timestamp when this task was generated */
  generatedAt: string;
}

export interface GeneratedMessage {
  task: OutreachTask;
  message: string;
  /** Which angle was used: "vision" | "technical" | "strategic" */
  angle: "vision" | "technical" | "strategic";
}

// ---------------------------------------------------------------------------
// Assignment logic
// ---------------------------------------------------------------------------

/**
 * Map from sector tag to preferred assignee.
 * This gives each person a natural angle into their domain:
 *
 * Ben (CEO, Vision): "why now", market timing, big picture
 *   → defense, eVTOL/advanced air, emerging/frontier sectors, founder-level contacts
 *
 * Drew (CTO, ONLY technical founder): how it works, implementation, integration
 *   → robotics, machine-vision, enterprise-tech, ev-battery, software-heavy manufacturing
 *
 * Jake (COO/CFO/President, PhD Ethics of AI): strategic/business outcomes, governance, ROI
 *   → rail, heavy equipment, defense/A&D operations, capital goods, industrial
 *
 * Unrecognized sectors fall through to round-robin.
 */
const SECTOR_PREFERENCE: Record<string, TeamMember> = {
  // Ben — vision / "why now" / frontier tech
  "defense": "Ben",
  "defense-aerospace": "Ben",
  "evtol": "Ben",
  "advanced-air-mobility": "Ben",

  // Drew — technical implementation (ONLY technical founder)
  "machine-vision": "Drew",
  "enterprise-tech": "Drew",
  "robotics": "Drew",
  "ev-battery": "Drew",
  "software-manufacturing": "Drew",
  "semiconductor": "Drew",
  "medtech": "Drew",

  // Jake — strategic / business outcomes / governance / ROI
  "rail-transportation-equipment": "Jake",
  "building-products-construction": "Jake",
  "industrial-specialty-manufacturing": "Jake",
  "fluid-control-water-tech": "Jake",
  "specialty-chemicals-materials": "Jake",
  "heavy-equipment": "Jake",
  "capital-goods": "Jake",
  "contract-manufacturing": "Jake",
  "aerospace-commercial": "Jake",
};

/**
 * Assign a contact to a team member.
 *
 * Priority:
 * 1. First sector tag that has a preference mapping
 * 2. Round-robin by fallbackIndex (fallback — only counts unclassified contacts)
 *
 * NOTE: This function is intentionally kept pure for testing. The caller
 * (`distributeContacts`) is responsible for tracking the fallback counter so
 * that the round-robin is correct across only the unclassified contacts.
 */
export function assignContact(
  contact: ProspectContact,
  fallbackIndex: number
): TeamMember {
  for (const tag of contact.sector) {
    const pref = SECTOR_PREFERENCE[tag];
    if (pref) return pref;
  }
  // Round-robin fallback — index must count only unclassified contacts
  return TEAM_MEMBERS[fallbackIndex % TEAM_MEMBERS.length];
}

/**
 * Distribute a list of contacts across Ben, Jake, and Drew.
 *
 * Each contact is assigned to EXACTLY ONE team member — no contact ID can
 * appear in more than one bucket. This is a strict partition.
 *
 * Assignment priority:
 * 1. Explicit sender: if outreachMessageSender is already set (case-insensitive),
 *    honour it — the contact was previously claimed by that team member.
 * 2. Sector affinity (first matching tag in SECTOR_PREFERENCE wins)
 * 3. Round-robin across team members (fallback for unclassified contacts)
 *
 * Honouring the explicit sender means that contacts added by the queue
 * replenishment job (which sets no sender) are evenly distributed via
 * round-robin, while contacts already in someone's pipeline stay there.
 *
 * The round-robin fallback counter increments only for contacts with no
 * explicit sender and no sector preference match, ensuring even distribution.
 *
 * Returns a map from TeamMember → OutreachTask[].
 */
export function distributeContacts(contacts: ProspectContact[]): Record<TeamMember, OutreachTask[]> {
  const result: Record<TeamMember, OutreachTask[]> = {
    Ben: [],
    Jake: [],
    Drew: [],
  };

  // Separate fallback counter — only increments for contacts with no explicit
  // sender and no sector preference match, ensuring true round-robin across
  // the unassigned pool.
  let fallbackCounter = 0;

  const now = new Date().toISOString();

  // Build a case-insensitive lookup for TEAM_MEMBERS
  const memberByLower: Record<string, TeamMember> = {};
  for (const m of TEAM_MEMBERS) {
    memberByLower[m.toLowerCase()] = m;
  }

  for (const contact of contacts) {
    // Priority 1: respect an explicit sender already stored on the contact.
    // This ensures contacts previously claimed by a team member stay in their queue.
    const explicitSender = contact.outreachMessageSender?.toLowerCase();
    const explicitAssignee = explicitSender ? memberByLower[explicitSender] : undefined;
    if (explicitAssignee) {
      result[explicitAssignee].push({
        id: `${contact.id}-${explicitAssignee}`,
        contact,
        assignee: explicitAssignee,
        generatedAt: now,
      });
      continue;
    }

    // Priority 2: sector affinity
    let sectorAssignee: TeamMember | null = null;
    for (const tag of contact.sector) {
      const pref = SECTOR_PREFERENCE[tag];
      if (pref) {
        sectorAssignee = pref;
        break;
      }
    }

    let assignee: TeamMember;
    if (sectorAssignee !== null) {
      assignee = sectorAssignee;
    } else {
      // Priority 3: round-robin across unassigned/unclassified contacts
      assignee = TEAM_MEMBERS[fallbackCounter % TEAM_MEMBERS.length];
      fallbackCounter += 1;
    }

    result[assignee].push({
      id: `${contact.id}-${assignee}`,
      contact,
      assignee,
      generatedAt: now,
    });
  }

  // Sanity check (dev only): assert no contact ID appears in more than one bucket.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Map<string, TeamMember>();
    for (const member of TEAM_MEMBERS) {
      for (const task of result[member]) {
        const prior = seen.get(task.contact.id);
        if (prior !== undefined) {
          throw new Error(
            `[distributeContacts] Contact "${task.contact.id}" (${task.contact.name}) ` +
            `assigned to both ${prior} and ${member}. Distribution is not a strict partition.`
          );
        }
        seen.set(task.contact.id, member);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

/**
 * The Eloso value proposition anchors for each sender angle.
 * Kept short — these go into 3–5 sentence LinkedIn messages.
 */
const VALUE_PROPS = {
  vision: [
    "Eloso is building AI-driven supply chain planning that finally makes the CSCO a strategic powerhouse rather than a cost center.",
    "We optimize for supplier and customer relationship stability — win-win demand planning vs. the zero-sum agent approach everyone else is chasing.",
    "Our early focus is manufacturers using backlog-to-revenue accounting, where closing the gap between receipt and revenue is the clearest dollar-for-dollar win.",
  ],
  technical: [
    "Eloso is an AI supply chain planning platform purpose-built around the CSCO's actual pain: data silos, misaligned KPIs, and demand plans that don't survive contact with suppliers.",
    "Our approach is relationship-quality optimization — we model supplier and customer stability, not just speed or marginal cost savings.",
    "We're targeting manufacturers with backlog-to-revenue accounting (ASC 606), where reducing the time between component receipt and revenue recognition is a concrete, measurable win.",
  ],
  strategic: [
    "Eloso is an AI-driven supply chain intelligence platform helping CSCOs shift from cost-center perception to strategic growth drivers.",
    "We're building around the insight that demand planning works better when you optimize for stable, win-win supplier and customer relationships — not just throughput.",
    "Our initial target is manufacturers on backlog accounting where the ROI on accurate demand planning is clearest and most quantifiable.",
  ],
};

const SENDER_CONTEXT: Record<TeamMember, { angle: "vision" | "technical" | "strategic"; intro: string }> = {
  Ben: {
    angle: "vision",
    intro: "I'm Ben, co-founder of Eloso Intelligence.",
  },
  Jake: {
    angle: "strategic",
    intro: "I'm Jake, co-founder of Eloso Intelligence.",
  },
  Drew: {
    angle: "technical",
    intro: "I'm Drew, co-founder of Eloso Intelligence.",
  },
};

/**
 * Generate a LinkedIn outreach message for a given task.
 *
 * The message is 3–5 sentences:
 * 1. Personal intro (sender context)
 * 2. Why reaching out to this specific person (role/company-aware)
 * 3. The Eloso value prop (angle-appropriate)
 * 4. Soft call to action
 */
export function generateMessage(task: OutreachTask): GeneratedMessage {
  const { contact, assignee } = task;
  const ctx = SENDER_CONTEXT[assignee];
  const props = VALUE_PROPS[ctx.angle];

  const firstName = contact.name?.trim().split(" ")[0] || "there";
  const companyShort = (contact.company || "").replace(/\s*\(.*?\)\s*/g, "").trim();
  const hasCompany = companyShort.length > 0;

  // Role-aware opener — guard against blank company name
  let roleOpener: string;
  const titleLower = (contact.title || "").toLowerCase();
  if (titleLower.includes("ceo") || titleLower.includes("founder") || titleLower.includes("president")) {
    roleOpener = hasCompany
      ? `I've been following what ${companyShort} is doing and wanted to reach out directly.`
      : `I came across your profile and wanted to reach out directly.`;
  } else if (titleLower.includes("cfo") || titleLower.includes("finance")) {
    roleOpener = hasCompany
      ? `Your vantage point on ${companyShort}'s financials is exactly why I'm reaching out.`
      : `Your finance perspective is exactly why I'm reaching out.`;
  } else if (titleLower.includes("coo") || titleLower.includes("operations")) {
    roleOpener = hasCompany
      ? `Given what you're managing at ${companyShort}, I think what we're building is directly in your wheelhouse.`
      : `Given what you're managing in operations, I think what we're building is directly in your wheelhouse.`;
  } else {
    roleOpener = hasCompany
      ? `I've been looking at what ${companyShort} is doing and think there's a real connection to what we're working on.`
      : `I came across your profile and think there's a real connection to what we're working on.`;
  }

  // Sector-aware hook with specific pain point and problem hypothesis
  let sectorHook = "";
  if (contact.sector.some((s) => s.includes("defense"))) {
    sectorHook = " Defense supply chains break when programs slip — demand plans that assumed a delivery date are suddenly wrong by months, and the backlog depth hides it until it's too late.";
  } else if (contact.sector.includes("evtol")) {
    sectorHook = " eVTOL production ramps are brutal — component lead times built for aerospace volumes don't match the pace your program needs, and that gap shows up in the backlog before it shows up in the P&L.";
  } else if (contact.sector.includes("ev-battery")) {
    sectorHook = " EV supply chains have a unique problem: battery cell lead times are long, specs change fast, and demand plans are obsolete before they're published.";
  } else if (contact.sector.includes("rail-transportation-equipment")) {
    sectorHook = " Rail equipment backlogs are long and the revenue recognition gap is real — components arriving months before the car ships means cash tied up with no revenue signal.";
  } else if (contact.sector.includes("robotics") || contact.sector.includes("machine-vision")) {
    sectorHook = " Robotics hardware BOMs are a demand planning nightmare — hardware lead times are 16-20 weeks, software releases ship on 2-week cycles, and the mismatch creates constant expediting costs.";
  } else if (contact.sector.includes("enterprise-tech")) {
    sectorHook = " Hardware-software supply chains are where demand planning inaccuracies hit hardest — one silicon shortage can stall an entire software release cycle.";
  }

  const message = [
    `Hi ${firstName} — ${ctx.intro}`,
    `${roleOpener}${sectorHook}`,
    props[0],
    `Would love to pick your brain for 20 minutes if you're open to it.`,
  ].join(" ");

  return {
    task,
    message,
    angle: ctx.angle,
  };
}

// ---------------------------------------------------------------------------
// Signal scoring utilities
// ---------------------------------------------------------------------------

/**
 * Returns the number of days elapsed since a date string (ISO), or Infinity if
 * null/undefined/unparseable.
 */
export function daysSince(dateStr: string | undefined | null): number {
  if (!dateStr) return Infinity;
  const ts = Date.parse(dateStr);
  if (isNaN(ts)) return Infinity;
  return (Date.now() - ts) / (1000 * 60 * 60 * 24);
}

/**
 * Returns true if the contact has a LinkedIn signal within the last 3 days.
 */
export function isHotSignal(contact: Pick<ProspectContact, "lastSignalDate">): boolean {
  return daysSince(contact.lastSignalDate) <= 3;
}

/**
 * Returns true if the contact has a LinkedIn signal within the last 14 days.
 */
export function isWarmSignal(contact: Pick<ProspectContact, "lastSignalDate">): boolean {
  return daysSince(contact.lastSignalDate) <= 14;
}

/**
 * Returns true if the contact's signal snooze period has not yet expired.
 */
export function isSignalSnoozed(contact: Pick<ProspectContact, "signalSnoozedUntil">): boolean {
  if (!contact.signalSnoozedUntil) return false;
  return new Date(contact.signalSnoozedUntil) > new Date();
}

/** Returns true if the title suggests a senior/executive role. */
function isSenior(title: string): boolean {
  const t = title.toLowerCase();
  return ["ceo", "cto", "cfo", "coo", "president", "founder", "vp", "vice president", "director", "head of"].some(
    (s) => t.includes(s)
  );
}

/**
 * Compute a priority score for a contact in the Signals tab.
 * Higher score = more urgent to reach out.
 *
 * Formula:
 *   recency (0–100) + fit tier (5/15/30) + intro path bonus (15) + seniority (10)
 */
export function computeSignalScore(contact: ProspectContact): number {
  const ageDays = daysSince(contact.lastSignalDate);
  const recency =
    ageDays <= 1 ? 100 :
    ageDays <= 3 ? 80 :
    ageDays <= 7 ? 60 :
    ageDays <= 14 ? 40 : 0;
  const fit = contact.fitTier === "high" ? 30 : contact.fitTier === "medium" ? 15 : 5;
  const hasIntroPath = contact.hasIntroPath ? 15 : 0;
  const senior = isSenior(contact.title ?? "") ? 10 : 0;
  return recency + fit + hasIntroPath + senior;
}
