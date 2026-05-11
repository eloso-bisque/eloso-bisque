/**
 * POST /api/signals/snooze
 *
 * Snoozes a prospect's LinkedIn signal for a given number of days (default 7).
 * Writes signal_snoozed_until: <ISO date> to entity meta via mergeEntityMeta.
 * The contact will be hidden from the Signals tab until the snooze period expires.
 *
 * Request body (JSON):
 * { personId: string, days?: number }
 *
 * Response:
 * { ok: true, snoozedUntil: string }
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

  const { personId, days = 7 } = body as { personId?: string; days?: number };

  if (!personId || typeof personId !== "string") {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  const snoozedays = typeof days === "number" && days > 0 ? days : 7;
  const snoozedUntil = new Date(
    Date.now() + snoozedays * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    await mergeEntityMeta(personId, { signal_snoozed_until: snoozedUntil });
    // Invalidate the contacts cache so the Signals tab reflects the change
    revalidateTag("contacts");
    return NextResponse.json({ ok: true, snoozedUntil });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[signals/snooze] Failed:", msg);
    return NextResponse.json({ error: "Failed to snooze signal" }, { status: 500 });
  }
}
