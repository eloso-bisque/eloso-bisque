/**
 * POST /api/investors/pipeline-stage
 *
 * Update the fundraising pipeline stage for an investor firm.
 * Stage is stored as meta.pipeline_stage on the entity.
 *
 * Body: { firmId: string, stage: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { updatePipelineStage } from "@/lib/kissinger";

const VALID_STAGES = new Set([
  "Research",
  "Warm Intro",
  "First Meeting",
  "Partner Meeting",
  "Term Sheet",
  "Closed",
  "Passed",
]);

export async function POST(request: NextRequest) {
  let body: { firmId?: string; stage?: string };
  try {
    body = (await request.json()) as { firmId?: string; stage?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { firmId, stage } = body;

  if (!firmId || typeof firmId !== "string") {
    return NextResponse.json({ error: "firmId is required" }, { status: 400 });
  }
  if (!stage || !VALID_STAGES.has(stage)) {
    return NextResponse.json(
      { error: `stage must be one of: ${[...VALID_STAGES].join(", ")}` },
      { status: 400 }
    );
  }

  const ok = await updatePipelineStage(firmId, stage);
  if (!ok) {
    return NextResponse.json({ error: "Failed to update stage" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, firmId, stage });
}
