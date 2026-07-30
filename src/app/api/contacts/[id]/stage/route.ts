import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { FUNNEL_STAGE_LABELS } from "@/lib/funnel-stage";
import { dualWriteFunnelStage } from "@/lib/funnel-dual-write";

const VALID_STAGES = new Set(Object.values(FUNNEL_STAGE_LABELS));

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const stage = (body as Record<string, unknown>)?.stage;

  if (typeof stage !== "string" || !VALID_STAGES.has(stage)) {
    return NextResponse.json(
      { error: "Invalid stage. Must be one of: " + [...VALID_STAGES].join(", ") },
      { status: 400 }
    );
  }

  try {
    // Postgres is the sole write for funnel stage updates (Kissinger
    // disconnected from the live path — see src/lib/funnel-dual-write.ts's
    // module doc). `id` is an Organization's kissingerId as of GH #46.
    await dualWriteFunnelStage({ kissingerOrgId: id, stageLabel: stage });
  } catch (err) {
    console.error("Failed to update funnel stage:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Failed to update contact stage" },
      { status: 500 }
    );
  }

  // Outside the write's try/catch: the Postgres write already succeeded, so
  // a revalidation failure must never turn a successful update into an
  // error response for the caller.
  try {
    revalidateTag("contacts");
    revalidateTag("funnel");
  } catch (err) {
    console.error("Stage updated, but cache revalidation failed (non-fatal):", err);
  }

  return NextResponse.json({ id, stage });
}
