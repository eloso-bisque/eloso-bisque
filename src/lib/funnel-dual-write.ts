/**
 * Funnel stage dual-write (Prisma Phase 3.6, GH #46).
 *
 * PATCH /api/contacts/[id]/stage (src/app/api/contacts/[id]/stage/route.ts)
 * currently only calls Kissinger's `updateContactFunnelStage(id, stage)`,
 * which merge-writes `meta.funnel_stage` on the Kissinger entity. Kissinger
 * remains the write of record during this phase — this helper runs
 * *alongside* that write (never replacing it) and mirrors the same state
 * change into `Organization.funnelStage` + `funnelStageUpdatedAt`, resolved
 * via `kissingerId`, following the exact dual-write contract established in
 * outreach-dual-write.ts (GH #43) and investors-dual-write.ts (GH #45):
 * never throw, resolve by kissingerId, log + skip on any missing row or
 * Postgres error.
 *
 * Note: as of GH #46 the Funnel Kanban board tracks Organizations, not
 * Contacts (see src/lib/funnel-read.ts's module doc for the data-backed
 * reasoning) — `id` here is an Organization's `kissingerId`, even though
 * the route path is still `/api/contacts/[id]/stage` (unchanged, since
 * that path already treats `[id]` as a generic Kissinger entity id
 * elsewhere in this app, e.g. `/contacts/[id]` serving both person and org
 * detail pages).
 */

import { prisma } from "@/lib/prisma";
import { funnelStageLabelToEnum } from "@/lib/funnel-stage";

export interface DualWriteFunnelStageParams {
  /** Kissinger entity ID of the prospect org (Organization.kissingerId). */
  kissingerOrgId: string;
  /** UI stage label, e.g. "Meeting Booked" — same strings as FUNNEL_STAGES. */
  stageLabel: string;
}

/** Dual-write for PATCH /api/contacts/[id]/stage. Never throws. */
export async function dualWriteFunnelStage(params: DualWriteFunnelStageParams): Promise<void> {
  const { kissingerOrgId, stageLabel } = params;

  const stageEnum = funnelStageLabelToEnum(stageLabel);
  if (!stageEnum) {
    console.warn(
      `[funnel-dual-write] Unrecognized funnel stage label ${JSON.stringify(stageLabel)} — skipping dual-write.`
    );
    return;
  }

  let org: { id: string } | null;
  try {
    org = await prisma.organization.findUnique({
      where: { kissingerId: kissingerOrgId },
      select: { id: true },
    });
  } catch (err) {
    console.warn(
      `[funnel-dual-write] Organization lookup failed for "${kissingerOrgId}":`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  if (!org) {
    console.warn(
      `[funnel-dual-write] No Postgres Organization row for Kissinger entity "${kissingerOrgId}" yet — skipping dual-write.`
    );
    return;
  }

  try {
    await prisma.organization.update({
      where: { id: org.id },
      data: { funnelStage: stageEnum, funnelStageUpdatedAt: new Date() },
    });
  } catch (err) {
    console.warn(
      "[funnel-dual-write] dualWriteFunnelStage update failed:",
      err instanceof Error ? err.message : err
    );
  }
}
