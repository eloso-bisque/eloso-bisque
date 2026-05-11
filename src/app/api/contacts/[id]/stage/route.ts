import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  updateContactFunnelStage,
  FUNNEL_STAGES,
  type FunnelStage,
} from "@/lib/kissinger";

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

  if (typeof stage !== "string" || !(FUNNEL_STAGES as readonly string[]).includes(stage)) {
    return NextResponse.json(
      {
        error: "Invalid stage. Must be one of: " + FUNNEL_STAGES.join(", "),
      },
      { status: 400 }
    );
  }

  const ok = await updateContactFunnelStage(id, stage as FunnelStage);

  if (!ok) {
    return NextResponse.json(
      { error: "Failed to update contact stage" },
      { status: 500 }
    );
  }

  revalidateTag("contacts");
  revalidateTag("funnel");

  return NextResponse.json({ id, stage });
}
