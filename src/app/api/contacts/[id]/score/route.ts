/**
 * GET /api/contacts/[id]/score
 *
 * Returns a contact's Eloso fit score and breakdown. Used by
 * src/components/LazyScoreBadge.tsx (Contacts listing People tab).
 *
 * Postgres is the sole data source here now (Kissinger disconnected from
 * the live path). This reuses the exact same
 * fetchContactDetailFromPostgres() + scoreContact() combination already
 * built for src/app/(main)/contacts/[id]/page.tsx's server-side score
 * computation (Prisma Phase 3.6, GH #46) — no new graph-traversal logic was
 * written, this route just calls what already exists for a second call
 * site instead of making its own Kissinger edgesFrom/interactionsForEntity
 * round-trips.
 *
 * Response: { score: number, breakdown: {...}, contact_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchContactDetailFromPostgres } from "@/lib/contact-detail-read";
import { scoreContact } from "@/lib/score-contact";
import type { ScoreResult, ScoringEdge } from "@/lib/score-contact";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  try {
    const result = await fetchContactDetailFromPostgres(id);
    if (!result) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const { contact, edges, mostRecentInteractionAt, orgTagsByKissingerId } = result;

    const orgTags: string[] = [];
    for (const tags of Object.values(orgTagsByKissingerId)) orgTags.push(...tags);

    const scoringEdges: ScoringEdge[] = edges.map((edge) => ({
      relation: edge.relation,
      strength: edge.strength,
      target_tags: orgTagsByKissingerId[edge.target] ?? [],
    }));

    const scoreResult: ScoreResult = scoreContact({
      id: contact.id,
      name: contact.name,
      kind: contact.kind,
      tags: contact.tags,
      notes: contact.notes,
      meta: contact.meta,
      updatedAt: contact.updatedAt,
      last_interaction_at: mostRecentInteractionAt ?? undefined,
      edges: scoringEdges,
      org_tags: orgTags,
    });

    return NextResponse.json({
      contact_id: id,
      contact_name: contact.name,
      ...scoreResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to score contact", details: message },
      { status: 500 }
    );
  }
}
