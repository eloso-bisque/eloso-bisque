import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { dualWriteRemoveProspectTag } from "@/lib/contacts-dual-write";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

async function kissingerGql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
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
    signal: AbortSignal.timeout(8000),
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
      id
      tags
    }
  }
`;

const UPDATE_ENTITY_MUTATION = `
  mutation UpdateEntityTags($id: String!, $input: UpdateEntityInput!) {
    updateEntity(id: $id, input: $input) {
      id
      tags
    }
  }
`;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/contacts/[id]/remove-prospect
 *
 * Removes the "prospect-contact" tag from the entity, effectively removing
 * the contact from the outreach prospect list.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // Fetch current tags so we can remove only the prospect-contact tag
  let currentTags: string[];
  try {
    const data = await kissingerGql<{ entity: { id: string; tags: string[] } }>(
      ENTITY_TAGS_QUERY,
      { id }
    );
    currentTags = data.entity.tags;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[remove-prospect] Failed to fetch entity tags:", msg);
    return NextResponse.json({ error: "Failed to fetch contact" }, { status: 500 });
  }

  const updatedTags = currentTags.filter((t) => t !== "prospect-contact");

  if (updatedTags.length === currentTags.length) {
    // Tag wasn't present — treat as success (idempotent)
    return NextResponse.json({ success: true, tags: updatedTags });
  }

  try {
    await kissingerGql(UPDATE_ENTITY_MUTATION, {
      id,
      input: { tags: updatedTags },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[remove-prospect] Failed to update entity tags:", msg);
    return NextResponse.json({ error: "Failed to remove contact" }, { status: 500 });
  }

  // Dual-write to Postgres (Prisma Phase 3.3, GH #44) — never blocks or
  // fails this request; Kissinger above is the operation of record.
  await dualWriteRemoveProspectTag({ kissingerId: id });

  revalidateTag("contacts");

  return NextResponse.json({ success: true, tags: updatedTags });
}
