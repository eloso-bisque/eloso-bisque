/**
 * Contact/Organization mutation write path (Prisma Phase 3.3, GH #44; cut
 * over to Postgres-only in the Kissinger live-path disconnect — see
 * docs/kissinger-disconnect.md).
 *
 * These started as dual-write helpers that ran *alongside* a Kissinger write
 * Kissinger being the operation of record. That Kissinger call has since
 * been removed from every route listed below — Postgres is now the sole
 * write for entity create/notes/prospect-tag/contact-event mutations, and
 * every helper here throws on failure instead of swallowing it, so a Postgres
 * outage surfaces as a real error to the caller instead of a silent no-op.
 * (Kissinger itself is untouched and still reachable directly — it's just no
 * longer in these routes' live request path.)
 *
 * Routes wired to these helpers:
 *   - POST /api/contacts/create           -> dualWriteCreateEntity
 *   - POST /api/contacts/bulk-create      -> dualWriteCreateEntity (looped)
 *   - PATCH /api/contacts/[id]/notes      -> dualWriteUpdateNotes
 *   - DELETE /api/contacts/[id]/remove-prospect -> dualWriteRemoveProspectTag
 *   - POST /api/contacts/[id]/events      -> dualWriteCreateContactEvent
 *
 * Routes reviewed and intentionally NOT touched (documented per the #43
 * precedent of reviewing outreach/feedback and reload-tasks before deciding
 * they were out of scope):
 *   - POST /api/contacts/[id]/enrich: does not mutate Kissinger itself — it
 *     delegates to an external Lobster MCP endpoint (or a local subprocess)
 *     that runs enrich_contact.py out-of-process and asynchronously. Any
 *     Kissinger writes happen entirely outside this Next.js route, in a
 *     different codebase, so there is nothing here to touch.
 *   - GET /api/contacts/[id]/score: read-only, migrated separately (now reads
 *     Postgres via src/lib/contact-detail-read.ts + src/lib/score-contact.ts).
 */

import { prisma } from "@/lib/prisma";
import type { ContactEventKind } from "@prisma/client";

// ---------------------------------------------------------------------------
// Create (POST /api/contacts/create, /api/contacts/bulk-create)
// ---------------------------------------------------------------------------

export interface DualWriteCreateEntityParams {
  /**
   * Stable external id for this entity. For entities that predate the
   * Kissinger disconnect, this is the real Kissinger-assigned id (still
   * used as the routing key throughout the app). For entities created after
   * the disconnect, the calling route self-mints this (see
   * src/app/api/contacts/create/route.ts) since Kissinger's createEntity
   * mutation is no longer called. The field is still named `kissingerId`
   * (matches the Postgres column) to avoid touching every kissingerId-keyed
   * read path across the app for what is otherwise a purely additive change.
   */
  kissingerId: string;
  kind: "person" | "org";
  name: string;
  /** Only meaningful for kind="person". */
  email?: string;
  /** Only meaningful for kind="person" — Contact.linkedinUrl. */
  linkedinUrl?: string;
  notes?: string;
}

/**
 * Creates a new Contact (kind="person") or Organization (kind="org") row
 * keyed by `kissingerId` (see field doc above). Throws on any Postgres error
 * (including a kissingerId collision) or if required params are missing —
 * this is now the sole write for entity creation, so a failure here must
 * surface to the caller rather than be swallowed.
 */
export async function dualWriteCreateEntity(params: DualWriteCreateEntityParams): Promise<void> {
  const { kissingerId, kind, name, email, linkedinUrl, notes } = params;
  if (!kissingerId || !name) {
    throw new Error("dualWriteCreateEntity requires both kissingerId and name");
  }

  if (kind === "person") {
    await prisma.contact.create({
      data: {
        kissingerId,
        name,
        email: email || null,
        linkedinUrl: linkedinUrl || null,
        notes: notes || null,
      },
    });
  } else {
    await prisma.organization.create({
      data: { kissingerId, name, notes: notes || null },
    });
  }
}

// ---------------------------------------------------------------------------
// Free-text "organization" field on the create form
// ---------------------------------------------------------------------------
//
// The create form lets a user type a free-text employer name for a person
// (not resolved to an Organization row — that would need fuzzy name
// matching, out of scope here). Kissinger's createEntity mutation used to
// store this as a "company" meta value; with Kissinger no longer written on
// create, that string needs a home in Postgres or it's silently lost.
// `withOrganizationNote` folds it into the notes field as a "Company: X"
// line instead, so the information a user typed on the form always survives.

/**
 * Pure: prepends "Company: <organization>" to `notes` when `organization` is
 * a non-empty string, otherwise returns `notes` unchanged.
 */
export function withOrganizationNote(notes: string | undefined, organization: string | undefined): string | undefined {
  const org = organization?.trim();
  if (!org) return notes;
  const companyLine = `Company: ${org}`;
  return notes ? `${companyLine}\n${notes}` : companyLine;
}

// ---------------------------------------------------------------------------
// Notes (PATCH /api/contacts/[id]/notes)
// ---------------------------------------------------------------------------

/**
 * Updates a notes field. The route only has an entity ID, not its kind
 * (person vs org), so this tries Contact first, then Organization — exactly
 * one of the two `updateMany` calls will affect a row, since kissingerId is
 * unique per table and an entity is one or the other.
 *
 * Throws if neither table has a matching row, or on any Postgres error —
 * this is the sole write for notes updates.
 */
export async function dualWriteUpdateNotes(params: { kissingerId: string; notes: string }): Promise<void> {
  const { kissingerId, notes } = params;
  if (!kissingerId) {
    throw new Error("dualWriteUpdateNotes requires kissingerId");
  }

  const contactResult = await prisma.contact.updateMany({
    where: { kissingerId },
    data: { notes },
  });
  if (contactResult.count > 0) return;

  const orgResult = await prisma.organization.updateMany({
    where: { kissingerId },
    data: { notes },
  });
  if (orgResult.count === 0) {
    throw new Error(`dualWriteUpdateNotes: no Contact or Organization row for "${kissingerId}"`);
  }
}

// ---------------------------------------------------------------------------
// Remove prospect tag (DELETE /api/contacts/[id]/remove-prospect)
// ---------------------------------------------------------------------------

/** Tag mapping per docs/prisma-schema-design.md section 4.3: prospect-contact -> isProspectContact. */
export const PROSPECT_CONTACT_TAG = "prospect-contact";

/**
 * Removes the "prospect-contact" tag. Clears Contact.isProspectContact (the
 * typed field the Phase 3.3 read migration segments on) and removes the
 * matching ContactTag row so tag-list displays stay consistent with the
 * typed field.
 *
 * remove-prospect only ever targets person entities (the route strips a
 * person-only tag), so this does not attempt an Organization fallback the
 * way dualWriteUpdateNotes does.
 *
 * Throws if the contact doesn't exist, or on any Postgres error.
 */
export async function dualWriteRemoveProspectTag(params: { kissingerId: string }): Promise<void> {
  const { kissingerId } = params;
  if (!kissingerId) {
    throw new Error("dualWriteRemoveProspectTag requires kissingerId");
  }

  const contact = await prisma.contact.findUnique({
    where: { kissingerId },
    select: { id: true },
  });
  if (!contact) {
    throw new Error(`dualWriteRemoveProspectTag: no Contact row for "${kissingerId}"`);
  }

  await prisma.$transaction([
    prisma.contact.update({
      where: { id: contact.id },
      data: { isProspectContact: false },
    }),
    prisma.contactTag.deleteMany({
      where: { contactId: contact.id, tag: PROSPECT_CONTACT_TAG },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Contact events (POST /api/contacts/[id]/events)
// ---------------------------------------------------------------------------

/** The frontend "kind" values that map 1:1 onto the Prisma ContactEventKind enum. */
const VALID_EVENT_KINDS = new Set<ContactEventKind>(["Note", "Meeting", "Email", "Call", "Custom"]);

/**
 * Pure: validates and narrows a raw event kind string to ContactEventKind,
 * falling back to "Custom" for anything unrecognized — mirrors the route's
 * own `KIND_TO_EVENT_TYPE` fallback behavior (unknown kinds map to NOTE in
 * the legacy Kissinger enum, i.e. the closest generic bucket).
 */
export function toContactEventKind(rawKind: string): ContactEventKind {
  return VALID_EVENT_KINDS.has(rawKind as ContactEventKind) ? (rawKind as ContactEventKind) : "Custom";
}

export interface DualWriteContactEventParams {
  kissingerId: string;
  kind: string;
  notes: string;
  occurredAt: string;
}

export interface CreatedContactEvent {
  id: string;
  kind: ContactEventKind;
  notes: string | null;
  occurredAt: Date;
  createdAt: Date;
}

/**
 * Creates a ContactEvent row and returns it. ContactEvent.contactId is a
 * required (non-nullable) FK, so this can only ever write for person
 * entities that exist in Postgres — org-entity events and unknown contacts
 * throw. This is now the sole write for POST /api/contacts/[id]/events, so
 * the caller needs the created row back to build its response.
 */
export async function dualWriteCreateContactEvent(
  params: DualWriteContactEventParams
): Promise<CreatedContactEvent> {
  const { kissingerId, kind, notes, occurredAt } = params;
  if (!kissingerId) {
    throw new Error("dualWriteCreateContactEvent requires kissingerId");
  }

  const contact = await prisma.contact.findUnique({
    where: { kissingerId },
    select: { id: true },
  });
  if (!contact) {
    throw new Error(`dualWriteCreateContactEvent: no Contact row for "${kissingerId}"`);
  }

  return prisma.contactEvent.create({
    data: {
      contactId: contact.id,
      kind: toContactEventKind(kind),
      notes,
      occurredAt: new Date(occurredAt),
    },
    select: { id: true, kind: true, notes: true, occurredAt: true, createdAt: true },
  });
}
