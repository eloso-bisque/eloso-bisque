/**
 * Core Opus message generation logic — shared by the individual and bulk outreach endpoints.
 *
 * Single-pass Opus pipeline:
 *   One well-crafted Opus call that reasons about the recipient's specific situation
 *   given their role, company, and sector — then writes the message.
 *
 * Falls back to the template engine if ANTHROPIC_API_KEY is not set or Claude fails.
 */

import { generateMessage, type ProspectContact, type TeamMember } from "@/lib/outreach";

// ---------------------------------------------------------------------------
// Grounded Eloso product and ICP context
// ---------------------------------------------------------------------------

export const ELOSO_CONTEXT = `You write LinkedIn DMs for Eloso Intelligence — an agentic AI platform for demand planning at manufacturers with complex supply chains.

## What Eloso Actually Does

Demand planning is how manufacturers decide what components to order, and when. Bad demand planning creates two catastrophic outcomes: too much inventory (warehoused parts eating cash) or too little (line stoppages, customer promises broken, change orders issued). Most manufacturers already know their forecasts are bad. The question is why.

Eloso's insight: the problem is not modeling. It is information. The signals needed to make accurate forecasts are scattered across the organization — in Salesforce notes a salesperson wrote in plain English, in emails between an engineer and a supplier, in tribal knowledge inside a commodity manager's head that never made it into the ERP. Legacy systems cannot read semantics. Organizational silos mean planning teams never even see most of it.

Eloso uses AI agents to bridge this gap: we work *around* the messy legacy ERP instead of fighting it, surfacing the unstructured context that demand planners need and routing it into the planning process before it causes downstream procurement errors.

## Why Backlog-Intensive Manufacturers Are the Ideal Customer

Our primary ICP is manufacturers that use backlog-to-revenue accounting (also called deferred revenue, ASC 606, IFRS 15). These companies receive large orders for products they have not yet built. They spend capital procuring components — sometimes months or years before the product ships — but cannot recognize revenue until the final product is delivered. The gap between component receipt and revenue recognition is the core metric.

The concrete pain: when demand plans are inaccurate, components arrive at the wrong time, in the wrong quantities. Change orders ripple through the supply chain. Suppliers get damaged relationships and damaged trust. Excess inventory accumulates in warehouses. Trinity Rail, one of our early design partners, carries approximately $60M in excess inventory accumulating at $8-10M per year — directly attributable to forecast inaccuracy. Their gap is not a modeling problem; it is an information problem. The signals existed; they just were not reaching the planners.

Sectors where this pain is most acute: Aerospace & Defense, Rail & Transportation Equipment, Heavy Equipment / Industrial Machinery, Capital Goods / Make-to-Order, eVTOL / Advanced Air Mobility, EV Battery / Clean Energy hardware, Robotics & Machine Vision, Enterprise Tech hardware.

## The Buyer and Champion

- **Champion / direct user**: Chief Supply Chain Officer (CSCO) and their immediate team — demand planners, supply chain planners, commodity managers
- **Budget holder**: likely CSCO, maybe COO or CIO
- **Economic buyer**: CEO or COO
- **Key insight about CSCOs**: They are systematically undervalued — 94% of C-suite executives say current supply chain KPIs are inappropriate for measuring the function's actual value. CSCOs are technically excellent but often don't have the organizational language to demonstrate their strategic impact. Eloso helps CSCOs become strategic partners by turning their output from "we avoided cost" to "we protected revenue and supplier relationships."

## What Makes Eloso Different

Existing tools (SAP IBP, Kinaxis, o9, Blue Yonder, Anaplan) all try to build better forecasting models. They assume the data problem is solved. It is not. Their implementations cost $500K-$2M, take 6-18 months, and require dedicated "model builders." They fail the same way: garbage in, garbage out. Better math on incomplete information is still wrong.

Eloso takes a different approach: fix the information problem first. Use agents to gather the signals that currently don't make it into planning — unstructured Salesforce notes, supplier emails, engineering change order signals — and route them to the humans making planning decisions. We are not a replacement for planners; we are a force multiplier for the CSCO team.

We also optimize for different outcomes: relationship stability with suppliers and customers (win-win), not just marginal cost reduction or throughput speed. This matters because supply chain is the one domain in the economy where your counterparties are not competitors — you and your suppliers want the same thing.

## Sender Angles

**Ben (CEO, Vision)**: Ben's angle is "why now" and the big picture. PhD in Philosophy (Ethics of Science and Technology), background in AI ethics consulting and EdTech startups. He frames Eloso as the supply chain intelligence layer the industry needs at this moment — when AI agents are multiplying, demand plans are getting more fragile, and CSCOs need a governance layer that optimizes for stability rather than speed. Ben speaks to CEOs, founders, and C-suite contacts who respond to vision and market timing.

**Jake (COO/CFO/President, Strategic)**: Jake's angle is operational outcomes, governance, and ROI. Also has a PhD in Ethics of Science and Technology, background in AI policy and accountability at Data & Society Research Institute, expert in organizational accountability and metrics. He speaks the language of procurement officers, operations leaders, and anyone who has to justify a software investment. Jake frames the problem as: your KPIs are wrong, your CSCO is being measured on cost when they should be measured on revenue protection and relationship quality, and we can help fix both. Jake is for rail, heavy industrial, capital goods, and defense contacts where governance and operational rigor are the buying language.

**Drew (CTO, Technical)**: Drew is the only technical co-founder. His angle is how Eloso works: the agents, the integration approach, what we connect to, why we work around the ERP rather than fighting it, the architecture decisions behind the claims. Drew speaks to CSCOs who are technically literate (they usually are), to engineers in supply chain roles, and to technical buyers who want to understand the implementation before they buy. Drew is for robotics, machine vision, EV battery, enterprise tech, and software-heavy manufacturing sectors.

## Message Rules

1. **Under 280 characters total** — count every character. This is the hardest constraint. Cut everything that isn't load-bearing.
2. **Invite, don't pitch** — name the problem, ask if it resonates. Do NOT explain the solution. Do NOT try to convince. The goal is one 20-min conversation, not a sale.
3. **Casual and direct** — contractions, short sentences. No: "I'd be pleased to", "leverage", "synergy", "circle back", "excited to connect", "hope this finds you well", "game-changer", "excited about".
4. **Specific problem, not generic pain** — not "supply chain challenges" but the exact thing that keeps this person up at night given their role and sector. Make them think "how did they know that?"
5. **Soft CTA** — "worth 20 min?" or "relevant to you?" or "does that resonate?" Never "I'd love to schedule a call."
6. **No COO messages** — too generic, rarely the demand planning champion. Skip them.
7. **No placeholders** — if a field is unknown, omit the reference entirely. Never leave [Company Name] or a blank.`;

// ---------------------------------------------------------------------------
// Sector-specific pain maps (used to give Claude reasoning material)
// ---------------------------------------------------------------------------

const SECTOR_PAIN_MAP: Record<string, string> = {
  "defense": "Defense/A&D demand plans break when programs slip — a six-month delay turns a 12-month component lead time into a 6-month excess inventory problem, and the backlog depth hides it until it's too late to fix.",
  "defense-aerospace": "Aerospace defense backlogs are multi-year. Components procured for a program get stranded when contracts get restructured. Change orders are expensive and relationship-damaging.",
  "evtol": "eVTOL production ramps require aerospace-grade components on consumer-electronics timelines — component lead times built for traditional aviation don't match the pace of an emerging platform program, creating chronic forecast gaps.",
  "rail-transportation-equipment": "Rail backlogs are long (18-36 months) and each railcar is a bundle of 10,000+ components. Excess inventory from imprecise backlog-to-build sequencing is typically $40M-$60M for a mid-size railcar manufacturer. Trinity Rail is our first design partner and this is exactly their problem.",
  "heavy-equipment": "Heavy equipment is classic backlog-to-revenue: custom configurations, long lead times, and a sales team that records customer specs in Salesforce prose instead of structured fields — meaning the demand plan is always working with incomplete information.",
  "industrial-specialty-manufacturing": "Industrial specialty manufacturers typically have aging ERPs, deeply siloed sales and operations functions, and commodity managers who know everything about their part universe but can't get that knowledge into the planning system.",
  "building-products-construction": "Construction-adjacent manufacturers deal with project-based demand that spikes and stops unpredictably — demand planners are constantly chasing cycle time that the sales team sees months before any signal shows up in the system.",
  "fluid-control-water-tech": "Flow control and water tech manufacturing involves complex custom configurations with long lead times — demand planning accuracy directly determines how much buffer stock you carry and how quickly you can respond to emergency orders.",
  "specialty-chemicals-materials": "Specialty chemicals have raw material lead times tied to commodity markets that shift faster than planning cycles — the mismatch between procurement windows and demand signals creates chronic over/under-buys.",
  "robotics": "Robotics hardware BOMs are a demand planning nightmare: hardware lead times are 16-20 weeks, software release cycles are 2-week sprints, and the mismatch creates constant expediting costs and broken production schedules.",
  "machine-vision": "Machine vision systems combine long-lead-time silicon components with fast-moving software specs — by the time components arrive, the camera module or sensor package may have already been superseded.",
  "ev-battery": "EV battery supply chains have three compounding problems: battery cell lead times are 6-18 months, specs change with each chemistry iteration, and customer demand forecasts shift faster than the underlying procurement commitments.",
  "enterprise-tech": "Hardware-software supply chains are where demand planning inaccuracies hit hardest: one silicon shortage can stall an entire software release cycle, and the lead time data in ERPs is often 6-12 months stale.",
};

const ROLE_REASONING: Record<string, string> = {
  csco: "CSCO is the champion and direct user — they own the forecast and feel every planning failure personally. Angle toward their KPI problem (they're measured on cost, not revenue protection) and the organizational friction (they can see the problem but can't get the right data).",
  "vp supply chain": "VP Supply Chain is likely the CSCO's direct report running day-to-day operations. They manage the planners, live the ERP pain, and can be a strong internal champion who brings Eloso to the CSCO.",
  "director supply chain": "Supply chain director is operationally accountable for planning accuracy. They know exactly where the forecast breaks down and are often the person most frustrated with the status quo.",
  "demand planner": "Demand planners are the daily users — they live the information gap every cycle. They know the forecast is wrong, they know why, and they know what data they wish they had. Great product validation contact.",
  "procurement": "Procurement feels forecast inaccuracy as expediting costs, rush order premiums, and supplier relationship damage. They are typically the ones paying for demand planning failures downstream.",
  "cfo": "CFOs see demand planning failures as the backlog-to-revenue gap — components on the balance sheet earning nothing while cash is tied up. Eloso's ROI story (reduce days between receipt and revenue) translates directly to CFO language.",
  "coo": "COO is the economic buyer in many manufacturing companies. Frame Eloso as operational risk reduction and margin protection — they will escalate to the CSCO if the business case is clear.",
  "ceo": "CEO is the economic buyer. Ben's vision angle is best here — why this moment, why AI agents need a governance layer, why the supply chain is the next frontier for AI-driven value creation.",
};

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildClaudePrompt(
  contact: ProspectContact,
  assignee: TeamMember
): string {
  const senderContext: Record<TeamMember, string> = {
    Ben: `Ben Roome — CEO, co-founder. PhD in Ethics of Science and Technology. Background: AI ethics consulting (Ethical Resolve), EdTech startup founder. His angle: "why now" — AI agents are multiplying in supply chains, most optimize for speed and zero-sum wins, Eloso is the governance layer that optimizes for relationship stability. He speaks to CEOs, founders, and senior operators who think about market timing.`,
    Jake: `Jake Metcalf — COO, CFO, President. PhD in Ethics of Science and Technology (Sociology of Science). Background: AI policy and accountability research at Data & Society Research Institute; academic work on algorithmic accountability; co-created an AI governance course for procurement professionals. His angle: operational outcomes, governance, ROI. He speaks the language of procurement officers, rail/industrial/defense operations leaders — people who need to justify software investment with hard numbers and who care about organizational accountability.`,
    Drew: `Drew Winget — CTO, the only technical co-founder. His angle: how Eloso works — the agents, why we work around the ERP instead of fighting it, what we connect to, the architecture decisions. He speaks to technically literate CSCOs, engineers in supply chain roles, and anyone who wants to understand the implementation before they buy. He is credible with robotics, machine vision, EV, and enterprise tech contacts.`,
  };

  const angleDescription: Record<TeamMember, string> = {
    Ben: "vision / why now / market timing",
    Jake: "strategic / operational outcomes / governance / ROI",
    Drew: "technical / implementation / how it works",
  };

  const firstName = contact.name?.trim().split(" ")[0] || "there";
  const title = contact.title?.trim() || "";
  const company = contact.company?.trim() || "";
  const sector = contact.sector.length > 0 ? contact.sector.join(", ") : "manufacturing";

  const titleLine = title ? `Title: ${title}` : "Title: (unknown — infer from context or omit role-specific references)";
  const companyLine = company ? `Company: ${company}` : "Company: (unknown — omit company-specific references)";
  const linkedinLine = contact.linkedinUrl?.trim() ? `LinkedIn: ${contact.linkedinUrl.trim()}` : "";
  const notesSection = contact.notes?.trim() ? `\nNotes about this contact: ${contact.notes.trim()}` : "";
  const fitLine = `ICP fit tier: ${contact.fitTier}`;

  // Pull sector pain context for Claude to reason with
  const sectorPains: string[] = [];
  for (const s of contact.sector) {
    const pain = SECTOR_PAIN_MAP[s];
    if (pain) sectorPains.push(pain);
  }
  const sectorPainSection = sectorPains.length > 0
    ? `\nSector-specific pain context:\n${sectorPains.map((p) => `- ${p}`).join("\n")}`
    : "";

  // Pull role reasoning hint
  const roleLower = title.toLowerCase();
  let roleHint = "";
  for (const [keyword, hint] of Object.entries(ROLE_REASONING)) {
    if (roleLower.includes(keyword)) {
      roleHint = `\nRole reasoning: ${hint}`;
      break;
    }
  }

  return `You are writing a LinkedIn outreach DM from ${assignee} to ${contact.name} (first name: ${firstName}).

## Sender
${senderContext[assignee]}
Angle for this message: ${angleDescription[assignee]}

## Recipient
${titleLine}
${companyLine}
Sector: ${sector}
${fitLine}${linkedinLine ? "\n" + linkedinLine : ""}${notesSection}${sectorPainSection}${roleHint}

## Your Task

Before writing the message, reason through:
1. What does ${firstName} specifically struggle with, given their role (${title || "unknown"}) and sector (${sector})?
2. What specific Eloso capability addresses THAT problem? (Be concrete — not "better forecasting" but what agents do and why it works differently from existing tools)
3. What is the sharpest one-sentence version of that pain → solution connection?
4. Which angle from ${assignee}'s background makes this message credible (not generic)?

Then write a LinkedIn DM that:
- Opens with "Hi ${firstName} —"
- Identifies ${assignee} as co-founder of Eloso Intelligence (brief)
- Names ONE specific problem hypothesis for their role and sector — precise, not generic
- Does NOT explain the solution. An invitation, not a pitch.
- Ends with a soft CTA: "worth 20 min?" or "relevant to you?" or "does that resonate?"

HARD CONSTRAINT: Under 280 characters total. Count every character. No exceptions. When in doubt, cut.

Do NOT use: "leverage", "synergy", "circle back", "excited to connect", "hope this finds you well", "I'd be pleased to", "game-changer", any marketing buzzword. Do NOT describe what Eloso does — just name the problem and invite.

Write ONLY the message text. No preamble, no reasoning output, no quotes around the message, no explanation.`;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface GenerationResult {
  message: string;
  source: "claude" | "template";
  angle: "vision" | "technical" | "strategic";
}

/**
 * Core generation logic — shared by the individual and bulk endpoints.
 *
 * Runs a single Opus call that reasons about the recipient's specific situation
 * and writes a grounded, persona-specific message. Falls back to the template
 * engine if Claude is unavailable or errors.
 */
export async function generateOpusMessage(
  contact: ProspectContact,
  assignee: TeamMember
): Promise<GenerationResult> {
  const angleMap: Record<TeamMember, "vision" | "technical" | "strategic"> = {
    Ben: "vision",
    Jake: "strategic",
    Drew: "technical",
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      // Single Opus call — reason about the recipient then write the message.
      // The previous two-pass Haiku→Opus pipeline added latency without adding
      // signal: the Haiku pre-pass was generic enough that it wasn't meaningfully
      // improving Opus's output. One well-grounded Opus call is better.
      const response = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 300,
        system: ELOSO_CONTEXT,
        messages: [
          {
            role: "user",
            content: buildClaudePrompt(contact, assignee),
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : null;

      if (text) {
        return {
          message: text.trim(),
          source: "claude",
          angle: angleMap[assignee],
        };
      }
    } catch (err) {
      // Claude call failed — fall through to template
      console.error("[outreach] Claude generation failed:", err);
    }
  }

  // --- Template fallback ---
  const task = {
    id: `${contact.id}-${assignee}`,
    contact,
    assignee,
    generatedAt: new Date().toISOString(),
  };

  const generated = generateMessage(task);
  return {
    message: generated.message,
    source: "template",
    angle: generated.angle,
  };
}
