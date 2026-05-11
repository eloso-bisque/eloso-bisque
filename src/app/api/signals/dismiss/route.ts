/**
 * POST /api/signals/dismiss
 *
 * Marks a prospect's LinkedIn signal as dismissed ("Not Relevant").
 * Writes signal_dismissed: "true" to entity meta via mergeEntityMeta.
 * The contact will no longer appear in the Signals tab.
 *
 * Request body (JSON):
 * { personId: string }
 *
 * Response:
 * { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { mergeEntityMeta } from "@/lib/kissinger";

const COOKIE_NAME = "eloso_session";

export async function POST(request: NextRequest) {
  // Auth: valid session cookie OR internal secret header.
  // The middleware validates the JWT before the request reaches here;
  // we just need to confirm the session cookie is present.
  const internalSecret = process.env.LOBSTER_INTERNAL_SECRET;
  const providedSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall =
    internalSecret && providedSecret && providedSecret === internalSecret;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith(`${COOKIE_NAME}=`));

  if (!isInternalCall && !hasSessionCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { personId } = body as { personId?: string };

  if (!personId || typeof personId !== "string") {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  try {
    await mergeEntityMeta(personId, { signal_dismissed: "true" });
    // Invalidate the contacts cache so the Signals tab reflects the change
    revalidateTag("contacts");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[signals/dismiss] Failed:", msg);
    return NextResponse.json({ error: "Failed to dismiss signal" }, { status: 500 });
  }
}
