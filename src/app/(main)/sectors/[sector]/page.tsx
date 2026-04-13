import Link from "next/link";

export const metadata = {
  title: "Sector — Eloso Bisque",
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  tags: string[];
  meta: { key: string; value: string }[];
  archived: boolean;
}

/**
 * Fetch all non-archived org entities whose sector_primary meta matches the sector.
 * This uses the entities(kind=org) paginated query, then fetches entity details
 * for each to get meta, filtering by sector_primary.
 */
async function fetchOrgsForSector(sector: string): Promise<OrgRow[]> {
  const KISSINGER_API_URL =
    process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
  const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (KISSINGER_API_TOKEN) headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;

  async function runGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(KISSINGER_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 120 },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`Kissinger: ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    return json.data as T;
  }

  // Step 1: get all org IDs (lightweight — no meta)
  const PAGE = 500;
  const orgIds: string[] = [];
  let cursor: string | undefined;
  let safety = 0;

  while (safety < 10) {
    safety++;
    try {
      const data = await runGql<{
        entities: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: { id: string; archived: boolean } }[];
        };
      }>(
        `query OrgIds($first: Int, $after: String) {
          entities(kind: "org", first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { id archived } }
          }
        }`,
        { first: PAGE, after: cursor }
      );

      const raw = data.entities;
      raw.edges
        .filter((e) => !e.node.archived)
        .forEach((e) => orgIds.push(e.node.id));

      if (!raw.pageInfo.hasNextPage || !raw.pageInfo.endCursor) break;
      cursor = raw.pageInfo.endCursor;
    } catch {
      break;
    }
  }

  if (orgIds.length === 0) return [];

  // Step 2: fetch entity details in parallel batches of 20
  const BATCH = 20;
  const results: OrgRow[] = [];

  for (let i = 0; i < orgIds.length; i += BATCH) {
    const batch = orgIds.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map((id) =>
        runGql<{ entity: OrgRow }>(
          `query OrgDetail($id: String!) {
            entity(id: $id) {
              id name tags archived
              meta { key value }
            }
          }`,
          { id }
        ).then((d) => d.entity)
      )
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        const org = r.value;
        const sectorMeta = org.meta.find((m) => m.key === "sector_primary")?.value ?? "";
        if (sectorMeta.toLowerCase() === sector.toLowerCase()) {
          results.push(org);
        }
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function OrgCard({ org }: { org: OrgRow }) {
  const metaMap = Object.fromEntries(org.meta.map((m) => [m.key, m.value]));
  const hq = metaMap["hq"] ?? metaMap["location"] ?? "";
  const website = metaMap["website"] ?? metaMap["url"] ?? "";

  return (
    <Link
      href={`/contacts/${org.id}`}
      className="block bg-white rounded-lg border border-bisque-200 px-4 py-3 hover:border-bisque-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-bisque-900">{org.name}</p>
        {org.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap justify-end">
            {org.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] bg-bisque-100 text-bisque-600 px-1.5 py-0.5 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {(hq || website) && (
        <p className="text-xs text-bisque-400 mt-1">
          {[hq, website].filter(Boolean).join(" · ")}
        </p>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ sector: string }>;
}

export default async function SectorDetailPage({ params }: PageProps) {
  const { sector: sectorEncoded } = await params;
  const sector = decodeURIComponent(sectorEncoded);

  let orgs: OrgRow[] = [];
  try {
    orgs = await fetchOrgsForSector(sector);
  } catch {
    // Kissinger offline — show empty state
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-bisque-400" aria-label="Breadcrumb">
        <Link href="/sectors" className="hover:text-bisque-600 transition-colors">
          Sectors
        </Link>
        <span className="mx-2">/</span>
        <span className="text-bisque-700 font-medium">{sector}</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-bisque-900">{sector}</h1>
        <p className="text-sm text-bisque-500 mt-1">
          {orgs.length} org{orgs.length !== 1 ? "s" : ""} in this sector
        </p>
      </div>

      {/* Org list */}
      {orgs.length === 0 ? (
        <div className="text-center py-12 text-bisque-400">
          <p className="text-lg font-medium text-bisque-600">No orgs found</p>
          <p className="text-sm mt-1">
            Tag org entities with{" "}
            <code className="bg-bisque-100 px-1 rounded text-bisque-700">
              sector_primary
            </code>{" "}
            = <em>{sector}</em> to populate this list.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orgs.map((org) => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}
