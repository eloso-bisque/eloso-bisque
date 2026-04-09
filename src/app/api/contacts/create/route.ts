import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";

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
// Kissinger GraphQL mutation
// ---------------------------------------------------------------------------

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const CREATE_ENTITY_MUTATION = `
  mutation CreateEntity($input: CreateEntityInput!) {
    createEntity(input: $input) {
      id
      kind
      name
      tags
      notes
      meta { key value }
      createdAt
      updatedAt
    }
  }
`;

async function createEntityInKissinger(
  kind: "person" | "org",
  name: string,
  meta: { key: string; value: string }[],
  notes?: string
): Promise<{ id: string; name: string } | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (KISSINGER_API_TOKEN) {
    headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  }

  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: CREATE_ENTITY_MUTATION,
      variables: {
        input: {
          kind,
          name,
          notes: notes ?? "",
          meta: meta.length > 0 ? meta : undefined,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Kissinger request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: { createEntity: { id: string; name: string } };
    errors?: unknown[];
  };

  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data?.createEntity ?? null;
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

  try {
    // Step 1: AI enrichment
    const enriched = await enrichWithClaude({ ...body, kind });

    // Step 2: Build meta fields from enriched data
    const meta: { key: string; value: string }[] = [];
    if (enriched.email) meta.push({ key: "email", value: enriched.email });
    if (enriched.organization)
      meta.push({ key: "company", value: enriched.organization });
    if (enriched.linkedin_url)
      meta.push({ key: "linkedin", value: enriched.linkedin_url });

    // Step 3: Determine name (required by Kissinger)
    const name = enriched.name || enriched.organization || enriched.email || "Unknown";

    // Step 4: Save to Kissinger
    const created = await createEntityInKissinger(kind, name, meta, enriched.notes);

    // Invalidate contacts and funnel caches so the new contact appears immediately
    revalidateTag("contacts");
    revalidateTag("funnel");

    return NextResponse.json({ ok: true, entity: created });
  } catch (err) {
    console.error("Failed to create contact:", err);
    return NextResponse.json(
      { error: "Failed to save contact. Please try again." },
      { status: 500 }
    );
  }
}
