/**
 * GET /api/contacts/[id]/enrich/status?run_id=xxx
 *
 * Polls the enrichment run result.
 *
 * In production (LOBSTER_MCP_URL set): proxies to Lobster server which
 * reads the run manifest from ~/lobster-workspace/enrichment-runs/{run_id}.json
 *
 * In local dev (no LOBSTER_MCP_URL): reads the file directly from disk.
 *
 * Response shape:
 *   { status: "running" | "completed" | "failed", run_id, ...counters }
 */

import { NextRequest, NextResponse } from "next/server";

const LOBSTER_MCP_URL = (process.env.LOBSTER_MCP_URL ?? "").replace(/\/$/, "");
const LOBSTER_INTERNAL_SECRET = process.env.LOBSTER_INTERNAL_SECRET ?? "";

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

  // Basic run_id validation — prevent path traversal
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ error: "Invalid run_id format" }, { status: 400 });
  }

  // --- Production: proxy to Lobster MCP ---
  if (LOBSTER_MCP_URL) {
    try {
      const lobsterResp = await fetch(
        `${LOBSTER_MCP_URL}/enrichment_status?run_id=${encodeURIComponent(runId)}`,
        {
          headers: { "X-Lobster-Secret": LOBSTER_INTERNAL_SECRET },
          cache: "no-store",
        }
      );

      if (!lobsterResp.ok) {
        // If 404, the run file doesn't exist yet
        if (lobsterResp.status === 404) {
          return NextResponse.json({
            status: "running",
            run_id: runId,
            contact_id: contactId,
            message: "Enrichment starting…",
          });
        }
        return NextResponse.json(
          { error: "Could not read enrichment status" },
          { status: 502 }
        );
      }

      const manifest = (await lobsterResp.json()) as RunManifest;
      return NextResponse.json(manifest);
    } catch (err) {
      console.error("[enrich/status] Failed to reach Lobster MCP:", err);
      return NextResponse.json(
        { error: "Could not connect to enrichment service" },
        { status: 503 }
      );
    }
  }

  // --- Local dev: read file directly ---
  const { existsSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const { homedir } = await import("os");

  const runFile = join(
    homedir(),
    "lobster-workspace",
    "enrichment-runs",
    `${runId}.json`
  );

  if (!existsSync(runFile)) {
    return NextResponse.json({
      status: "running",
      run_id: runId,
      contact_id: contactId,
      message: "Enrichment starting…",
    });
  }

  let manifest: RunManifest;
  try {
    manifest = JSON.parse(readFileSync(runFile, "utf-8")) as RunManifest;
  } catch (err) {
    console.error("[enrich/status] Failed to read run manifest:", err);
    return NextResponse.json(
      { error: "Could not read enrichment status" },
      { status: 500 }
    );
  }

  return NextResponse.json(manifest);
}
