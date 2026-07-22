/**
 * GET /api/contacts/[id]/trigify-signals
 *
 * Known Kissinger touchpoint — flagged for Drew, not silently left behind.
 *
 * Trigify LinkedIn post-engagement signals are written by the external
 * `trigify-daily-sync` cron job (see SIGNAL_TASK_QUEUE_DESIGN.md) directly
 * into Kissinger as contact events (createdBy="trigify-sync") — that sync
 * job writes to Kissinger only and does not go through this Next.js app, so
 * there is no Postgres equivalent to read. docs/prisma-schema-design.md
 * describes an intended future state where Trigify events land in the
 * Postgres `Signal` table via backfill, but that backfill has not been
 * built, so this route intentionally still reads Kissinger — same category
 * of exception as GET /api/contacts/[id]/intro-path.
 *
 * This was split out of GET /api/contacts/[id]/events (which is now
 * Postgres-only and serves the regular Notes/Meetings/etc events tab) so
 * that the Postgres cutover there could not silently blank the Signals tab
 * for real Trigify data.
 */

import { NextRequest, NextResponse } from "next/server";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

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

/** Map Kissinger eventType enum -> ContactEventsTab/TrigifySignalsTab kind string. */
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
    const raw = data.contactEventsForEntity ?? [];
    const events = (raw as Array<Record<string, unknown>>).map((e) => ({
      id: e.id,
      personId: e.entityId,
      kind: _eventTypeToKind(String(e.eventType ?? "NOTE")),
      notes: String(e.summary ?? ""),
      occurredAt: e.occurredAt,
      createdAt: e.createdAt,
      createdBy: e.createdBy,
      eventType: e.eventType,
    }));
    return NextResponse.json({ events });
  } catch (err) {
    console.error("Failed to fetch Trigify signals:", err);
    return NextResponse.json(
      { error: "Failed to fetch signals." },
      { status: 500 }
    );
  }
}
