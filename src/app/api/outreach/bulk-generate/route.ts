/**
 * POST /api/outreach/bulk-generate
 *
 * Generate and persist outreach messages for a list of entity IDs.
 * Messages are written to Kissinger as meta fields (outreach_message, etc.)
 * and returned in the response.
 *
 * Useful for pre-generating messages for an entire outreach campaign before
 * the team starts sending.
 *
 * Request body (JSON):
 * {
 *   entityIds: string[],    // Kissinger entity IDs to generate for
 *   assignee?: "Ben" | "Jake" | "Drew"  // override — otherwise auto-assigned by sector
 * }
 *
 * Response:
 * {
 *   generated: number,
 *   failed: number,
 *   results: Array<{ entityId: string, status: "ok" | "failed", message?: string, error?: string }>
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchProspectContacts, mergeEntityMeta } from "@/lib/kissinger";
import { distributeContacts, generateMessage, type TeamMember } from "@/lib/outreach";

const MAX_ENTITY_IDS = 200;

interface BulkResult {
  entityId: string;
  status: "ok" | "failed";
  message?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  let body: { entityIds?: string[]; assignee?: TeamMember };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entityIds, assignee: assigneeOverride } = body;

  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return NextResponse.json(
      { error: "entityIds must be a non-empty array of strings" },
      { status: 400 }
    );
  }

  if (entityIds.length > MAX_ENTITY_IDS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ENTITY_IDS} entity IDs per request` },
      { status: 400 }
    );
  }

  if (
    assigneeOverride !== undefined &&
    !["Ben", "Jake", "Drew"].includes(assigneeOverride)
  ) {
    return NextResponse.json(
      { error: "assignee must be one of: Ben, Jake, Drew" },
      { status: 400 }
    );
  }

  const entityIdSet = new Set(entityIds);

  // Fetch all prospect contacts from Kissinger
  const allContacts = await fetchProspectContacts();
  if (allContacts === null) {
    return NextResponse.json({ error: "Kissinger unreachable" }, { status: 503 });
  }

  // Filter to only the requested IDs
  const targeted = allContacts.filter((c) => entityIdSet.has(c.id));

  if (targeted.length === 0) {
    return NextResponse.json({
      generated: 0,
      failed: 0,
      results: [],
      note: "No matching prospect-contact entities found for provided IDs",
    });
  }

  // Map to ProspectContact shape
  const contacts = targeted.map((raw) => ({
    id: raw.id,
    name: raw.name,
    title: raw.title,
    company: raw.company,
    sector: raw.sector,
    fitTier: raw.fitTier,
    notes: raw.notes,
    outreachStage: raw.outreachStage,
    linkedinUrl: raw.linkedinUrl || undefined,
  }));

  // Distribute to determine assignees (unless overridden)
  const distributed = distributeContacts(contacts);

  const apiKey = process.env.ANTHROPIC_API_KEY;

  // For bulk generation, use template engine (Claude would be too slow and expensive for bulk)
  // If Claude is needed for specific IDs, call the single generate-message endpoint.
  const results: BulkResult[] = await Promise.allSettled(
    contacts.map(async (contact) => {
      // Determine assignee: override → sector assignment
      let assignee: TeamMember;
      if (assigneeOverride) {
        assignee = assigneeOverride;
      } else {
        // Find which bucket this contact was placed in
        const bucket = (["Ben", "Jake", "Drew"] as TeamMember[]).find((m) =>
          distributed[m].some((t) => t.contact.id === contact.id)
        );
        assignee = bucket ?? "Drew";
      }

      const task = {
        id: `${contact.id}-${assignee}`,
        contact,
        assignee,
        generatedAt: new Date().toISOString(),
      };

      let message: string;
      let source: "claude" | "template" = "template";

      // Use Claude if available and API key is set
      if (apiKey) {
        try {
          const { default: Anthropic } = await import("@anthropic-ai/sdk");
          const client = new Anthropic({ apiKey });

          const senderContext: Record<TeamMember, string> = {
            Ben: "Ben is the co-founder/CEO, leading with vision and the 'why now' angle.",
            Jake: "Jake is the co-founder/CTO, leading with the technical and product capability angle.",
            Drew: "Drew is the co-founder, leading with strategic business outcomes and ROI.",
          };

          const firstName = contact.name?.trim().split(" ")[0] || "there";
          const title = contact.title?.trim() || "";
          const company = contact.company?.trim() || "";
          const sector = contact.sector.join(", ") || "manufacturing";

          const claudeRes = await client.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 200,
            system: `You write LinkedIn DMs for Eloso Intelligence (supply chain planning for manufacturers, $100M–$5B rev). Under 280 characters. Casual, no corporate speak. Lead with a sector-specific pain. Include "I think you might have [X]. Is that true?" End with "worth 20 min?". Write ONLY the message.`,
            messages: [
              {
                role: "user",
                content: `Write a LinkedIn outreach message from ${assignee} to ${contact.name}.
${title ? `Title: ${title}` : ""}
${company ? `Company: ${company}` : ""}
Sector: ${sector}
Sender: ${assignee}. ${senderContext[assignee]}
Start with "Hi ${firstName} —" and identify ${assignee} as co-founder of Eloso Intelligence.
Under 280 characters total.`,
              },
            ],
          });

          const text =
            claudeRes.content[0].type === "text" ? claudeRes.content[0].text : null;
          if (text) {
            message = text.trim();
            source = "claude";
          } else {
            message = generateMessage(task).message;
          }
        } catch {
          message = generateMessage(task).message;
        }
      } else {
        message = generateMessage(task).message;
      }

      // Persist to Kissinger
      await mergeEntityMeta(contact.id, {
        outreach_message: message,
        outreach_message_generated_at: new Date().toISOString(),
        outreach_message_sender: assignee.toLowerCase(),
      });

      return { entityId: contact.id, status: "ok" as const, message, source };
    })
  ).then((settled) =>
    settled.map((r, i) => {
      if (r.status === "fulfilled") {
        return r.value as BulkResult;
      }
      return {
        entityId: contacts[i].id,
        status: "failed" as const,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    })
  );

  const generated = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({ generated, failed, results });
}
