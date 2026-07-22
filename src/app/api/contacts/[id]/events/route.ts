import { NextRequest, NextResponse } from "next/server";
import { dualWriteCreateContactEvent } from "@/lib/contacts-dual-write";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

// Kissinger uses CreateContactEventInput with entityId + eventType + summary.
// The eventType enum values are: CALL, EMAIL, MEETING, LINKEDIN_MESSAGE,
// LINKEDIN_VIEW, NOTE, INTRO, FOLLOW_UP, DEMO, PROPOSAL.
// We map the legacy frontend "kind" field to the closest enum value.
const KIND_TO_EVENT_TYPE: Record<string, string> = {
  Note: "NOTE",
  Meeting: "MEETING",
  Email: "EMAIL",
  Call: "CALL",
  Custom: "NOTE",
};

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

// contactEventsForEntity is the correct Kissinger query (not contactEvents).
const CONTACT_EVENTS_QUERY = `
  query ContactEventsForEntity($entityId: String!) {
    contactEventsForEntity(entityId: $entityId) {
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
      entityId: decodeURIComponent(id),
    })) as { contactEventsForEntity: unknown[] };
    // Normalise to the shape the frontend ContactEventsTab expects:
    // { id, personId, kind, notes, occurredAt, createdAt }
    const raw = data.contactEventsForEntity ?? [];
    const events = (raw as Array<Record<string, unknown>>).map((e) => ({
      id: e.id,
      personId: e.entityId,
      kind: _eventTypeToKind(String(e.eventType ?? "NOTE")),
      notes: String(e.summary ?? ""),
      occurredAt: e.occurredAt,
      createdAt: e.createdAt,
      // Extra fields for Signals filtering (not used by ContactEventsTab directly)
      createdBy: e.createdBy,
      eventType: e.eventType,
    }));
    return NextResponse.json({ events });
  } catch (err) {
    console.error("Failed to fetch contact events:", err);
    return NextResponse.json(
      { error: "Failed to fetch events." },
      { status: 500 }
    );
  }
}

/** Map Kissinger eventType enum -> ContactEventsTab kind string. */
function _eventTypeToKind(eventType: string): string {
  const map: Record<string, string> = {
    NOTE: "Note",
    MEETING: "Meeting",
    EMAIL: "Email",
    CALL: "Call",
    INTRO: "Custom",
    FOLLOW_UP: "Note",
    DEMO: "Meeting",
    PROPOSAL: "Custom",
    LINKEDIN_MESSAGE: "Custom",
    LINKEDIN_VIEW: "Custom",
  };
  return map[eventType] ?? "Custom";
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

  const eventType = KIND_TO_EVENT_TYPE[kind] ?? "NOTE";
  const decodedId = decodeURIComponent(id);

  try {
    const data = (await gqlRequest(CREATE_CONTACT_EVENT_MUTATION, {
      input: {
        entityId: decodedId,
        eventType,
        summary: notes,
        occurredAt,
      },
    })) as { createContactEvent: Record<string, unknown> };
    // Dual-write to Postgres (Prisma Phase 3.3, GH #44) — never blocks or
    // fails this request; Kissinger above is the operation of record.
    await dualWriteCreateContactEvent({ kissingerId: decodedId, kind, notes, occurredAt });
    // Normalise response to the frontend ContactEvent shape
    const raw = data.createContactEvent;
    const event = {
      id: raw.id,
      personId: raw.entityId,
      kind: _eventTypeToKind(String(raw.eventType ?? "NOTE")),
      notes: String(raw.summary ?? ""),
      occurredAt: raw.occurredAt,
      createdAt: raw.createdAt,
    };
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    console.error("Failed to create contact event:", err);
    return NextResponse.json(
      { error: "Failed to create event. Please try again." },
      { status: 500 }
    );
  }
}
