/**
 * POST /api/outreach/generate-message
 *
 * Generates a personalized LinkedIn outreach message for a prospect contact.
 *
 * If ANTHROPIC_API_KEY is set, calls Claude to produce a bespoke message
 * grounded in Eloso's positioning. Otherwise falls back to the template
 * engine in src/lib/outreach.ts.
 *
 * Request body (JSON):
 * {
 *   contact: ProspectContact,
 *   assignee: "Ben" | "Jake" | "Drew"
 * }
 *
 * Response:
 * {
 *   message: string,
 *   source: "claude" | "template",
 *   angle: "vision" | "technical" | "strategic"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { generateMessage, type ProspectContact, type TeamMember } from "@/lib/outreach";

// Eloso system context for Claude — grounded in the product docs
const ELOSO_CONTEXT = `
You are helping write LinkedIn outreach messages for the Eloso Intelligence founding team.

Eloso is an AI-driven supply chain planning platform. Key facts:
- Target buyer: Chief Supply Chain Officer (CSCO) and their immediate team at large manufacturers
- ICP: Manufacturers with $100M–$5B revenue using backlog-to-revenue accounting (ASC 606/IFRS 15)
- Core verticals: Aerospace & Defense, Heavy Equipment, Capital Goods, Contract Manufacturing, Rail
- Core pain: CSCO offices are perceived as cost centers despite being central to enterprise value;
  traditional KPIs are misaligned (94% of executives feel this), demand plans are inaccurate
- Eloso's differentiation: optimizes for stable, win-win supplier/customer relationships rather than
  zero-sum speed/cost optimization. Closing the backlog-to-revenue gap = clearest ROI signal.
- Stage: early-stage, recruiting design partners for paid 6-week discovery sprints ($150–200K)

Senders:
- Ben: founder/vision — leads with big picture and why now
- Jake: technical/product — leads with the product capability and data angle
- Drew: strategic/business — leads with business outcomes and ROI

Message rules:
- 3–5 sentences maximum
- Personalized to the specific person's title and company context
- Direct and substantive — no template-sounding phrases
- End with a soft call to action (20-minute call, open to connecting)
- No buzzwords: no "synergy", "leverage", "ecosystem", "circle back"
- Do not mention "AI" as a buzzword — describe specifically what Eloso does
`;

function buildClaudePrompt(
  contact: ProspectContact,
  assignee: TeamMember
): string {
  const senderContext: Record<TeamMember, string> = {
    Ben: "Ben is the founder/CEO, leading with vision and the 'why now' angle.",
    Jake: "Jake is the co-founder/CTO, leading with the technical and product capability angle.",
    Drew: "Drew is the co-founder/COO, leading with strategic business outcomes and ROI.",
  };

  return `Write a LinkedIn outreach message from ${assignee} to ${contact.name}.

Contact details:
- Name: ${contact.name}
- Title: ${contact.title}
- Company: ${contact.company}
- Sector: ${contact.sector.join(", ") || "manufacturing"}
- ICP fit: ${contact.fitTier}

Sender: ${assignee}
${senderContext[assignee]}

Start with "Hi ${contact.name.split(" ")[0]} —" and identify ${assignee} as co-founder of Eloso Intelligence.

Write ONLY the message text. No preamble, no quotes, no explanation.`;
}

export async function POST(request: NextRequest) {
  let body: { contact?: ProspectContact; assignee?: TeamMember };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contact, assignee } = body;

  if (!contact || !assignee) {
    return NextResponse.json(
      { error: "Missing required fields: contact, assignee" },
      { status: 400 }
    );
  }

  const validAssignees: TeamMember[] = ["Ben", "Jake", "Drew"];
  if (!validAssignees.includes(assignee)) {
    return NextResponse.json(
      { error: "assignee must be one of: Ben, Jake, Drew" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // --- Claude path ---
  if (apiKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: "claude-haiku-4-5",
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
        // Determine angle from assignee (consistent with template engine)
        const angleMap: Record<TeamMember, "vision" | "technical" | "strategic"> = {
          Ben: "vision",
          Jake: "technical",
          Drew: "strategic",
        };

        return NextResponse.json({
          message: text.trim(),
          source: "claude",
          angle: angleMap[assignee],
        });
      }
    } catch (err) {
      // Claude call failed — fall through to template
      console.error("[outreach/generate-message] Claude call failed:", err);
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

  return NextResponse.json({
    message: generated.message,
    source: "template",
    angle: generated.angle,
  });
}
