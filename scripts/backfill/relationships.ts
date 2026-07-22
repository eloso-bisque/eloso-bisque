/**
 * Pure mapping functions for edges, employer resolution, queue assignment,
 * and interaction events — the parts of the backfill not already covered by
 * build-plan.ts (which handles the per-entity Organization/Contact/Signal/
 * GeneratedMessage plans). No I/O; scripts/backfill-kissinger.ts is the
 * imperative shell that executes these against Postgres.
 */

import type { KissingerEdge, KissingerInteraction } from "./kissinger-client";
import { extractRoleFromEdgeNotes, mapContactEventKind } from "./mappers";
import { RELATION_TYPES, type RelationTypeValue, type ContactEventKindValue } from "./constants";

export type EntityKind = "person" | "org";

// ---------------------------------------------------------------------------
// Edges -> RelationshipFrom
// ---------------------------------------------------------------------------

export interface RelationshipPlan {
  relationType: RelationTypeValue;
  sourceKissingerId: string;
  sourceKind: EntityKind;
  targetKissingerId: string;
  targetKind: EntityKind;
  strength: number;
  notes: string | null;
}

const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES);

/**
 * Maps a raw Kissinger edge to a RelationshipFrom plan.
 *
 * Returns `plan: null` (with a `warning`) in two cases:
 *  - The edge's relation has no corresponding RelationType enum value.
 *    Real production data includes `buys_from`, `contract_mfg_for`,
 *    `may_know`, and `supplies_to` edges (confirmed via graphStats against
 *    the live instance) that Postgres would reject outright — these are
 *    skipped and counted rather than force-mapped to a lookalike value.
 *  - Either endpoint's kind couldn't be resolved from the fetched entity
 *    set (shouldn't happen against a consistent full scan, but guarded
 *    against partial/`--limit` runs where an edge can reference an entity
 *    outside the fetched subset).
 */
export type RelationshipSkipReason = "unmapped_type" | "missing_endpoint";

export function buildRelationshipPlan(
  edge: KissingerEdge,
  kindById: ReadonlyMap<string, EntityKind>
): { plan: RelationshipPlan | null; warning?: string; reason?: RelationshipSkipReason } {
  if (!RELATION_TYPE_SET.has(edge.relation)) {
    return {
      plan: null,
      reason: "unmapped_type",
      warning: `Unmapped relation type ${JSON.stringify(edge.relation)} (no RelationType enum value); edge ${edge.source} -> ${edge.target} skipped`,
    };
  }

  const sourceKind = kindById.get(edge.source);
  const targetKind = kindById.get(edge.target);
  if (!sourceKind || !targetKind) {
    return {
      plan: null,
      reason: "missing_endpoint",
      warning: `Edge ${edge.relation} ${edge.source} -> ${edge.target} references an entity outside the fetched set (source=${sourceKind ?? "unknown"}, target=${targetKind ?? "unknown"}); skipped`,
    };
  }

  return {
    plan: {
      relationType: edge.relation as RelationTypeValue,
      sourceKissingerId: edge.source,
      sourceKind,
      targetKissingerId: edge.target,
      targetKind,
      strength: edge.strength,
      notes: edge.notes || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Contact -> Organization resolution
// ---------------------------------------------------------------------------

export interface OrgResolution {
  organizationKissingerId: string | null;
  roleAtOrg: string | null;
  orgStrength: number | null;
  source: "works_at_edge" | "meta_company_name" | null;
  warning?: string;
}

/**
 * Resolves which Organization a Contact belongs to.
 *
 * Priority: an explicit `works_at` edge (source=contact) wins. Real data has
 * a small number of contacts with more than one `works_at` edge; the
 * highest-strength edge is used, mirroring src/lib/kissinger.ts's existing
 * "highest strength wins" convention for a person's primary employer.
 *
 * Falls back to a case-insensitive match of the contact's `company`/`org`
 * meta field against known Organization names when no edge exists. This is
 * a weaker signal (no edge = no confirmed relationship in the graph), so an
 * unmatched company name is surfaced as a warning rather than silently
 * dropped — `Contact.organizationId` is left null in that case.
 */
export function resolveContactOrganization(
  worksAtEdgesFromContact: readonly KissingerEdge[],
  metaCompanyName: string | null,
  orgKissingerIdByLowerName: ReadonlyMap<string, string>
): OrgResolution {
  if (worksAtEdgesFromContact.length > 0) {
    const best = [...worksAtEdgesFromContact].sort((a, b) => b.strength - a.strength)[0];
    return {
      organizationKissingerId: best.target,
      roleAtOrg: extractRoleFromEdgeNotes(best.notes),
      orgStrength: best.strength,
      source: "works_at_edge",
    };
  }

  if (metaCompanyName) {
    const match = orgKissingerIdByLowerName.get(metaCompanyName.trim().toLowerCase());
    if (match) {
      return { organizationKissingerId: match, roleAtOrg: null, orgStrength: null, source: "meta_company_name" };
    }
    return {
      organizationKissingerId: null,
      roleAtOrg: null,
      orgStrength: null,
      source: null,
      warning: `company/org meta ${JSON.stringify(metaCompanyName)} has no works_at edge and didn't match any known Organization name; Contact.organizationId left null`,
    };
  }

  return { organizationKissingerId: null, roleAtOrg: null, orgStrength: null, source: null };
}

// ---------------------------------------------------------------------------
// Queue tags -> OutreachQueueEntry
// ---------------------------------------------------------------------------

export interface QueueEntryPlan {
  userId: string;
  isActive: boolean;
  deactivatedReason: string | null;
}

/**
 * Judgment call: the GH issue's scope (item 5) says `queue:<name>` tags map
 * to OutreachQueueEntry rows with isActive=true, but the design doc's tag
 * table (4.3) separately says `outreach-sent` -> deactivatedReason="sent".
 * Reconciled as: a queue tag always creates an entry; if `outreach-sent` is
 * also present on the same contact, the entry is created already
 * deactivated (isActive=false, deactivatedReason="sent") rather than active,
 * since a contact whose outreach was already sent is not an active queue
 * assignment. This also guarantees we never create an isActive=true row for
 * a contact whose source tags say the touch already went out.
 */
export function buildQueueEntryPlan(queueUserId: string | null, outreachSent: boolean): QueueEntryPlan | null {
  if (!queueUserId) return null;
  return {
    userId: queueUserId,
    isActive: !outreachSent,
    deactivatedReason: outreachSent ? "sent" : null,
  };
}

// ---------------------------------------------------------------------------
// Interactions -> ContactEvent
// ---------------------------------------------------------------------------

export interface ContactEventPlan {
  kind: ContactEventKindValue;
  occurredAt: string;
  subject: string | null;
  notes: string | null;
}

/**
 * Maps a raw Kissinger interaction to a ContactEvent plan.
 *
 * Judgment call: the design doc distinguishes "Trigify interaction events"
 * (-> Signal) from "non-Trigify interactions" (-> ContactEvent). Surveying
 * `interactionsForEntity` against the live instance (including contacts
 * carrying `last_signal_date`/`signal:post-engagement`) found no interaction
 * records at all for Trigify-signalled contacts — that data lives entirely
 * in Contact meta fields (already handled by buildSignalPlan). Every
 * interaction actually returned by this query was `outreach_touch_*`
 * (already mapped to `Custom` by mapContactEventKind per its own doc
 * comment). So every interaction fetched maps to a ContactEvent here; there
 * is no separate Trigify-interaction case to filter out.
 */
export function buildContactEventPlan(interaction: KissingerInteraction): ContactEventPlan {
  return {
    kind: mapContactEventKind(interaction.kind),
    occurredAt: interaction.occurredAt,
    subject: interaction.subject || null,
    notes: interaction.notes || null,
  };
}
