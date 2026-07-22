import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { revalidateTag } from "next/cache";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { recordOutreachTouch } from "@/lib/kissinger";
import { logActivityEvent } from "@/lib/activity-log";
import { dualWriteMarkSent } from "@/lib/outreach-dual-write";

/** Map from login email to lowercase team member name (mirrors new-batch/route.ts). */
const EMAIL_TO_ASSIGNEE: Record<string, string> = {
  "drew@eloso.ai": "drew",
  "ben@eloso.ai": "ben",
  "jake@eloso.ai": "jake",
};

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const ENTITY_TAGS_QUERY = `
  query EntityTags($id: String!) {
    entity(id: $id) {
      tags
    }
  }
`;

const UPDATE_ENTITY_TAGS_MUTATION = `
  mutation UpdateEntityTags($id: String!, $input: UpdateEntityInput!) {
    updateEntity(id: $id, input: $input) {
      id
      tags
    }
  }
`;

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
    signal: AbortSignal.timeout(8000),
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

/**
 * Remove prospect-contact tag and add outreach-sent tag.
 * This permanently moves the contact out of the outreach queue.
 * Non-blocking — errors are logged but do not fail the touch.
 */
async function promoteToSent(entityId: string): Promise<void> {
  const entityData = await gqlMutate<{ entity: { tags: string[] } }>(
    ENTITY_TAGS_QUERY,
    { id: entityId }
  );
  const currentTags = entityData.entity?.tags ?? [];
  const newTags = [
    ...currentTags.filter((t) => t !== "prospect-contact"),
    ...(currentTags.includes("outreach-sent") ? [] : ["outreach-sent"]),
  ];
  await gqlMutate(UPDATE_ENTITY_TAGS_MUTATION, {
    id: entityId,
    input: { tags: newTags },
  });
}

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

  let result: { interactionId: string; newStage: string };
  try {
    result = await recordOutreachTouch(
      id,
      touchNumber,
      typeof notes === "string" ? notes : undefined
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[outreach-touch] recordOutreachTouch failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Remove prospect-contact tag and add outreach-sent tag so this contact
  // permanently leaves the outreach queue (tag-based truth, not meta filtering).
  try {
    await promoteToSent(id);
  } catch (tagErr) {
    // Non-critical — log but don't fail the touch
    const tagMsg = tagErr instanceof Error ? tagErr.message : String(tagErr);
    console.warn("[outreach-touch] promoteToSent failed (non-fatal):", tagMsg);
  }

  revalidateTag("contacts");

  // Track outreach sent activity — extract email from JWT session cookie
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (token) {
      const session = await verifyToken(token);
      if (session?.email) {
        const today = new Date().toISOString().split('T')[0];
        const sentKey = `activity:outreach_sent:${session.email}:${today}`;
        await kv.incr(sentKey);
        await kv.expire(sentKey, 90 * 24 * 3600);
        await kv.incr(`activity:outreach_sent_total:${session.email}`);

        // Dual-write to Postgres ActivityLog (Prisma Phase 3.1 migration).
        // logActivityEvent never throws — KV remains the source of truth
        // until the Activity Dashboard cutover has been stable for a while.
        await logActivityEvent({
          email: session.email,
          eventType: "OutreachTouchSent",
          contactId: id,
        });

        // Dual-write to Postgres OutreachTouch + Contact/OutreachQueueEntry
        // stage advance (Prisma Phase 3.2). Never throws — Kissinger's
        // recordOutreachTouch above is the write of record.
        const assigneeLower = EMAIL_TO_ASSIGNEE[session.email.toLowerCase()];
        if (assigneeLower) {
          await dualWriteMarkSent({
            kissingerContactId: id,
            touchNumber,
            assigneeLower,
          });
        }
      }
    }
  } catch (trackErr) {
    // Non-critical — don't fail the touch if tracking fails
    console.warn('[outreach-touch] Activity tracking failed:', trackErr);
  }

  return NextResponse.json({
    success: true,
    interactionId: result.interactionId,
    newStage: result.newStage,
  });
}
