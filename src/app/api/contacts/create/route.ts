import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { dualWriteCreateEntity, withOrganizationNote, findDuplicateContactByEmail } from "@/lib/contacts-dual-write";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContactInput {
  name?: string;
  email?: string;
  organization?: string;
  linkedin_url?: string;
  kind: "person" | "org";
}

interface EnrichedContact {
  name: string;
  email?: string;
  organization?: string;
  linkedin_url?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// AI enrichment
// ---------------------------------------------------------------------------

async function enrichWithClaude(input: ContactInput): Promise<EnrichedContact> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No API key — return user input as-is
    return {
      name: input.name ?? "",
      email: input.email,
      organization: input.organization,
      linkedin_url: input.linkedin_url,
    };
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Given this partial contact info, infer likely values for any missing fields.
Return JSON with these fields: name, email, organization, linkedin_url, notes.
Only fill in fields you are reasonably confident about based on the provided data.
Do not invent information — if you can't confidently infer something, leave it as null or empty string.

Provided info:
- Name: ${input.name || "(not provided)"}
- Email: ${input.email || "(not provided)"}
- Organization: ${input.organization || "(not provided)"}
- LinkedIn URL: ${input.linkedin_url || "(not provided)"}
- Contact type: ${input.kind}

Return ONLY a JSON object, no markdown, no explanation.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "{}";

    // Parse the JSON response
    let parsed: Partial<EnrichedContact> = {};
    try {
      parsed = JSON.parse(text.trim()) as Partial<EnrichedContact>;
    } catch {
      // Invalid JSON — ignore AI output
      console.error("Claude returned non-JSON:", text);
    }

    // User input always wins — merge with user values taking priority
    return {
      name: input.name || parsed.name || "",
      email: input.email || parsed.email || undefined,
      organization: input.organization || parsed.organization || undefined,
      linkedin_url: input.linkedin_url || parsed.linkedin_url || undefined,
      notes: parsed.notes || undefined,
    };
  } catch (err) {
    console.error("Claude enrichment failed:", err);
    // Fall back to user input only
    return {
      name: input.name ?? "",
      email: input.email,
      organization: input.organization,
      linkedin_url: input.linkedin_url,
    };
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: ContactInput;
  try {
    body = (await request.json()) as ContactInput;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.name && !body.email && !body.organization) {
    return NextResponse.json(
      { error: "At least one field (name, email, or organization) is required" },
      { status: 400 }
    );
  }

  const kind = body.kind ?? "person";

  let created: { id: string; name: string };
  try {
    // Step 1: AI enrichment
    const enriched = await enrichWithClaude({ ...body, kind });

    // Step 2: Determine name (kept required — same validation Kissinger used to enforce)
    const name = enriched.name || enriched.organization || enriched.email || "Unknown";

    // Step 2.5: Reject an exact-email duplicate before writing. Person
    // contacts only — Organization has no email column. See
    // findDuplicateContactByEmail's doc in contacts-dual-write.ts for why
    // this is an app-level check rather than a DB unique constraint.
    if (kind === "person") {
      const existing = await findDuplicateContactByEmail(enriched.email);
      if (existing) {
        return NextResponse.json(
          {
            error: `A contact with this email already exists: ${existing.name}`,
            existingContactId: existing.id,
          },
          { status: 409 }
        );
      }
    }

    // Step 3: Save to Postgres — the sole write since the Kissinger dual-write
    // cutover (Kissinger is no longer in the live create path; see
    // src/lib/contacts-dual-write.ts's module doc). `kissingerId` used to be
    // assigned by Kissinger's createEntity mutation; entities created from
    // this point on self-mint a stable external id instead so contacts/[id]
    // routing and every kissingerId-keyed read path continue to work
    // unchanged. The free-text "organization" field (kind=person's employer
    // name) used to be stored as a Kissinger meta value only — it has no
    // Postgres column, so it's folded into notes instead of silently lost.
    const id = randomUUID();
    await dualWriteCreateEntity({
      kissingerId: id,
      kind,
      name,
      email: enriched.email,
      linkedinUrl: enriched.linkedin_url,
      notes: withOrganizationNote(enriched.notes, enriched.organization),
    });
    created = { id, name };
  } catch (err) {
    console.error("Failed to create contact:", err);
    return NextResponse.json(
      { error: "Failed to save contact. Please try again." },
      { status: 500 }
    );
  }

  // Invalidate contacts and funnel caches so the new contact appears
  // immediately. Deliberately OUTSIDE the write's try/catch above: the
  // Postgres write already succeeded at this point, so a revalidation
  // failure must never be reported back as a failed create (that would be a
  // false negative — the row exists, but the caller is told to retry,
  // risking a duplicate). Best-effort; log and continue either way.
  try {
    revalidateTag("contacts");
    revalidateTag("funnel");
  } catch (err) {
    console.error("Contact created, but cache revalidation failed (non-fatal):", err);
  }

  return NextResponse.json({ ok: true, entity: created });
}
