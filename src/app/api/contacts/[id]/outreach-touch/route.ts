import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { recordOutreachTouch } from "@/lib/kissinger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const touchNumber = (body as Record<string, unknown>)?.touchNumber;
  const notes = (body as Record<string, unknown>)?.notes;

  if (typeof touchNumber !== "number" || ![1, 2, 3].includes(touchNumber)) {
    return NextResponse.json(
      { error: "touchNumber must be 1, 2, or 3" },
      { status: 400 }
    );
  }

  if (notes !== undefined && typeof notes !== "string") {
    return NextResponse.json(
      { error: "notes must be a string if provided" },
      { status: 400 }
    );
  }

  const result = await recordOutreachTouch(
    id,
    touchNumber,
    typeof notes === "string" ? notes : undefined
  );

  if (!result) {
    return NextResponse.json(
      { error: "Failed to record outreach touch — check Kissinger logs" },
      { status: 500 }
    );
  }

  revalidateTag("contacts");

  return NextResponse.json({
    success: true,
    interactionId: result.interactionId,
    newStage: result.newStage,
  });
}
