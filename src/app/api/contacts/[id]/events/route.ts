import { NextRequest, NextResponse } from "next/server";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const CREATE_CONTACT_EVENT_MUTATION = `
  mutation CreateContactEvent($personId: ID!, $kind: ContactEventKind!, $notes: String!, $occurredAt: String!) {
    createContactEvent(personId: $personId, kind: $kind, notes: $notes, occurredAt: $occurredAt) {
      id
      personId
      kind
      notes
      occurredAt
      createdAt
    }
  }
`;

const CONTACT_EVENTS_QUERY = `
  query ContactEvents($personId: ID!) {
    contactEvents(personId: $personId) {
      id
      personId
      kind
      notes
      occurredAt
      createdAt
    }
  }
`;

async function gqlRequest(query: string, variables: Record<string, unknown>) {
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

// GET /api/contacts/[id]/events — list events for a contact
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing contact id" }, { status: 400 });
  }

  try {
    const data = (await gqlRequest(CONTACT_EVENTS_QUERY, {
      personId: decodeURIComponent(id),
    })) as { contactEvents: unknown[] };
    return NextResponse.json({ events: data.contactEvents ?? [] });
  } catch (err) {
    console.error("Failed to fetch contact events:", err);
    return NextResponse.json(
      { error: "Failed to fetch events." },
      { status: 500 }
    );
  }
}

// POST /api/contacts/[id]/events — create a new event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing contact id" }, { status: 400 });
  }

  let body: { kind: string; notes: string; occurredAt: string };
  try {
    body = (await request.json()) as { kind: string; notes: string; occurredAt: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { kind, notes, occurredAt } = body;
  if (!kind || typeof notes !== "string" || !occurredAt) {
    return NextResponse.json(
      { error: "kind, notes, and occurredAt are required" },
      { status: 400 }
    );
  }

  try {
    const data = (await gqlRequest(CREATE_CONTACT_EVENT_MUTATION, {
      personId: decodeURIComponent(id),
      kind,
      notes,
      occurredAt,
    })) as { createContactEvent: unknown };
    return NextResponse.json({ event: data.createContactEvent }, { status: 201 });
  } catch (err) {
    console.error("Failed to create contact event:", err);
    return NextResponse.json(
      { error: "Failed to create event. Please try again." },
      { status: 500 }
    );
  }
}
