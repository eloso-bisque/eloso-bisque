/**
 * POST /api/outreach/feedback
 *
 * Records thumbs up/down feedback on a prospect contact.
 * Feedback is stored as meta fields on the Kissinger person entity:
 *   - feedback_thumb: "up" | "down"
 *   - feedback_text: string (optional)
 *   - feedback_date: ISO timestamp
 * Kissinger remains the operation of record for this route (the Outreach
 * subsystem is one of the pieces deliberately left on Kissinger by the PR #53
 * dual-write disconnect). Alongside it, this now also dual-writes a first-class
 * `OutreachFeedback` row in Postgres (see prisma/schema.prisma) so the full
 * vote history is queryable directly instead of being overwritten on every
 * subsequent vote — see dualWriteOutreachFeedback's doc comment in
 * src/lib/outreach-dual-write.ts. Never blocks or fails this request: same
 * never-throw contract as every other dual-write helper in that file.
 *
 * Request body (JSON):
 * {
 *   entityId: string,
 *   thumb: "up" | "down",
 *   text?: string
 * }
 *
 * Response:
 * { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { dualWriteOutreachFeedback } from "@/lib/outreach-dual-write";

/** Map from login email to lowercase team member name (mirrors new-batch/route.ts and outreach-response/route.ts). */
const EMAIL_TO_ASSIGNEE: Record<string, string> = {
  "drew@eloso.ai": "drew",
  "ben@eloso.ai": "ben",
  "jake@eloso.ai": "jake",
};

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const COOKIE_NAME = "eloso_session";

/** Minimal GraphQL mutation helper (no Next.js caching — mutations bypass cache). */
async function gqlMutate<T = unknown>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (KISSINGER_API_TOKEN) {
    headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  }

  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Kissinger request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

const ENTITY_META_QUERY = `
  query EntityMeta($id: String!) {
    entity(id: $id) {
      meta { key value }
    }
  }
`;

const UPDATE_ENTITY_MUTATION = `
  mutation UpdateEntityMeta($id: String!, $input: UpdateEntityInput!) {
    updateEntity(id: $id, input: $input) {
      id
      meta { key value }
    }
  }
`;

const CREATE_CONTACT_EVENT_MUTATION = `
  mutation CreateContactEvent($input: CreateContactEventInput!) {
    createContactEvent(input: $input) {
      id
      entityId
      eventType
      summary
      occurredAt
      createdBy
      createdAt
    }
  }
`;

export async function POST(request: NextRequest) {
  // Auth: valid session cookie OR internal secret.
  // The middleware validates the JWT before the request reaches here;
  // we just need to confirm the session cookie is present.
  const internalSecret = process.env.LOBSTER_INTERNAL_SECRET;
  const providedSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall =
    internalSecret && providedSecret && providedSecret === internalSecret;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieParts = cookieHeader.split(";").map((c) => c.trim());
  // Extracted (not just checked for presence) so the dual-write block below
  // can decode it to attribute loggedBy — mirrors new-batch/route.ts.
  const sessionCookieValue = cookieParts
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!isInternalCall && !sessionCookieValue) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entityId, thumb, text } = body as {
    entityId?: string;
    thumb?: string;
    text?: string;
  };

  if (!entityId || typeof entityId !== "string") {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  if (thumb !== "up" && thumb !== "down") {
    return NextResponse.json(
      { error: "thumb must be 'up' or 'down'" },
      { status: 400 }
    );
  }

  if (text !== undefined && typeof text !== "string") {
    return NextResponse.json(
      { error: "text must be a string if provided" },
      { status: 400 }
    );
  }

  try {
    // Fetch current meta to merge (updateEntity replaces meta entirely)
    const entityData = await gqlMutate<{
      entity: { meta: { key: string; value: string }[] };
    }>(ENTITY_META_QUERY, { id: entityId });

    const existingMeta = entityData.entity?.meta ?? [];

    // Remove any existing feedback fields before re-adding
    const filteredMeta = existingMeta.filter(
      (m) =>
        m.key !== "feedback_thumb" &&
        m.key !== "feedback_text" &&
        m.key !== "feedback_date"
    );

    const now = new Date().toISOString();

    const newMeta = [
      ...filteredMeta,
      { key: "feedback_thumb", value: thumb },
      { key: "feedback_date", value: now },
      ...(text ? [{ key: "feedback_text", value: text }] : []),
    ];

    await gqlMutate(UPDATE_ENTITY_MUTATION, {
      id: entityId,
      input: { meta: newMeta },
    });

    // Also create a contact event so the full vote history is preserved in the
    // event log even if meta is later overwritten by a subsequent vote.
    const eventSummary = text
      ? `Feedback: thumbs ${thumb} — ${text}`
      : `Feedback: thumbs ${thumb}`;
    try {
      await gqlMutate(CREATE_CONTACT_EVENT_MUTATION, {
        input: {
          entityId,
          eventType: "NOTE",
          summary: eventSummary,
          occurredAt: now,
          createdBy: "bisque-feedback",
        },
      });
    } catch (eventErr) {
      // Event creation is non-critical — log but don't fail the request.
      const eventMsg = eventErr instanceof Error ? eventErr.message : String(eventErr);
      console.warn("[outreach/feedback] Contact event creation failed (non-fatal):", eventMsg);
    }

    // Dual-write to Postgres OutreachFeedback (see module doc comment above).
    // Kissinger (above) is the write of record for this route; loggedBy is
    // attributed from the session cookie when present, null (system-logged)
    // when it's an internal call or an unrecognized team member.
    try {
      const session = sessionCookieValue ? await verifyToken(sessionCookieValue) : null;
      const assigneeLower = session?.email ? EMAIL_TO_ASSIGNEE[session.email.toLowerCase()] ?? null : null;
      await dualWriteOutreachFeedback({
        kissingerContactId: entityId,
        thumb,
        text,
        assigneeLower,
      });
    } catch (dualWriteErr) {
      console.warn("[outreach/feedback] Dual-write failed (non-fatal):", dualWriteErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[outreach/feedback] Failed to record feedback:", msg);
    return NextResponse.json(
      { error: "Failed to record feedback" },
      { status: 500 }
    );
  }
}
