/**
 * Investors pipeline-stage write path (Prisma Phase 3.5, GH #45; cut over to
 * Postgres-only in the Kissinger live-path disconnect).
 *
 * POST /api/investors/pipeline-stage used to call Kissinger's
 * `updatePipelineStage(firmId, stage)` (writing `meta.pipeline_stage` on the
 * Kissinger entity) alongside this helper. That Kissinger call has been
 * removed from the route — Postgres (`Organization.investorPipeline` +
 * `investorPipelineUpdatedAt`, resolved via `kissingerId`) is now the sole
 * write, so this throws on any missing row or Postgres error instead of
 * swallowing it.
 */

import { prisma } from "@/lib/prisma";
import { pipelineStageLabelToEnum } from "@/lib/investors-read";

export interface DualWriteInvestorPipelineStageParams {
  /** Kissinger entity ID of the investor firm (Organization.kissingerId). */
  kissingerFirmId: string;
  /** UI stage label, e.g. "Warm Intro" — same strings as VALID_STAGES in the API route. */
  stageLabel: string;
}

/**
 * Writes the investor pipeline stage. Throws for an unrecognized stage
 * label, a missing Organization row, or any Postgres error — this is the
 * sole write for POST /api/investors/pipeline-stage.
 */
export async function dualWriteInvestorPipelineStage(
  params: DualWriteInvestorPipelineStageParams
): Promise<void> {
  const { kissingerFirmId, stageLabel } = params;

  const stageEnum = pipelineStageLabelToEnum(stageLabel);
  if (!stageEnum) {
    throw new Error(`Unrecognized pipeline stage label ${JSON.stringify(stageLabel)}`);
  }

  const org = await prisma.organization.findUnique({
    where: { kissingerId: kissingerFirmId },
    select: { id: true },
  });

  if (!org) {
    throw new Error(`No Postgres Organization row for entity "${kissingerFirmId}"`);
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { investorPipeline: stageEnum, investorPipelineUpdatedAt: new Date() },
  });
}
