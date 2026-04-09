import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { parseCsv, type ParsedContact } from "@/lib/csv-parse";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BulkCreateRequest {
  /** Raw CSV text (mutually exclusive with contacts) */
  csv?: string;
  /** Pre-parsed contacts array (mutually exclusive with csv) */
  contacts?: ParsedContact[];
  /** Entity kind — defaults to "person" */
  kind?: "person" | "org";
}

export interface BulkCreateResult {
  created: number;
  skipped: number;
  errors: { name: string; reason: string }[];
  parseErrors: { row: number; raw: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Kissinger GraphQL
// ---------------------------------------------------------------------------

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const CREATE_ENTITY_MUTATION = `
  mutation CreateEntity($input: CreateEntityInput!) {
    createEntity(input: $input) {
      id
      name
    }
  }
`;

async function createEntityInKissinger(
  kind: "person" | "org",
  name: string,
  meta: { key: string; value: string }[]
): Promise<{ id: string; name: string }> {
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
          notes: "",
          meta: meta.length > 0 ? meta : undefined,
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: { createEntity: { id: string; name: string } };
    errors?: { message: string }[];
  };

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  if (!json.data?.createEntity) {
    throw new Error("No entity returned from Kissinger");
  }

  return json.data.createEntity;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  let body: BulkCreateRequest;
  try {
    body = (await request.json()) as BulkCreateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const kind: "person" | "org" = body.kind ?? "person";

  // Resolve the contacts array — either parse CSV or use pre-parsed list
  let contacts: ParsedContact[];
  let parseErrors: { row: number; raw: string; reason: string }[] = [];

  if (body.csv != null) {
    const parsed = parseCsv(body.csv);
    contacts = parsed.contacts;
    parseErrors = parsed.errors;
  } else if (Array.isArray(body.contacts)) {
    contacts = body.contacts;
  } else {
    return NextResponse.json(
      { error: "Provide either 'csv' (raw text) or 'contacts' (array)" },
      { status: 400 }
    );
  }

  if (contacts.length === 0) {
    return NextResponse.json<BulkCreateResult>({
      created: 0,
      skipped: 0,
      errors: [],
      parseErrors,
    });
  }

  // Create contacts one-by-one; collect errors per contact
  const creationErrors: { name: string; reason: string }[] = [];
  let created = 0;
  let skipped = 0;

  for (const contact of contacts) {
    // Derive name — required by Kissinger
    const name = contact.name || contact.email || contact.organization || "";
    if (!name) {
      skipped++;
      continue;
    }

    // Build meta fields
    const meta: { key: string; value: string }[] = [];
    if (contact.email) meta.push({ key: "email", value: contact.email });
    if (contact.organization)
      meta.push({ key: "company", value: contact.organization });

    try {
      await createEntityInKissinger(kind, name, meta);
      created++;
    } catch (err) {
      creationErrors.push({
        name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Invalidate contacts and funnel caches if any contacts were created
  if (created > 0) {
    revalidateTag("contacts");
    revalidateTag("funnel");
  }

  return NextResponse.json<BulkCreateResult>({
    created,
    skipped,
    errors: creationErrors,
    parseErrors,
  });
}
