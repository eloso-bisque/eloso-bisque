/**
 * Core Opus message generation logic — shared by the individual and bulk outreach endpoints.
 *
 * Two-pass pipeline:
 *   Pass 1 — Haiku simulates the recipient's mindset (2-3 sentences on what they care about)
 *   Pass 2 — Opus writes the final message using all contact context + recipient simulation
 *
 * Falls back to the template engine if ANTHROPIC_API_KEY is not set or Claude fails.
 */

import { generateMessage, type ProspectContact, type TeamMember } from "@/lib/outreach";

// Eloso system prompt — 8 rules, tight and opinionated
export const ELOSO_CONTEXT = `You write LinkedIn DMs for Eloso Intelligence (supply chain planning for manufacturers, $100M–$5B rev, backlog-to-revenue accounting).

Rules:
1. Under 280 characters total — count carefully. This is the hardest constraint. If in doubt, cut words.
2. Casual, conversational — contractions, short sentences, no corporate speak. Never: "I'd be pleased to", "leverage", "synergy", "circle back".
3. Open with a sector-aware hook specific to the contact's industry pain. If sector is unknown, lead with a general manufacturing pain point.
4. Include a problem-hypothesis in the form "I think you might have [specific problem]. Is that true?" — must be role+sector specific, never generic. Examples by sector:
   - Defense/A&D: "I think you might have demand plans that break down the moment a program gets delayed. Is that true?"
   - eVTOL/advanced air: "I think you might be struggling with component lead times that don't match your production ramp schedule. Is that true?"
   - Rail: "I think your backlog-to-revenue gap is creating forecasting blind spots for finance. Is that true?"
   - Robotics/machine-vision: "I think your hardware BOM demand planning still lives in spreadsheets that can't keep up with software release cycles. Is that true?"
   - Heavy equipment/capital goods: "I think your CSCO team is measured on cost metrics that miss the revenue impact of late deliveries. Is that true?"
   BAD (too generic): "I think you might have supply chain challenges. Is that true?"
5. End with a soft CTA: "worth 20 min?" or "relevant to you?" style.
6. Sender angles — Ben: vision/product ("why now"); Jake: technical/implementation ("how it works"); Drew: strategic outcomes ("business ROI").
7. Skip COO titles entirely — do not write a message for a COO.
8. If any contact field (title, company) is marked "unknown" or is absent, omit any phrase that would reference it. Never leave a blank or placeholder in the message.`;

/** Pass 1 prompt: ask Haiku to simulate the recipient's mindset */
function buildRecipientSimulationPrompt(contact: ProspectContact): string {
  const title = contact.title?.trim() || "supply chain executive";
  const company = contact.company?.trim() || "their company";
  const sector = contact.sector.join(", ") || "manufacturing";
  const notesHint = contact.notes?.trim()
    ? `\nAdditional context: ${contact.notes.trim()}`
    : "";

  return `You are simulating the mindset of a supply chain executive receiving a cold LinkedIn DM.

Contact:
- Name: ${contact.name}
- Title: ${title}
- Company: ${company}
- Sector: ${sector}${notesHint}

In 2–3 sentences, describe: (1) what this person likely cares about day-to-day, and (2) their most probable operational pain given their role and sector. Be specific. No generic statements.`;
}

/** Pass 2 prompt: build the final message using recipient context and all available contact data */
function buildClaudePrompt(
  contact: ProspectContact,
  assignee: TeamMember,
  recipientContext: string
): string {
  const senderContext: Record<TeamMember, string> = {
    Ben: "Ben is the co-founder/CEO, leading with vision and the 'why now' angle.",
    Jake: "Jake is the co-founder/CTO, leading with the technical and product capability angle.",
    Drew: "Drew is the co-founder, leading with strategic business outcomes and ROI.",
  };

  // Pre-compute safe field values — never pass blank labels to the model
  const firstName = contact.name?.trim().split(" ")[0] || "there";
  const title = contact.title?.trim() || "";
  const company = contact.company?.trim() || "";
  const sector = contact.sector.join(", ") || "manufacturing";

  const titleLine = title ? `- Title: ${title}` : "- Title: (not provided — infer from context)";
  const companyLine = company ? `- Company: ${company}` : "- Company: (not provided — omit company-specific references)";

  const notesSection = contact.notes?.trim()
    ? `\nNotes about this contact: ${contact.notes.trim()}`
    : "";

  const linkedinSection = contact.linkedinUrl?.trim()
    ? `\nLinkedIn profile: ${contact.linkedinUrl.trim()}`
    : "";

  return `Recipient context (from mindset simulation):
${recipientContext}

---

Write a LinkedIn outreach message from ${assignee} to ${contact.name}.

Contact details:
- Name: ${contact.name}
${titleLine}
${companyLine}
- Sector: ${sector}
- ICP fit: ${contact.fitTier}${linkedinSection}${notesSection}

Sender: ${assignee}
${senderContext[assignee]}

Start with "Hi ${firstName} —" and identify ${assignee} as co-founder of Eloso Intelligence.

CRITICAL: The final message must be under 280 characters total. Count every character before responding.

Write ONLY the message text. No preamble, no quotes, no explanation.`;
}

export interface GenerationResult {
  message: string;
  source: "claude" | "template";
  angle: "vision" | "technical" | "strategic";
}

/**
 * Core generation logic — shared by the individual and bulk endpoints.
 *
 * Runs the two-pass Haiku→Opus pipeline when ANTHROPIC_API_KEY is set.
 * Falls back to the template engine if Claude is unavailable or errors.
 */
export async function generateOpusMessage(
  contact: ProspectContact,
  assignee: TeamMember
): Promise<GenerationResult> {
  const angleMap: Record<TeamMember, "vision" | "technical" | "strategic"> = {
    Ben: "vision",
    Jake: "technical",
    Drew: "strategic",
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      // Pass 1 — Haiku infers recipient context (what they care about, their likely pain)
      // This adds signal that Opus can use to write a more targeted problem hypothesis.
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

      // Pass 2 — Opus writes the final message using recipient context + all contact data
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
