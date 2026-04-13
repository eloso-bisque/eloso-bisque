import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { recordOutreachResponse, type ResponseType } from "@/lib/kissinger";

const VALID_RESPONSE_TYPES: ResponseType[] = [
  "Interested",
  "NotNow",
  "WrongPerson",
  "NoReply",
  "Bounced",
];

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

  const responseType = (body as Record<string, unknown>)?.responseType;
  const notes = (body as Record<string, unknown>)?.notes;

  if (
    typeof responseType !== "string" ||
    !VALID_RESPONSE_TYPES.includes(responseType as ResponseType)
  ) {
    return NextResponse.json(
      {
        error: `responseType must be one of: ${VALID_RESPONSE_TYPES.join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (notes !== undefined && typeof notes !== "string") {
    return NextResponse.json(
      { error: "notes must be a string if provided" },
      { status: 400 }
    );
  }

  const result = await recordOutreachResponse(
    id,
    responseType as ResponseType,
    typeof notes === "string" ? notes : undefined
  );

  if (!result) {
    return NextResponse.json(
      { error: "Failed to record outreach response — check Kissinger logs" },
      { status: 500 }
    );
  }

  revalidateTag("contacts");

  return NextResponse.json({
    success: true,
    interactionId: result.interactionId,
    responseType: result.responseType,
  });
}
