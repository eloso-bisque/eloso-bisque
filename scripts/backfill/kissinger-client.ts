/**
 * Minimal, backfill-specific Kissinger GraphQL client.
 *
 * Distinct from src/lib/kissinger.ts (the app's read-path client) because the
 * backfill needs full entity detail (meta/tags/notes) for every entity, not
 * just the summary fields used by list views, and has no need for Next.js
 * fetch caching (`unstable_cache`) since this is a one-shot script.
 */

const KISSINGER_API_URL = process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

export interface KissingerMeta {
  key: string;
  value: string;
}

export interface KissingerEntity {
  id: string;
  kind: string;
  name: string;
  tags: string[];
  notes: string;
  meta: KissingerMeta[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface KissingerEdge {
  source: string;
  target: string;
  relation: string;
  strength: number;
  notes: string;
}

export interface KissingerInteraction {
  id: string;
  kind: string;
  occurredAt: string;
  subject: string;
  notes: string;
}

export interface GraphStats {
  totalEntities: number;
  totalEdges: number;
  entitiesByKind: { kind: string; count: number }[];
  edgesByType: { relationType: string; count: number }[];
}

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (KISSINGER_API_TOKEN) headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;

  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Kissinger GraphQL request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

const ENTITY_IDS_QUERY = `
  query EntityIds($kind: String, $first: Int, $after: String) {
    entities(kind: $kind, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id } }
    }
  }
`;

/** Fetches every entity id of a given kind, following pagination cursors. */
export async function fetchAllEntityIds(kind: "person" | "org"): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await gql<{
      entities: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: { id: string } }[] };
    }>(ENTITY_IDS_QUERY, { kind, first: 1000, after });
    ids.push(...data.entities.edges.map((e) => e.node.id));
    if (!data.entities.pageInfo.hasNextPage || !data.entities.pageInfo.endCursor) break;
    after = data.entities.pageInfo.endCursor;
  }
  return ids;
}

const ENTITY_DETAIL_QUERY = `
  query EntityDetail($id: String!) {
    entity(id: $id) {
      id kind name tags notes meta { key value } createdAt updatedAt archived
    }
  }
`;

export async function fetchEntityDetail(id: string): Promise<KissingerEntity> {
  const data = await gql<{ entity: KissingerEntity }>(ENTITY_DETAIL_QUERY, { id });
  return data.entity;
}

const EDGES_FROM_QUERY = `
  query EdgesFrom($entityId: String!, $first: Int, $after: String) {
    edgesFrom(entityId: $entityId, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { source target relation strength notes } }
    }
  }
`;

/** Fetches every outgoing edge for an entity, following pagination cursors. */
export async function fetchEdgesFrom(entityId: string): Promise<KissingerEdge[]> {
  const edges: KissingerEdge[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await gql<{
      edgesFrom: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: KissingerEdge }[] };
    }>(EDGES_FROM_QUERY, { entityId, first: 500, after });
    edges.push(...data.edgesFrom.edges.map((e) => e.node));
    if (!data.edgesFrom.pageInfo.hasNextPage || !data.edgesFrom.pageInfo.endCursor) break;
    after = data.edgesFrom.pageInfo.endCursor;
  }
  return edges;
}

const INTERACTIONS_QUERY = `
  query Interactions($entityId: String!, $first: Int, $after: String) {
    interactionsForEntity(entityId: $entityId, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id kind occurredAt subject notes } }
    }
  }
`;

export async function fetchInteractions(entityId: string): Promise<KissingerInteraction[]> {
  const interactions: KissingerInteraction[] = [];
  let after: string | undefined;
  for (;;) {
    const data = await gql<{
      interactionsForEntity: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: KissingerInteraction }[];
      };
    }>(INTERACTIONS_QUERY, { entityId, first: 200, after });
    interactions.push(...data.interactionsForEntity.edges.map((e) => e.node));
    if (!data.interactionsForEntity.pageInfo.hasNextPage || !data.interactionsForEntity.pageInfo.endCursor) break;
    after = data.interactionsForEntity.pageInfo.endCursor;
  }
  return interactions;
}

const GRAPH_STATS_QUERY = `
  query GraphStats {
    graphStats {
      totalEntities
      totalEdges
      entitiesByKind { kind count }
      edgesByType { relationType count }
    }
  }
`;

export async function fetchGraphStats(): Promise<GraphStats> {
  const data = await gql<{ graphStats: GraphStats }>(GRAPH_STATS_QUERY);
  return data.graphStats;
}

/** Runs `fn` over `items` with at most `concurrency` in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
