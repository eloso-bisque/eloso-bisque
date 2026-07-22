/**
 * Contact/Organization mutation dual-write helpers (Prisma Phase 3.3, GH #44).
 *
 * Kissinger remains the source of truth for these mutation routes during the
 * dual-write period. Every helper here runs *alongside* the existing
 * Kissinger write in its route (never replacing it) and follows the same
 * never-throw contract established in src/lib/activity-log.ts (Phase 3.1)
 * and src/lib/outreach-dual-write.ts (Phase 3.2): a Postgres outage, a
 * not-yet-backfilled row, or an unexpected error is logged and swallowed —
 * this instrumentation must never block or fail the calling route.
 *
 * Routes wired to these helpers (per GH #44 scope):
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
 *     different codebase, so there is nothing here to dual-write against.
 *   - GET /api/contacts/[id]/score: read-only. Computes a fit score on the
 *     fly from Kissinger data and returns it; it never persists anything.
 */

import { prisma } from "@/lib/prisma";
import type { ContactEventKind } from "@prisma/client";

// ---------------------------------------------------------------------------
// Create (POST /api/contacts/create, /api/contacts/bulk-create)
// ---------------------------------------------------------------------------

export interface DualWriteCreateEntityParams {
  /** The entity ID Kissinger just assigned to the newly created entity. */
  kissingerId: string;
  kind: "person" | "org";
  name: string;
  /** Only meaningful for kind="person". */
  email?: string;
  /**
   * Free-text organization name captured on the create form. This is NOT
   * resolved to an Organization row here (that would require fuzzy name
   * matching, out of scope for a dual-write instrumentation helper) — it's
   * intentionally dropped, matching the fact that Kissinger's own
   * createEntity mutation only stores it as a "company" meta value, not a
   * graph edge, so no relationship is lost by this simplification.
   */
  notes?: string;
}

/**
 * Dual-write for entity creation. Inserts a new Contact (kind="person") or
 * Organization (kind="org") row with `kissingerId` set to the ID Kissinger
 * just returned, so later dual-write/read-path code can resolve it.
 *
 * Never throws — swallows and logs any Postgres error (including a rare
 * kissingerId collision, which should not happen since Kissinger just
 * generated this ID, but a retried request could double-submit).
 */
export async function dualWriteCreateEntity(params: DualWriteCreateEntityParams): Promise<void> {
  const { kissingerId, kind, name, email, notes } = params;
  if (!kissingerId || !name) return;

  try {
    if (kind === "person") {
      await prisma.contact.create({
        data: { kissingerId, name, email: email || null, notes: notes || null },
      });
    } else {
      await prisma.organization.create({
        data: { kissingerId, name, notes: notes || null },
      });
    }
  } catch (err) {
    console.warn(
      `[contacts-dual-write] dualWriteCreateEntity failed for "${kissingerId}" (${kind}):`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Notes (PATCH /api/contacts/[id]/notes)
// ---------------------------------------------------------------------------

/**
 * Dual-write for a notes update. The route only has an entity ID, not its
 * kind (person vs org), so this tries Contact first, then Organization —
 * exactly one of the two `updateMany` calls will affect a row, since
 * kissingerId is unique per table and an entity is one or the other.
 *
 * Never throws. If neither table has a matching row (not yet backfilled),
 * this is a no-op — logged, not treated as an error.
 */
export async function dualWriteUpdateNotes(params: { kissingerId: string; notes: string }): Promise<void> {
  const { kissingerId, notes } = params;
  if (!kissingerId) return;

  try {
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
      console.warn(
        `[contacts-dual-write] dualWriteUpdateNotes: no Contact or Organization row for "${kissingerId}" yet — skipping.`
      );
    }
  } catch (err) {
    console.warn(
      `[contacts-dual-write] dualWriteUpdateNotes failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Remove prospect tag (DELETE /api/contacts/[id]/remove-prospect)
// ---------------------------------------------------------------------------

/** Tag mapping per docs/prisma-schema-design.md section 4.3: prospect-contact -> isProspectContact. */
export const PROSPECT_CONTACT_TAG = "prospect-contact";

/**
 * Dual-write for removing the "prospect-contact" tag. Clears
 * Contact.isProspectContact (the typed field the Phase 3.3 read migration
 * segments on) and removes the matching ContactTag row so tag-list displays
 * stay consistent with the typed field.
 *
 * remove-prospect only ever targets person entities (the Kissinger route
 * strips a person-only tag), so this does not attempt an Organization
 * fallback the way dualWriteUpdateNotes does.
 *
 * Never throws.
 */
export async function dualWriteRemoveProspectTag(params: { kissingerId: string }): Promise<void> {
  const { kissingerId } = params;
  if (!kissingerId) return;

  try {
    const contact = await prisma.contact.findUnique({
      where: { kissingerId },
      select: { id: true },
    });
    if (!contact) {
      console.warn(
        `[contacts-dual-write] dualWriteRemoveProspectTag: no Contact row for "${kissingerId}" yet — skipping.`
      );
      return;
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
  } catch (err) {
    console.warn(
      `[contacts-dual-write] dualWriteRemoveProspectTag failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------------------------------------------------------------------
// Contact events (POST /api/contacts/[id]/events)
// ---------------------------------------------------------------------------

/** The frontend/Kissinger event "kind" values that map 1:1 onto the Prisma ContactEventKind enum. */
const VALID_EVENT_KINDS = new Set<ContactEventKind>(["Note", "Meeting", "Email", "Call", "Custom"]);

/**
 * Pure: validates and narrows a raw event kind string to ContactEventKind,
 * falling back to "Custom" for anything unrecognized — mirrors the route's
 * own `KIND_TO_EVENT_TYPE` fallback behavior (unknown kinds map to NOTE in
 * Kissinger, i.e. the closest generic bucket).
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

/**
 * Dual-write for creating a contact event. ContactEvent.contactId is a
 * required (non-nullable) FK, so this can only ever write for person
 * entities that have already been backfilled into Postgres — org-entity
 * events and not-yet-backfilled contacts are skipped (logged), matching the
 * never-throw contract.
 */
export async function dualWriteCreateContactEvent(params: DualWriteContactEventParams): Promise<void> {
  const { kissingerId, kind, notes, occurredAt } = params;
  if (!kissingerId) return;

  try {
    const contact = await prisma.contact.findUnique({
      where: { kissingerId },
      select: { id: true },
    });
    if (!contact) {
      console.warn(
        `[contacts-dual-write] dualWriteCreateContactEvent: no Contact row for "${kissingerId}" yet — skipping.`
      );
      return;
    }

    await prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        kind: toContactEventKind(kind),
        notes,
        occurredAt: new Date(occurredAt),
      },
    });
  } catch (err) {
    console.warn(
      `[contacts-dual-write] dualWriteCreateContactEvent failed for "${kissingerId}":`,
      err instanceof Error ? err.message : err
    );
  }
}
