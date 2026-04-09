/**
 * POST /api/contacts/[id]/enrich
 *
 * Starts enrichment for a single contact. Spawns the Python enrichment pipeline
 * as a subprocess (non-blocking — fire and forget). Returns immediately with
 * { status: "running", run_id: "uuid" } so the UI can poll for completion.
 *
 * The pipeline writes its result to:
 *   ~/lobster-workspace/enrichment-runs/{run_id}.json
 *
 * Poll for completion via:
 *   GET /api/contacts/[id]/enrich/status?run_id=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

// Path to the enrichment pipeline entry point
const ENRICHMENT_SCRIPT = path.join(
  os.homedir(),
  "lobster/lobster-shop/prospect-enrichment/pipeline/single_contact_enrichment.py"
);

const ENRICHMENT_RUNS_DIR = path.join(
  os.homedir(),
  "lobster-workspace",
  "enrichment-runs"
);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const contactId = decodeURIComponent(rawId);

  if (!contactId) {
    return NextResponse.json({ error: "Missing contact id" }, { status: 400 });
  }

  let body: { dry_run?: boolean } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // empty body is fine — dry_run defaults to false
  }

  const runId = randomUUID();
  const dryRun = body.dry_run === true;

  // Ensure runs directory exists and write a "running" manifest immediately
  // so the status endpoint has something to read while the script starts.
  fs.mkdirSync(ENRICHMENT_RUNS_DIR, { recursive: true });
  const pendingManifest = {
    run_id: runId,
    status: "running",
    contact_id: contactId,
    dry_run: dryRun,
    started_at: new Date().toISOString(),
    finished_at: null,
    goals_attempted: ["work_history", "connections"],
    sources_attempted: [],
    sources_skipped: [],
    entities_enriched: 0,
    edges_inferred: 0,
    skipped_fresh: 0,
    errors: [],
  };
  fs.writeFileSync(
    path.join(ENRICHMENT_RUNS_DIR, `${runId}.json`),
    JSON.stringify(pendingManifest, null, 2)
  );

  // Spawn the enrichment script as a detached subprocess.
  // It writes ~/lobster-workspace/enrichment-runs/{run_id}.json on completion.
  const args = [
    ENRICHMENT_SCRIPT,
    "--contact-id", contactId,
    "--run-id", runId,
    "--endpoint", KISSINGER_API_URL,
  ];
  if (dryRun) args.push("--dry-run");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KISSINGER_ENDPOINT: KISSINGER_API_URL,
    KISSINGER_API_TOKEN: KISSINGER_API_TOKEN,
  };

  try {
    const child = spawn("python3", args, {
      detached: true,
      stdio: "ignore",
      env,
    });
    child.unref(); // Let the process run independently
  } catch (err) {
    console.error("[enrich] Failed to spawn enrichment process:", err);
    return NextResponse.json(
      { error: "Failed to start enrichment process" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "running",
    run_id: runId,
    contact_id: contactId,
    dry_run: dryRun,
  });
}
