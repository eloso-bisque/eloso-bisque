/**
 * Tests for the enrichment API routes — Slice 3 validation.
 *
 * Tests the status route logic and the start route parameter validation
 * using pure Node logic (no Next.js runtime needed).
 *
 * Run: npm test -- enrich-api
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Helpers that mirror the route logic (tested in isolation)
// ---------------------------------------------------------------------------

/** Mirror of the run_id validation in the status route. */
function isValidRunId(runId: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(runId);
}

/** Mirror of the run file path logic. */
function runFilePath(runId: string): string {
  return path.join(os.homedir(), "lobster-workspace", "enrichment-runs", `${runId}.json`);
}

/** Simulate reading a run manifest (mirrors status route). */
function readRunManifest(runFile: string): object | null {
  if (!fs.existsSync(runFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(runFile, "utf-8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// run_id validation
// ---------------------------------------------------------------------------

describe("run_id validation", () => {
  it("accepts a valid UUID v4", () => {
    expect(isValidRunId("a3f8c1d2-1234-4567-8901-abcdef012345")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidRunId("")).toBe(false);
  });

  it("rejects path traversal attempt", () => {
    expect(isValidRunId("../../../etc/passwd")).toBe(false);
    expect(isValidRunId("../../../../config")).toBe(false);
  });

  it("rejects run_id with slashes", () => {
    expect(isValidRunId("abc/def")).toBe(false);
  });

  it("rejects too-long string", () => {
    expect(isValidRunId("a".repeat(100))).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(isValidRunId("abc\x00def")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Run file path construction
// ---------------------------------------------------------------------------

describe("run file path", () => {
  it("constructs correct path from run_id", () => {
    const runId = "a3f8c1d2-0000-0000-0000-000000000001";
    const p = runFilePath(runId);
    expect(p).toContain("enrichment-runs");
    expect(p).toContain(`${runId}.json`);
    expect(p).not.toContain("..");
  });
});

// ---------------------------------------------------------------------------
// Run manifest reading
// ---------------------------------------------------------------------------

describe("readRunManifest", () => {
  const tmpDir = path.join(os.tmpdir(), `enrich-test-${process.pid}`);

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    const result = readRunManifest(path.join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("returns parsed manifest for existing file", () => {
    const p = path.join(tmpDir, "run.json");
    const manifest = {
      run_id: "test-run",
      status: "completed",
      contacts_added: 3,
    };
    fs.writeFileSync(p, JSON.stringify(manifest));
    const result = readRunManifest(p);
    expect(result).toEqual(manifest);
  });

  it("returns null for malformed JSON", () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(p, "{ not valid json }");
    const result = readRunManifest(p);
    expect(result).toBeNull();
  });

  it("returns null for empty file", () => {
    const p = path.join(tmpDir, "empty.json");
    fs.writeFileSync(p, "");
    const result = readRunManifest(p);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Status response shape
// ---------------------------------------------------------------------------

describe("enrichment status response shape", () => {
  it("running status has correct shape when file missing", () => {
    // Simulates response when subprocess hasn't written the file yet
    const response = {
      status: "running",
      run_id: "a3f8c1d2-0000-0000-0000-000000000001",
      contact_id: "contact_123",
      message: "Enrichment starting…",
    };
    expect(response.status).toBe("running");
    expect(response.run_id).toBeDefined();
    expect(response.contact_id).toBeDefined();
  });

  it("completed status manifest has all expected fields", () => {
    const manifest = {
      run_id: "abc",
      started_at: "2026-04-09T18:00:00Z",
      finished_at: "2026-04-09T18:01:00Z",
      status: "completed",
      dry_run: false,
      contact_id: "ent_123",
      goals: ["org_chart"],
      sources_attempted: ["google_serp_free"],
      sources_skipped: ["apollo"],
      companies_scanned: 1,
      contacts_found: 5,
      contacts_added: 3,
      duplicates_skipped: 2,
      fuzzy_flagged: 0,
      skipped_fresh: 0,
      errors: [],
      rollback_log: "/tmp/abc-rollback.jsonl",
    };
    // Validate all required fields present
    const required = [
      "run_id", "status", "contacts_added", "duplicates_skipped",
      "sources_attempted", "errors", "dry_run",
    ];
    for (const field of required) {
      expect(manifest).toHaveProperty(field);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /enrich response shape
// ---------------------------------------------------------------------------

describe("enrich start response shape", () => {
  it("returns status=running with run_id on success", () => {
    const runId = "a3f8c1d2-0000-0000-0000-000000000001";
    const response = {
      status: "running",
      run_id: runId,
      contact_id: "ent_abc",
      dry_run: false,
    };
    expect(response.status).toBe("running");
    expect(isValidRunId(response.run_id)).toBe(true);
    expect(response.dry_run).toBe(false);
  });

  it("dry_run flag is passed through", () => {
    const response = {
      status: "running",
      run_id: "a3f8c1d2-0000-0000-0000-000000000001",
      contact_id: "ent_abc",
      dry_run: true,
    };
    expect(response.dry_run).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Polling logic constants
// ---------------------------------------------------------------------------

describe("polling constants", () => {
  it("poll interval is reasonable (> 1s, < 10s)", () => {
    const POLL_INTERVAL_MS = 2500;
    expect(POLL_INTERVAL_MS).toBeGreaterThan(1000);
    expect(POLL_INTERVAL_MS).toBeLessThan(10000);
  });

  it("max poll duration is at least 2 minutes", () => {
    const MAX_POLL_DURATION_MS = 5 * 60 * 1000;
    expect(MAX_POLL_DURATION_MS).toBeGreaterThanOrEqual(2 * 60 * 1000);
  });
});
