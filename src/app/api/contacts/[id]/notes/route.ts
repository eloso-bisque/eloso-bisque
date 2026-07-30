import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { dualWriteUpdateNotes } from "@/lib/contacts-dual-write";

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
    const decodedId = decodeURIComponent(id);
    // Postgres is the sole write for notes updates (Kissinger disconnected
    // from the live path — see src/lib/contacts-dual-write.ts's module doc).
    await dualWriteUpdateNotes({ kissingerId: decodedId, notes: body.notes });
  } catch (err) {
    console.error("Failed to update notes:", err);
    return NextResponse.json(
      { error: "Failed to save notes. Please try again." },
      { status: 500 }
    );
  }

  // Deliberately outside the write's try/catch: the Postgres write already
  // succeeded at this point, so a cache-revalidation failure must never be
  // reported back as a failed update (that would be a false negative — the
  // notes are saved, but the caller is told to retry).
  try {
    revalidateTag("contacts");
  } catch (err) {
    console.error("Notes updated, but cache revalidation failed (non-fatal):", err);
  }

  return NextResponse.json({ ok: true });
}
