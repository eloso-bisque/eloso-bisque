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
 * - Ben (founder/vision): leads with defense & frontier tech
 * - Jake (technical/product): leads with enterprise tech & robotics
 * - Drew (strategic/business): leads with industrial & rail
 *
 * Unrecognized sectors fall through to round-robin.
 */
const SECTOR_PREFERENCE: Record<string, TeamMember> = {
  "defense": "Ben",
  "defense-aerospace": "Ben",
  "evtol": "Ben",
  "machine-vision": "Jake",
  "enterprise-tech": "Jake",
  "robotics": "Jake",
  "ev-battery": "Jake",
  "rail-transportation-equipment": "Drew",
  "building-products-construction": "Drew",
  "industrial-specialty-manufacturing": "Drew",
  "fluid-control-water-tech": "Drew",
  "specialty-chemicals-materials": "Drew",
};

/**
 * Assign a contact to a team member.
 *
 * Priority:
 * 1. First sector tag that has a preference mapping
 * 2. Round-robin by index (fallback)
 */
export function assignContact(
  contact: ProspectContact,
  index: number
): TeamMember {
  for (const tag of contact.sector) {
    const pref = SECTOR_PREFERENCE[tag];
    if (pref) return pref;
  }
  // Round-robin fallback
  return TEAM_MEMBERS[index % TEAM_MEMBERS.length];
}

/**
 * Distribute a list of contacts across Ben, Jake, and Drew.
 * Returns a map from TeamMember → OutreachTask[].
 */
export function distributeContacts(contacts: ProspectContact[]): Record<TeamMember, OutreachTask[]> {
  const result: Record<TeamMember, OutreachTask[]> = {
    Ben: [],
    Jake: [],
    Drew: [],
  };

  contacts.forEach((contact, i) => {
    const assignee = assignContact(contact, i);
    result[assignee].push({
      id: `${contact.id}-${assignee}`,
      contact,
      assignee,
      generatedAt: new Date().toISOString(),
    });
  });

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
    angle: "technical",
    intro: "I'm Jake, co-founder of Eloso Intelligence.",
  },
  Drew: {
    angle: "strategic",
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

  const firstName = contact.name.split(" ")[0];
  const companyShort = contact.company.replace(/\s*\(.*?\)\s*/g, "").trim();

  // Role-aware opener
  let roleOpener: string;
  const titleLower = contact.title.toLowerCase();
  if (titleLower.includes("ceo") || titleLower.includes("founder") || titleLower.includes("president")) {
    roleOpener = `I've been following ${companyShort}'s trajectory and wanted to reach out directly to you as the person shaping its direction.`;
  } else if (titleLower.includes("cfo") || titleLower.includes("finance")) {
    roleOpener = `Given your vantage point on ${companyShort}'s financial operations, I thought you might find what we're building relevant.`;
  } else if (titleLower.includes("coo") || titleLower.includes("operations")) {
    roleOpener = `With ${companyShort}'s operational scale, I thought our work on supply chain intelligence might be worth a quick look.`;
  } else {
    roleOpener = `I've been looking at companies like ${companyShort} that are doing interesting things in your space and wanted to connect.`;
  }

  // Sector-aware hook
  let sectorHook = "";
  if (contact.sector.some((s) => s.includes("defense"))) {
    sectorHook = " Defense-sector supply chains face unique challenges around backlog depth and component lead times — exactly the problem we're built for.";
  } else if (contact.sector.includes("evtol") || contact.sector.includes("ev-battery")) {
    sectorHook = " The supply chain complexity for next-gen mobility is intense — long component lead times, strict quality requirements, and huge backlog pressure.";
  } else if (contact.sector.includes("rail-transportation-equipment")) {
    sectorHook = " Rail equipment manufacturing is a great example of where backlog-to-revenue gap creates real pain at scale.";
  } else if (contact.sector.includes("robotics") || contact.sector.includes("machine-vision") || contact.sector.includes("enterprise-tech")) {
    sectorHook = " Enterprise tech supply chains — especially at the hardware-software interface — are where demand planning inaccuracies hit hardest.";
  }

  const message = [
    `Hi ${firstName} — ${ctx.intro}`,
    `${roleOpener}${sectorHook}`,
    props[0],
    `Would love to share what we're working on — even a 20-minute call would be valuable. Open to connecting?`,
  ].join(" ");

  return {
    task,
    message,
    angle: ctx.angle,
  };
}
