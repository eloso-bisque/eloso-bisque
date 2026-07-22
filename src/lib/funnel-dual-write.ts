/**
 * Funnel stage write path (Prisma Phase 3.6, GH #46; cut over to
 * Postgres-only in the Kissinger live-path disconnect).
 *
 * PATCH /api/contacts/[id]/stage used to call Kissinger's
 * `updateContactFunnelStage(id, stage)` (merge-writing `meta.funnel_stage`
 * on the Kissinger entity) alongside this helper. That Kissinger call has
 * been removed from the route — Postgres (`Organization.funnelStage` +
 * `funnelStageUpdatedAt`, resolved via `kissingerId`) is now the sole write,
 * so this throws on any missing row or Postgres error instead of swallowing
 * it.
 *
 * Note: as of GH #46 the Funnel Kanban board tracks Organizations, not
 * Contacts (see src/lib/funnel-read.ts's module doc for the data-backed
 * reasoning) — `id` here is an Organization's `kissingerId`, even though
 * the route path is still `/api/contacts/[id]/stage` (unchanged, since
 * that path already treats `[id]` as a generic entity id elsewhere in this
 * app, e.g. `/contacts/[id]` serving both person and org detail pages).
 */

import { prisma } from "@/lib/prisma";
import { funnelStageLabelToEnum } from "@/lib/funnel-stage";

export interface DualWriteFunnelStageParams {
  /** Organization.kissingerId of the prospect org. */
  kissingerOrgId: string;
  /** UI stage label, e.g. "Meeting Booked" — same strings as FUNNEL_STAGE_LABELS. */
  stageLabel: string;
}

/**
 * Writes the funnel stage. Throws for an unrecognized stage label, a
 * missing Organization row, or any Postgres error — this is the sole write
 * for PATCH /api/contacts/[id]/stage.
 */
export async function dualWriteFunnelStage(params: DualWriteFunnelStageParams): Promise<void> {
  const { kissingerOrgId, stageLabel } = params;

  const stageEnum = funnelStageLabelToEnum(stageLabel);
  if (!stageEnum) {
    throw new Error(`Unrecognized funnel stage label ${JSON.stringify(stageLabel)}`);
  }

  const org = await prisma.organization.findUnique({
    where: { kissingerId: kissingerOrgId },
    select: { id: true },
  });

  if (!org) {
    throw new Error(`No Postgres Organization row for entity "${kissingerOrgId}"`);
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { funnelStage: stageEnum, funnelStageUpdatedAt: new Date() },
  });
}
