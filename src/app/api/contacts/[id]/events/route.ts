/**
 * GET/POST /api/contacts/[id]/events — regular contact events (Notes,
 * Meetings, Emails, Calls, Custom entries logged from the ContactEventsTab
 * "Add Event" form).
 *
 * Postgres is the sole read/write path here (Kissinger disconnected from
 * the live path — see src/lib/contacts-dual-write.ts's module doc). Trigify
 * signal data used to be served from this same endpoint (filtered
 * client-side) but has been split out to
 * GET /api/contacts/[id]/trigify-signals, which intentionally still reads
 * Kissinger — see that route's doc comment for why.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dualWriteCreateContactEvent } from "@/lib/contacts-dual-write";

// GET /api/contacts/[id]/events — list events for a contact
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing contact id" }, { status: 400 });
  }

  const kissingerId = decodeURIComponent(id);

  try {
    const contact = await prisma.contact.findUnique({
      where: { kissingerId },
      select: {
        events: {
          select: { id: true, kind: true, notes: true, occurredAt: true, createdAt: true },
          orderBy: { occurredAt: "desc" },
        },
      },
    });

    const events = (contact?.events ?? []).map((e) => ({
      id: e.id,
      personId: kissingerId,
      kind: e.kind,
      notes: e.notes ?? "",
      occurredAt: e.occurredAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
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

  const decodedId = decodeURIComponent(id);

  try {
    const created = await dualWriteCreateContactEvent({ kissingerId: decodedId, kind, notes, occurredAt });
    const event = {
      id: created.id,
      personId: decodedId,
      kind: created.kind,
      notes: created.notes ?? "",
      occurredAt: created.occurredAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
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
