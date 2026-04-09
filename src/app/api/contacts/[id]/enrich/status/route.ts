/**
 * GET /api/contacts/[id]/enrich/status?run_id=xxx
 *
 * Polls the enrichment run result file written by the Python pipeline.
 * Returns the current run status and summary counters.
 *
 * Response shape:
 *   { status: "running" | "completed" | "failed", run_id, ...counters }
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

interface RunManifest {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "completed" | "failed";
  dry_run: boolean;
  contact_id: string | null;
  goals: string[];
  sources_attempted: string[];
  sources_skipped: string[];
  companies_scanned: number;
  contacts_found: number;
  contacts_added: number;
  duplicates_skipped: number;
  fuzzy_flagged: number;
  skipped_fresh: number;
  errors: string[];
  rollback_log: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const contactId = decodeURIComponent(rawId);

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");

  if (!runId) {
    return NextResponse.json({ error: "Missing run_id query parameter" }, { status: 400 });
  }

  // Basic run_id validation — must look like a UUID to prevent path traversal
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ error: "Invalid run_id format" }, { status: 400 });
  }

  const runFile = path.join(
    os.homedir(),
    "lobster-workspace",
    "enrichment-runs",
    `${runId}.json`
  );

  // If file doesn't exist yet, the subprocess is still starting up
  if (!fs.existsSync(runFile)) {
    return NextResponse.json({
      status: "running",
      run_id: runId,
      contact_id: contactId,
      message: "Enrichment starting…",
    });
  }

  let manifest: RunManifest;
  try {
    const raw = fs.readFileSync(runFile, "utf-8");
    manifest = JSON.parse(raw) as RunManifest;
  } catch (err) {
    console.error("[enrich/status] Failed to read run manifest:", err);
    return NextResponse.json(
      { error: "Could not read enrichment status" },
      { status: 500 }
    );
  }

  return NextResponse.json(manifest);
}
