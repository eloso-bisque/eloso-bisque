/**
 * POST /api/outreach/generate-message
 *
 * Generates a personalized LinkedIn outreach message for a prospect contact.
 *
 * Uses a two-pass Claude pipeline:
 *   Pass 1 — Haiku simulates the recipient's mindset (2-3 sentences)
 *   Pass 2 — Opus writes the final message using all contact context + recipient simulation
 *
 * If ANTHROPIC_API_KEY is not set, falls back to the template engine.
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
import { type ProspectContact, type TeamMember } from "@/lib/outreach";
import { mergeEntityMeta } from "@/lib/kissinger";
import { generateOpusMessage } from "@/lib/outreach-generate";

/** Persist the generated message to Kissinger as meta fields. Non-blocking. */
async function persistMessageToKissinger(
  entityId: string,
  message: string,
  sender: string
): Promise<void> {
  await mergeEntityMeta(entityId, {
    outreach_message: message,
    outreach_message_generated_at: new Date().toISOString(),
    outreach_message_sender: sender.toLowerCase(),
  });
}

export async function POST(request: NextRequest) {
  let body: { contact?: ProspectContact; assignee?: TeamMember; entityId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { contact, assignee, entityId } = body;

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

  const result = await generateOpusMessage(contact, assignee);

  // Persist to Kissinger — non-blocking, never fails the response
  if (entityId) {
    persistMessageToKissinger(entityId, result.message, assignee).catch((err) => {
      console.error("[outreach/generate-message] Kissinger write failed:", err);
    });
  }

  return NextResponse.json(result);
}
