import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { recordOutreachResponse, type ResponseType } from "@/lib/kissinger";

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
 * Non-blocking — errors are logged but do not fail the response recording.
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

  // Remove prospect-contact tag and add outreach-sent tag so this contact
  // permanently leaves the outreach queue (tag-based truth, not meta filtering).
  try {
    await promoteToSent(id);
  } catch (tagErr) {
    // Non-critical — log but don't fail the response recording
    const tagMsg = tagErr instanceof Error ? tagErr.message : String(tagErr);
    console.warn("[outreach-response] promoteToSent failed (non-fatal):", tagMsg);
  }

  revalidateTag("contacts");

  return NextResponse.json({
    success: true,
    interactionId: result.interactionId,
    responseType: result.responseType,
  });
}
