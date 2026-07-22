/**
 * Minimal, dependency-free .env file loader.
 *
 * Next.js auto-loads .env.local/.env.production.local for `next dev`/`next
 * build`, but this backfill runs standalone via `tsx` outside of Next's
 * runtime, so nothing loads those files for it automatically. Kept
 * dependency-free (no `dotenv` package) since the parsing need is trivial.
 */

import { existsSync, readFileSync } from "node:fs";

/** Pure: parses `.env`-style file content into a key/value record. */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    const isDoubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

/**
 * Loads the first existing file from `candidates` into `process.env`,
 * without overwriting variables already set (so an explicit shell-exported
 * value always wins over a file default). Returns the path loaded, or null
 * if none of the candidates exist.
 */
export function loadEnvFile(candidates: string[]): string | null {
  for (const path of candidates) {
    if (existsSync(path)) {
      const parsed = parseEnvFile(readFileSync(path, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return path;
    }
  }
  return null;
}
