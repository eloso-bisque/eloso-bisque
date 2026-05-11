/**
 * POST /api/outreach/skip
 *
 * Skips a prospect contact by:
 *   1. Removing "prospect-contact" tag (removes them from the outreach list)
 *   2. Adding "prospect-skipped" tag (prevents reload-tasks from re-adding them)
 *
 * Request body (JSON):
 * { entityId: string }
 *
 * Response:
 * { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const COOKIE_NAME = "eloso_session";

/** Minimal GraphQL helper (no Next.js caching — mutations bypass cache). */
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

export async function POST(request: NextRequest) {
  // Auth: valid session cookie OR internal secret.
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

  const { entityId } = body as { entityId?: string };

  if (!entityId || typeof entityId !== "string") {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  try {
    // Fetch current tags
    const entityData = await gqlMutate<{
      entity: { tags: string[] };
    }>(ENTITY_TAGS_QUERY, { id: entityId });

    const currentTags = entityData.entity?.tags ?? [];

    // Remove prospect-contact, add prospect-skipped (if not already present)
    const newTags = [
      ...currentTags.filter((t) => t !== "prospect-contact"),
      ...(currentTags.includes("prospect-skipped") ? [] : ["prospect-skipped"]),
    ];

    await gqlMutate(UPDATE_ENTITY_TAGS_MUTATION, {
      id: entityId,
      input: { tags: newTags },
    });

    // Bust the contacts cache so the outreach page reloads fresh data
    revalidateTag("contacts");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[outreach/skip] Failed to skip prospect:", msg);
    return NextResponse.json(
      { error: "Failed to skip prospect" },
      { status: 500 }
    );
  }
}
