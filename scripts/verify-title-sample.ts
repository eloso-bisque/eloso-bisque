/**
 * One-off verification script (GH outreach read-path cutover, 2026-07-30).
 *
 * Confirms — for a real, live sample of active-queue contacts with no
 * Contact.title in Postgres — that the *live Kissinger* title resolution
 * (the exact same resolveTitleFromMeta/parseNestedMeta chain _fetchProspectContacts
 * uses in src/lib/kissinger.ts) ALSO returns "" for those same contacts today.
 *
 * This is the direct evidence for overriding the 90% COMPLETENESS_THRESHOLD
 * in scripts/verify-outreach-parity.ts for title specifically: if Kissinger's
 * own live data has no title signal for these rows, the current
 * production page (which reads from Kissinger right now) already renders a
 * blank title for them — cutting over to Postgres changes nothing for a real
 * user on these specific rows.
 *
 * Run with: node --env-file=.env.local ./node_modules/.bin/tsx scripts/verify-title-sample.ts
 */

import { prisma } from "../src/lib/prisma";
import { parseNestedMeta, resolveTitleFromMeta } from "../src/lib/kissinger-meta";

const SAMPLE_SIZE = 20;

const KISSINGER_API_URL = process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

const ENTITY_DETAIL_QUERY = `
  query EntityDetail($id: String!) {
    entity(id: $id) {
      id
      name
      meta { key value }
    }
  }
`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (KISSINGER_API_TOKEN) headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Kissinger request failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

async function main() {
  const titleless = await prisma.outreachQueueEntry.findMany({
    where: { isActive: true, contact: { title: null } },
    select: {
      contact: { select: { kissingerId: true, name: true, title: true } },
    },
    take: SAMPLE_SIZE,
  });

  console.log(`Sampled ${titleless.length} active-queue contacts with Contact.title = null in Postgres.\n`);

  let mismatches = 0;
  let checked = 0;

  for (const entry of titleless) {
    const kissingerId = entry.contact.kissingerId;
    if (!kissingerId) {
      console.log(`SKIP  ${entry.contact.name} — no kissingerId on Contact row`);
      continue;
    }

    let liveTitle: string;
    try {
      const data = await gql<{ entity: { id: string; name: string; meta: { key: string; value: string }[] } | null }>(
        ENTITY_DETAIL_QUERY,
        { id: kissingerId }
      );
      if (!data.entity) {
        console.log(`SKIP  ${entry.contact.name} (${kissingerId}) — entity not found in Kissinger`);
        continue;
      }
      const meta = Object.fromEntries(data.entity.meta.map((m) => [m.key, m.value]));
      const nestedMeta = parseNestedMeta(meta);
      // Exact same resolution chain _fetchProspectContacts uses in kissinger.ts.
      liveTitle = resolveTitleFromMeta(meta, nestedMeta);
    } catch (err) {
      console.log(`ERROR ${entry.contact.name} (${kissingerId}) — Kissinger call failed: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    checked++;
    const postgresTitle = entry.contact.title ?? "";
    const match = liveTitle === "" && postgresTitle === "";
    if (!match) mismatches++;
    console.log(
      `${match ? "MATCH" : "MISMATCH"}  ${entry.contact.name.padEnd(28)} kissingerId=${kissingerId}  postgres.title=${JSON.stringify(postgresTitle)}  live-kissinger.title=${JSON.stringify(liveTitle)}`
    );
  }

  console.log(`\nChecked: ${checked}  Mismatches: ${mismatches}`);
  if (checked >= 15 && mismatches === 0) {
    console.log("CONFIRMED: live Kissinger title resolution also returns \"\" for all sampled titleless contacts.");
  } else if (checked < 15) {
    console.log(`WARNING: only ${checked} contacts successfully checked (need >= 15 for a valid sample).`);
  } else {
    console.log(`WARNING: ${mismatches} mismatch(es) found — Kissinger has title signal Postgres is missing. Re-examine before proceeding.`);
  }

  await prisma.$disconnect();
  process.exit(checked >= 15 && mismatches === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
