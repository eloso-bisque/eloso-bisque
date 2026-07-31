/**
 * GET /api/contacts/[id]/intro-path
 *
 * Queries Postgres for the shortest warm intro path from any team member
 * (configured via TEAM_PERSON_IDS env var) to the target contact, via a BFS
 * over "knows" RelationshipFrom edges. Previously called Kissinger directly
 * (fetchIntroPath in src/lib/kissinger.ts) — Drew's 2026-07-31 instruction
 * superseded his earlier explicit exception for this route; see
 * src/lib/intro-path-read.ts for the migration rationale and parity notes.
 *
 * Response: IntroPathResult — { found, hops, steps[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchIntroPathFromPostgres } from "@/lib/intro-path-read";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  try {
    const result = await fetchIntroPathFromPostgres(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch intro path", details: message },
      { status: 500 }
    );
  }
}
