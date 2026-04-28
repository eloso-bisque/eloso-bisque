/**
 * POST /api/outreach/feedback
 *
 * Records thumbs up/down feedback on a prospect contact.
 * Feedback is stored as meta fields on the Kissinger person entity:
 *   - feedback_thumb: "up" | "down"
 *   - feedback_text: string (optional)
 *   - feedback_date: ISO timestamp
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

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const COOKIE_NAME = "eloso_session";
const SESSION_VALUE = "authenticated";

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

export async function POST(request: NextRequest) {
  // Auth: valid session cookie OR internal secret
  const internalSecret = process.env.LOBSTER_INTERNAL_SECRET;
  const providedSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall =
    internalSecret && providedSecret && providedSecret === internalSecret;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .some((c) => c === `${COOKIE_NAME}=${SESSION_VALUE}`);

  if (!isInternalCall && !hasSessionCookie) {
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
