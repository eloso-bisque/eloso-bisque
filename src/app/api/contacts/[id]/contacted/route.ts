import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  updateContactFunnelStage,
  logLinkedInOutreach,
} from "@/lib/kissinger";

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

  const message = (body as Record<string, unknown>)?.message;

  if (typeof message !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'message' field" },
      { status: 400 }
    );
  }

  const occurredAt = new Date().toISOString();

  const stageOk = await updateContactFunnelStage(id, "Contacted");

  if (!stageOk) {
    return NextResponse.json(
      { error: "Failed to update contact stage" },
      { status: 500 }
    );
  }

  // Log the LinkedIn interaction (non-fatal if it fails)
  await logLinkedInOutreach(id, message, occurredAt);

  revalidateTag("contacts");
  revalidateTag("funnel");

  return NextResponse.json({ success: true });
}
