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

// Eloso system prompt — 7 rules, tight and opinionated
const ELOSO_CONTEXT = `You write LinkedIn DMs for Eloso Intelligence (supply chain planning for manufacturers, $100M–$5B rev, backlog-to-revenue accounting).

Rules:
1. Under 280 characters total.
2. Casual, conversational — contractions, short sentences, no corporate speak. Never: "I'd be pleased to", "leverage", "synergy", "circle back".
3. Open with a sector-aware hook specific to the contact's industry pain.
4. Include a problem-hypothesis: "I think you might have [specific problem]. Is that true?" — must be role+sector specific.
5. End with a soft CTA: "worth 20 min?" or "relevant to you?" style.
6. Sender angles — Ben: vision/product ("why now"); Jake: technical/implementation ("how it works"); Drew: strategic/market ("business outcomes").
7. Skip COO titles entirely — do not write a message for a COO.`;

/** Pass 1 prompt: ask Haiku to simulate the recipient's mindset */
function buildRecipientSimulationPrompt(contact: ProspectContact): string {
  return `You are simulating the mindset of a supply chain executive receiving a cold LinkedIn DM.

Contact:
- Name: ${contact.name}
- Title: ${contact.title}
- Company: ${contact.company}
- Sector: ${contact.sector.join(", ") || "manufacturing"}

In 2–3 sentences, describe: (1) what this person likely cares about day-to-day, and (2) their most probable operational pain given their role and sector. Be specific. No generic statements.`;
}

/** Pass 2 prompt: build the final message using recipient context */
function buildClaudePrompt(
  contact: ProspectContact,
  assignee: TeamMember,
  recipientContext: string
): string {
  const senderContext: Record<TeamMember, string> = {
    Ben: "Ben is the founder/CEO, leading with vision and the 'why now' angle.",
    Jake: "Jake is the co-founder/CTO, leading with the technical and product capability angle.",
    Drew: "Drew is the co-founder/COO, leading with strategic business outcomes and ROI.",
  };

  const notesSection = contact.notes
    ? `\nNotes about this contact: ${contact.notes}`
    : "";

  return `Recipient context (from simulation):
${recipientContext}

---

Write a LinkedIn outreach message from ${assignee} to ${contact.name}.

Contact details:
- Name: ${contact.name}
- Title: ${contact.title}
- Company: ${contact.company}
- Sector: ${contact.sector.join(", ") || "manufacturing"}
- ICP fit: ${contact.fitTier}${notesSection}

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

  // --- Claude path (two-pass: Haiku → Opus) ---
  if (apiKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      // Pass 1 — Haiku infers recipient context (what they care about, their likely pain)
      const simulationResponse = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: buildRecipientSimulationPrompt(contact),
          },
        ],
      });

      const recipientContext =
        simulationResponse.content[0].type === "text"
          ? simulationResponse.content[0].text.trim()
          : "";

      // Pass 2 — Opus writes the final message using recipient context + all rules
      const response = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 180,
        system: ELOSO_CONTEXT,
        messages: [
          {
            role: "user",
            content: buildClaudePrompt(contact, assignee, recipientContext),
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
