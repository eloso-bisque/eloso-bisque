/**
 * Verifies that the Postgres-backed Investors section (src/lib/
 * investors-read.ts) produces the same firm/people counts as the live
 * Kissinger-backed reads it replaces, per the GH #45 definition of done:
 * "compare investor firm/people counts ... between the old Kissinger-backed
 * view and the new Postgres-backed view."
 *
 * This hits the real, live Kissinger GraphQL API (KISSINGER_API_URL) and the
 * real production Postgres (DATABASE_URL) — read-only against both, no
 * mutations. Same technique as scripts/verify-contacts-sectors-parity.ts
 * (GH #44).
 *
 * Run with:  npx tsx scripts/verify-investors-parity.ts
 */

import { loadEnvFile } from "./backfill/env";

async function fetchAllEntitiesRaw(
  kind: "person" | "org",
  apiUrl: string,
  token: string
): Promise<{ id: string; tags: string[]; archived: boolean }[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const query = `query ContactsPage($kind: String, $first: Int, $after: String) {
    entities(kind: $kind, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id tags archived } }
    }
  }`;

  const all: { id: string; tags: string[]; archived: boolean }[] = [];
  let cursor: string | undefined;
  let safety = 0;
  while (safety < 30) {
    safety++;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { kind, first: 500, after: cursor } }),
    });
    const json: {
      data?: { entities: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: { id: string; tags: string[]; archived: boolean } }[] } };
      errors?: unknown[];
    } = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const raw = json.data!.entities;
    all.push(...raw.edges.map((e) => e.node).filter((e) => !e.archived));
    if (!raw.pageInfo.hasNextPage || !raw.pageInfo.endCursor) break;
    cursor = raw.pageInfo.endCursor;
  }
  return all;
}

async function main() {
  loadEnvFile([".env.production.local", ".env.local"]);
  const { INVESTOR_FIRM_TAGS, INVESTOR_PERSON_TAGS } = await import("../src/lib/kissinger");
  const { prisma } = await import("../src/lib/prisma");
  const {
    fetchInvestorFirmsFromPostgres,
    fetchInvestorPeopleFromPostgres,
    INVESTOR_FIRM_WHERE,
    INVESTOR_PERSON_WHERE,
  } = await import("../src/lib/investors-read");

  const apiUrl = process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
  const token = process.env.KISSINGER_API_TOKEN ?? "";

  console.log("=== Investors section (GH #45) ===\n");
  console.log("Fetching all Kissinger orgs + people (live)...");
  const [allOrgs, allPeople] = await Promise.all([
    fetchAllEntitiesRaw("org", apiUrl, token),
    fetchAllEntitiesRaw("person", apiUrl, token),
  ]);

  const kFirms = allOrgs.filter((o) => o.tags.some((t) => INVESTOR_FIRM_TAGS.has(t))).length;
  const kPeople = allPeople.filter((p) => p.tags.some((t) => INVESTOR_PERSON_TAGS.has(t))).length;

  const [pFirmCount, pPeopleCount] = await Promise.all([
    prisma.organization.count({ where: INVESTOR_FIRM_WHERE }),
    prisma.contact.count({ where: INVESTOR_PERSON_WHERE }),
  ]);

  console.log(`Kissinger (live, tag-based):    firms=${kFirms} people=${kPeople}`);
  console.log(`Postgres  (typed-field):        firms=${pFirmCount} people=${pPeopleCount}`);
  console.log(
    (kFirms === pFirmCount ? "MATCH" : "MISMATCH") + ` firms (diff=${pFirmCount - kFirms})`
  );
  console.log(
    (kPeople === pPeopleCount ? "MATCH" : "MISMATCH") + ` people (diff=${pPeopleCount - kPeople})`
  );

  // -------------------------------------------------------------------
  // Field completeness (guardrail 3 — data completeness gate)
  // -------------------------------------------------------------------
  console.log("\n=== Field completeness (Organization.isVcFirm=true) ===");
  const totalVc = await prisma.organization.count({ where: { isVcFirm: true } });
  for (const [label, field] of [
    ["investmentStage", "investmentStage"],
    ["checkSize", "checkSize"],
    ["thesis", "thesis"],
    ["sectorFit", "sectorFit"],
    ["investorFitScore", "investorFitScore"],
  ] as const) {
    const count = await prisma.organization.count({ where: { isVcFirm: true, [field]: { not: null } } });
    console.log(`  ${label}: ${count}/${totalVc} (${((100 * count) / totalVc).toFixed(1)}%)`);
  }

  console.log("\n=== Field completeness (Contact.isInvestorContact=true) ===");
  const totalInv = await prisma.contact.count({ where: { isInvestorContact: true } });
  for (const [label, field] of [
    ["investorFitScore", "investorFitScore"],
    ["incentive", "incentive"],
    ["warmIntroPath", "warmIntroPath"],
    ["priority", "priority"],
  ] as const) {
    const count = await prisma.contact.count({ where: { isInvestorContact: true, [field]: { not: null } } });
    console.log(`  ${label}: ${count}/${totalInv} (${((100 * count) / totalInv).toFixed(1)}%)`);
  }

  // -------------------------------------------------------------------
  // Spot-check a handful of real records end-to-end through the new mapping
  // -------------------------------------------------------------------
  console.log("\n=== Spot-check: 3 firms + 3 people through the Postgres read path ===");
  const firms = await fetchInvestorFirmsFromPostgres();
  const people = await fetchInvestorPeopleFromPostgres();
  for (const { firm } of (firms ?? []).slice(0, 3)) {
    console.log(
      `  FIRM  ${firm.name} | stage=${firm.stage || "-"} checkSize=${firm.checkSize || "-"} ` +
        `pipelineStage=${firm.pipelineStage} priority=${firm.priority || "-"}`
    );
  }
  for (const person of (people ?? []).slice(0, 3)) {
    console.log(
      `  PERSON ${person.name} | firm=${person.firmName || "-"} incentive=${(person.incentive || "-").slice(0, 40)} priority=${person.priority || "-"}`
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
