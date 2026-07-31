import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { randomUUID } from "node:crypto";
import { parseCsv, type ParsedContact } from "@/lib/csv-parse";
import {
  dualWriteCreateEntity,
  withOrganizationNote,
  findDuplicateContactByEmail,
  normalizeEmailForDedup,
} from "@/lib/contacts-dual-write";

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
  // Tracks emails already created within THIS batch, so two duplicate rows
  // in the same CSV/array are caught even though neither exists in Postgres
  // yet when the batch starts (findDuplicateContactByEmail alone would miss
  // that case since it only sees already-committed rows).
  const emailsSeenThisBatch = new Set<string>();

  for (const contact of contacts) {
    // Derive name — same requirement Kissinger used to enforce
    const name = contact.name || contact.email || contact.organization || "";
    if (!name) {
      skipped++;
      continue;
    }

    // Duplicate check (person only — Organization has no email column). See
    // findDuplicateContactByEmail's doc in contacts-dual-write.ts for why
    // this is an app-level check rather than a DB unique constraint.
    if (kind === "person") {
      const normalizedEmail = normalizeEmailForDedup(contact.email);
      if (normalizedEmail) {
        if (emailsSeenThisBatch.has(normalizedEmail)) {
          creationErrors.push({ name, reason: `Duplicate email within this batch: ${contact.email}` });
          continue;
        }
        const existing = await findDuplicateContactByEmail(contact.email);
        if (existing) {
          creationErrors.push({ name, reason: `A contact with this email already exists: ${existing.name}` });
          continue;
        }
        emailsSeenThisBatch.add(normalizedEmail);
      }
    }

    try {
      // Postgres is the sole write since the Kissinger dual-write cutover
      // (Kissinger is no longer in the live bulk-create path; see
      // src/lib/contacts-dual-write.ts's module doc). Each row self-mints
      // a stable external id instead of one assigned by Kissinger's
      // createEntity mutation.
      await dualWriteCreateEntity({
        kissingerId: randomUUID(),
        kind,
        name,
        email: contact.email,
        linkedinUrl: contact.linkedinUrl,
        notes: withOrganizationNote(undefined, contact.organization),
      });
      created++;
    } catch (err) {
      creationErrors.push({
        name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Invalidate contacts and funnel caches if any contacts were created.
  // Wrapped defensively: the Postgres writes above already succeeded, so a
  // revalidation failure must never prevent the accurate created/skipped/
  // errors summary below from reaching the caller.
  if (created > 0) {
    try {
      revalidateTag("contacts");
      revalidateTag("funnel");
    } catch (err) {
      console.error("Contacts created, but cache revalidation failed (non-fatal):", err);
    }
  }

  return NextResponse.json<BulkCreateResult>({
    created,
    skipped,
    errors: creationErrors,
    parseErrors,
  });
}
