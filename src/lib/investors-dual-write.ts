/**
 * Investors pipeline-stage dual-write (Prisma Phase 3.5, GH #45).
 *
 * POST /api/investors/pipeline-stage (src/app/api/investors/pipeline-stage/
 * route.ts) currently only calls Kissinger's `updatePipelineStage(firmId,
 * stage)`, which writes `meta.pipeline_stage` on the Kissinger entity.
 * Kissinger remains the write of record during this phase — this helper
 * runs *alongside* that write (never replacing it) and mirrors the same
 * state change into `Organization.investorPipeline` +
 * `investorPipelineUpdatedAt`, resolved via `kissingerId`, following the
 * exact dual-write contract established in outreach-dual-write.ts (GH #43):
 * never throw, resolve by kissingerId, log + skip on any missing row or
 * Postgres error.
 */

import { prisma } from "@/lib/prisma";
import { pipelineStageLabelToEnum } from "@/lib/investors-read";

export interface DualWriteInvestorPipelineStageParams {
  /** Kissinger entity ID of the investor firm (Organization.kissingerId). */
  kissingerFirmId: string;
  /** UI stage label, e.g. "Warm Intro" — same strings as VALID_STAGES in the API route. */
  stageLabel: string;
}

/** Dual-write for POST /api/investors/pipeline-stage. Never throws. */
export async function dualWriteInvestorPipelineStage(
  params: DualWriteInvestorPipelineStageParams
): Promise<void> {
  const { kissingerFirmId, stageLabel } = params;

  const stageEnum = pipelineStageLabelToEnum(stageLabel);
  if (!stageEnum) {
    console.warn(
      `[investors-dual-write] Unrecognized pipeline stage label ${JSON.stringify(stageLabel)} — skipping dual-write.`
    );
    return;
  }

  let org: { id: string } | null;
  try {
    org = await prisma.organization.findUnique({
      where: { kissingerId: kissingerFirmId },
      select: { id: true },
    });
  } catch (err) {
    console.warn(
      `[investors-dual-write] Organization lookup failed for "${kissingerFirmId}":`,
      err instanceof Error ? err.message : err
    );
    return;
  }

  if (!org) {
    console.warn(
      `[investors-dual-write] No Postgres Organization row for Kissinger entity "${kissingerFirmId}" yet — skipping dual-write.`
    );
    return;
  }

  try {
    await prisma.organization.update({
      where: { id: org.id },
      data: { investorPipeline: stageEnum, investorPipelineUpdatedAt: new Date() },
    });
  } catch (err) {
    console.warn(
      "[investors-dual-write] dualWriteInvestorPipelineStage update failed:",
      err instanceof Error ? err.message : err
    );
  }
}
