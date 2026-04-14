/**
 * GET /api/contacts/[id]/intro-path
 *
 * Queries Kissinger for the shortest warm intro path from any team member
 * (configured via TEAM_PERSON_IDS env var) to the target contact.
 *
 * Response: IntroPathResult — { found, hops, steps[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchIntroPath } from "@/lib/kissinger";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  try {
    const result = await fetchIntroPath(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch intro path", details: message },
      { status: 500 }
    );
  }
}
