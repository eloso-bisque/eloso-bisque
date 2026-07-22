import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { dualWriteRemoveProspectTag, PROSPECT_CONTACT_TAG } from "@/lib/contacts-dual-write";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/contacts/[id]/remove-prospect
 *
 * Removes the "prospect-contact" tag from the entity, effectively removing
 * the contact from the outreach prospect list. Postgres is the sole write
 * for this route now — Kissinger disconnected from the live path (see
 * src/lib/contacts-dual-write.ts's module doc).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const kissingerId = decodeURIComponent(id);

  let contact: { id: string; tags: { tag: string }[] } | null;
  try {
    contact = await prisma.contact.findUnique({
      where: { kissingerId },
      select: { id: true, tags: { select: { tag: true } } },
    });
  } catch (err) {
    console.error(
      "[remove-prospect] Failed to fetch contact:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "Failed to fetch contact" }, { status: 500 });
  }

  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  const currentTags = contact.tags.map((t) => t.tag);

  if (!currentTags.includes(PROSPECT_CONTACT_TAG)) {
    // Tag wasn't present — treat as success (idempotent), matching the
    // pre-cutover contract.
    return NextResponse.json({ success: true, tags: currentTags });
  }

  try {
    await dualWriteRemoveProspectTag({ kissingerId });
  } catch (err) {
    console.error(
      "[remove-prospect] Failed to remove tag:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json({ error: "Failed to remove contact" }, { status: 500 });
  }

  const updatedTags = currentTags.filter((t) => t !== PROSPECT_CONTACT_TAG);
  revalidateTag("contacts");

  return NextResponse.json({ success: true, tags: updatedTags });
}
