/**
 * Verifies that the Postgres-backed Contacts listing segmentation
 * (src/lib/contacts-read.ts) and Sectors heatmap (src/lib/sectors-read.ts)
 * produce the same counts as the live Kissinger-backed reads they replace,
 * per the GH #44 definition of done: "compare the Postgres-backed Contacts
 * listing output counts ... against the pre-migration Kissinger-backed
 * counts for the same data — should match (or you should be able to explain
 * any discrepancy)."
 *
 * This hits the real, live Kissinger GraphQL API (KISSINGER_API_URL) and the
 * real production Postgres (DATABASE_URL) — read-only against both, no
 * mutations. Intended to be run once before wiring the Postgres read paths
 * into the Contacts/Sectors pages, and any time the parity claim in this
 * PR needs re-verification (e.g. before merge, per independent review).
 *
 * Run with:  npx tsx scripts/verify-contacts-sectors-parity.ts
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
  const { classifyOrg, INVESTOR_PERSON_TAGS, fetchSectorAggregates } = await import("../src/lib/kissinger");
  const { prisma } = await import("../src/lib/prisma");
  const { whereForOrgSegment } = await import("../src/lib/contacts-read");
  const { aggregateSectorHeatmap } = await import("../src/lib/sectors-read");

  const apiUrl = process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
  const token = process.env.KISSINGER_API_TOKEN ?? "";

  // -------------------------------------------------------------------
  // Contacts listing segmentation parity
  // -------------------------------------------------------------------
  console.log("=== Contacts listing segmentation (GH #44) ===\n");
  console.log("Fetching all Kissinger orgs + people (live)...");
  const [allOrgs, allPeople] = await Promise.all([
    fetchAllEntitiesRaw("org", apiUrl, token),
    fetchAllEntitiesRaw("person", apiUrl, token),
  ]);

  const kVc = allOrgs.filter((o) => classifyOrg(o.tags) === "vc").length;
  const kProspects = allOrgs.filter((o) => classifyOrg(o.tags) === "prospects").length;
  const kOther = allOrgs.filter((o) => classifyOrg(o.tags) === "other-orgs").length;
  const kPeople = allPeople.filter((p) => !p.tags.some((t) => INVESTOR_PERSON_TAGS.has(t))).length;

  const [pVc, pProspects, pOther, pPeople] = await Promise.all([
    prisma.organization.count({ where: whereForOrgSegment("vc") }),
    prisma.organization.count({ where: whereForOrgSegment("prospects") }),
    prisma.organization.count({ where: whereForOrgSegment("other-orgs") }),
    prisma.contact.count({ where: { isInvestorContact: false, isArchived: false } }),
  ]);

  console.log(`Kissinger (live, tag-based):    vc=${kVc} prospects=${kProspects} other-orgs=${kOther} people=${kPeople}`);
  console.log(`Postgres  (typed-field):        vc=${pVc} prospects=${pProspects} other-orgs=${pOther} people=${pPeople}`);
  console.log(
    `Org diff: vc=${pVc - kVc} prospects=${pProspects - kProspects} other-orgs=${pOther - kOther} ` +
      `(total ${allOrgs.length} vs ${pVc + pProspects + pOther})`
  );
  console.log(`People diff: ${pPeople - kPeople} (Kissinger is under continuous live write load; small drift is expected)`);

  // -------------------------------------------------------------------
  // Sectors heatmap parity
  // -------------------------------------------------------------------
  console.log("\n=== Sectors heatmap (GH #44) ===\n");
  const kissingerSectors = await fetchSectorAggregates();
  const kissingerTotalOrgs = kissingerSectors.reduce((sum, s) => sum + s.orgCount, 0);
  console.log(
    `Kissinger sectorAggregates: ${kissingerSectors.length} sectors, ${kissingerTotalOrgs} orgs total`
  );
  for (const s of kissingerSectors) {
    console.log(`  ${s.sector}: orgCount=${s.orgCount} apolloMarketSize=${s.apolloMarketSize}`);
  }

  const [sectors, links] = await Promise.all([
    prisma.sector.findMany({ select: { slug: true, displayName: true, defaultAssignee: true } }),
    prisma.organizationSector.findMany({
      where: { isPrimary: true },
      select: {
        sectorSlug: true,
        organization: {
          select: {
            apolloMarketSize: true,
            icpScore: true,
            contacts: { where: { isProspectContact: true }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
  ]);
  const orgRows = links.map((l) => ({
    sectorSlug: l.sectorSlug,
    apolloMarketSize: l.organization.apolloMarketSize,
    icpScore: l.organization.icpScore,
    hasProspectContact: l.organization.contacts.length > 0,
  }));
  const pgTiles = aggregateSectorHeatmap(sectors, orgRows);
  const pgTotalOrgs = pgTiles.reduce((sum, t) => sum + t.orgCount, 0);
  console.log(`\nPostgres heatmap tiles: ${pgTiles.length} sectors (${sectors.length} Sector rows), ${pgTotalOrgs} orgs total`);
  for (const t of pgTiles) {
    console.log(
      `  ${t.slug} (${t.displayName}): orgCount=${t.orgCount} apolloMarketSize=${t.apolloMarketSize} assignee=${t.defaultAssignee ?? "none"}`
    );
  }

  console.log(
    `\nOrg total diff (Kissinger sectors only, i.e. sectors with >=1 org): ` +
      `Kissinger=${kissingerTotalOrgs} vs Postgres=${pgTotalOrgs}`
  );
  console.log(
    pgTotalOrgs === kissingerTotalOrgs
      ? "MATCH: Postgres sector org totals match Kissinger's live sectorAggregates exactly."
      : "MISMATCH: investigate before relying on this parity claim in the PR."
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
