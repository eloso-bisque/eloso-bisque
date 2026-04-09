/**
 * POST /api/contacts/[id]/enrich
 *
 * Starts enrichment for a single contact. Triggers the Lobster internal
 * enrichment endpoint, which runs enrich_contact.py as a background subagent.
 * Returns immediately with { status: "running", run_id: "uuid" } so the UI
 * can poll for completion.
 *
 * The pipeline writes its result to:
 *   ~/lobster-workspace/enrichment-runs/{run_id}.json
 *
 * Poll for completion via:
 *   GET /api/contacts/[id]/enrich/status?run_id=xxx
 *
 * Architecture note:
 *   This route runs on Vercel (serverless, no subprocess support). Enrichment
 *   is delegated to the Lobster server via LOBSTER_MCP_URL. The Lobster
 *   server runs enrich_contact.py as a background subagent and writes the
 *   result manifest to ~/lobster-workspace/enrichment-runs/{run_id}.json.
 *
 *   The status route reads that file through LOBSTER_MCP_URL/enrichment_status.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

// Lobster internal HTTP endpoint — set LOBSTER_MCP_URL in Vercel env vars
// e.g. http://eloso-awp.myownlobster.ai:9099
const LOBSTER_MCP_URL = (process.env.LOBSTER_MCP_URL ?? "").replace(/\/$/, "");
const LOBSTER_INTERNAL_SECRET = process.env.LOBSTER_INTERNAL_SECRET ?? "";

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
    // empty body is fine
  }

  const runId = randomUUID();
  const dryRun = body.dry_run === true;

  if (!LOBSTER_MCP_URL) {
    // Local dev: LOBSTER_MCP_URL not configured.
    // Trigger enrichment directly via python3 subprocess when running locally.
    const { spawn } = await import("child_process");
    const { join } = await import("path");
    const { homedir } = await import("os");

    const scriptPath = join(
      homedir(),
      "lobster/lobster-shop/prospect-enrichment/bin/enrich_contact.py"
    );
    const args = [
      scriptPath,
      "--contact-id", contactId,
      "--run-id", runId,
      "--endpoint", KISSINGER_API_URL,
    ];
    if (dryRun) args.push("--dry-run");

    try {
      const child = spawn("python3", args, {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          KISSINGER_ENDPOINT: KISSINGER_API_URL,
          KISSINGER_API_TOKEN,
        },
      });
      child.unref();
    } catch (err) {
      console.error("[enrich] subprocess spawn failed:", err);
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

  // Production: delegate to Lobster MCP HTTP endpoint
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const lobsterResp = await fetch(`${LOBSTER_MCP_URL}/enrich_contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lobster-Secret": LOBSTER_INTERNAL_SECRET,
      },
      body: JSON.stringify({
        contact_id: contactId,
        run_id: runId,
        dry_run: dryRun,
        kissinger_endpoint: KISSINGER_API_URL,
        kissinger_token: KISSINGER_API_TOKEN,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!lobsterResp.ok) {
      const errBody = await lobsterResp.text().catch(() => "");
      console.error(`[enrich] Lobster MCP ${lobsterResp.status}: ${errBody}`);
      return NextResponse.json(
        { error: "Enrichment service returned an error" },
        { status: 503 }
      );
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (!isAbort) {
      console.error("[enrich] Failed to reach Lobster MCP:", err);
      return NextResponse.json(
        { error: "Could not connect to enrichment service" },
        { status: 503 }
      );
    }
    // AbortError = timeout = server is working, return run_id
  }

  return NextResponse.json({
    status: "running",
    run_id: runId,
    contact_id: contactId,
    dry_run: dryRun,
  });
}
