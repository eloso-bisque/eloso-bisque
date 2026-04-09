import { NextRequest, NextResponse } from "next/server";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const UPDATE_ENTITY_NOTES_MUTATION = `
  mutation UpdateEntityNotes($id: String!, $input: UpdateEntityInput!) {
    updateEntity(id: $id, input: $input) {
      id
      notes
      updatedAt
    }
  }
`;

async function gqlMutate(query: string, variables: Record<string, unknown>) {
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

  const json = (await res.json()) as { data?: unknown; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing entity id" }, { status: 400 });
  }

  let body: { notes: string };
  try {
    body = (await request.json()) as { notes: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
  }

  try {
    await gqlMutate(UPDATE_ENTITY_NOTES_MUTATION, {
      id: decodeURIComponent(id),
      input: { notes: body.notes },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update notes:", err);
    return NextResponse.json(
      { error: "Failed to save notes. Please try again." },
      { status: 500 }
    );
  }
}
