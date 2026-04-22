/**
 * Kissinger GraphQL client helpers.
 *
 * All calls are server-side only — KISSINGER_API_URL must never be exposed
 * to the browser (no NEXT_PUBLIC_ prefix).
 */

import { unstable_cache } from "next/cache";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  cacheOptions?: { tags?: string[]; revalidate?: number; noStore?: boolean }
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (KISSINGER_API_TOKEN) {
    headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  }

  const fetchInit: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000),
  };

  if (cacheOptions?.noStore) {
    fetchInit.cache = "no-store";
  } else if (cacheOptions?.tags) {
    fetchInit.next = { tags: cacheOptions.tags };
  } else {
    fetchInit.next = { revalidate: cacheOptions?.revalidate ?? 60 };
  }

  const res = await fetch(KISSINGER_API_URL, fetchInit);

  if (!res.ok) {
    throw new Error(
      `Kissinger GraphQL request failed: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };

  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `Kissinger GraphQL errors: ${JSON.stringify(json.errors)}`
    );
  }

  return json.data as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphStats {
  totalEntities: number;
  totalEdges: number;
  entitiesByKind: Record<string, number>;
  edgesByType: Record<string, number>;
}

export interface EntitySummary {
  id: string;
  kind: string;
  name: string;
  tags: string[];
  updatedAt: string;
  archived: boolean;
  /** Location extracted from meta["location"] — available on all list queries */
  location?: string | null;
  /** Inline meta fields — only available on EntityGql (single-entity queries), not list queries */
  meta?: { key: string; value: string }[];
  /** Inline notes — only available on EntityGql (single-entity queries), not list queries */
  notes?: string;
}

export interface Interaction {
  id: string;
  kind: string;
  occurredAt: string;
  subject: string;
  notes: string;
  participants: string[];
}

/** Velocity metric for a single stat box. */
export interface VelocityMetric {
  /** Absolute change (current - twoWeeksAgo). Positive = growth. */
  delta: number;
  /** Percentage change, or null if previous count was 0. */
  pct: number | null;
}

export interface KissingerFunnelData {
  stats: GraphStats;
  /** Total person entities */
  totalContacts: number;
  /** Total org entities */
  totalOrgs: number;
  /** Recent interactions (last 30 days) */
  recentInteractionCount: number;
  /** People entities as potential prospects */
  prospects: EntitySummary[];
  /** Velocity metrics for the past 2 weeks */
  velocity: {
    contacts: VelocityMetric;
    orgs: VelocityMetric;
    totalEntities: VelocityMetric;
    totalEdges: VelocityMetric;
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

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

const VELOCITY_STATS_QUERY = `
  query VelocityStats($beforeTs: String!) {
    velocityStats(beforeTs: $beforeTs) {
      totalEntitiesBefore
      totalEdgesBefore
      entitiesByKindBefore { kind count }
    }
  }
`;

const ENTITIES_QUERY = `
  query Entities($kind: String, $first: Int) {
    entities(kind: $kind, first: $first) {
      edges {
        node {
          id
          kind
          name
          tags
          updatedAt
          archived
        }
      }
    }
  }
`;

export interface ContactDetail {
  id: string;
  kind: string;
  name: string;
  tags: string[];
  notes: string;
  meta: { key: string; value: string }[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface SearchHit {
  __typename: "EntitySearchHitGql" | "InteractionSearchHitGql";
  id: string;
  kind?: string;
  name?: string;
  tags?: string[];
  score: number;
  subject?: string;
  interactionKind?: string;
  occurredAt?: string;
  notesSnippet?: string;
}

export interface ContactsPage {
  contacts: EntitySummary[];
  /** Count of non-archived contacts in this page (not total across all pages) */
  total: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
}

// ---------------------------------------------------------------------------
// Segment types for the contacts CRM views
// ---------------------------------------------------------------------------

export type ContactSegment = "all" | "people" | "vc" | "prospects" | "other-orgs";

// Tags that identify a VC firm
const VC_TAGS = new Set(["vc", "investor"]);
// Tags that identify a prospect enterprise
const PROSPECT_TAGS = new Set(["prospect"]);

export function classifyOrg(tags: string[]): "vc" | "prospects" | "other-orgs" {
  if (tags.some((t) => VC_TAGS.has(t))) return "vc";
  if (tags.some((t) => PROSPECT_TAGS.has(t))) return "prospects";
  return "other-orgs";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Compute a velocity metric from current and two-weeks-ago counts. */
function computeVelocity(current: number, before: number): VelocityMetric {
  const delta = current - before;
  const pct = before > 0 ? (delta / before) * 100 : null;
  return { delta, pct };
}

async function _fetchKissingerFunnelData(): Promise<KissingerFunnelData | null> {
  // Cutoff: 14 days ago (UTC)
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // --- Main stats fetch (required) ---
  let rawStats: {
    totalEntities: number;
    totalEdges: number;
    entitiesByKind: { kind: string; count: number }[];
    edgesByType: { relationType: string; count: number }[];
  };
  try {
    const statsData = await gql<{
      graphStats: {
        totalEntities: number;
        totalEdges: number;
        entitiesByKind: { kind: string; count: number }[];
        edgesByType: { relationType: string; count: number }[];
      };
    }>(GRAPH_STATS_QUERY);
    rawStats = statsData.graphStats;
  } catch {
    // Kissinger may be unreachable in dev — return null gracefully
    return null;
  }

  const stats: GraphStats = {
    totalEntities: rawStats.totalEntities,
    totalEdges: rawStats.totalEdges,
    entitiesByKind: Object.fromEntries(
      rawStats.entitiesByKind.map((e) => [e.kind, e.count])
    ),
    edgesByType: Object.fromEntries(
      rawStats.edgesByType.map((e) => [e.relationType, e.count])
    ),
  };

  const totalContacts = stats.entitiesByKind["person"] ?? 0;
  const totalOrgs = stats.entitiesByKind["org"] ?? 0;

  // --- Velocity stats fetch (optional — fail gracefully with zero deltas) ---
  let velocityByKind: Record<string, number> = {};
  let totalEntitiesBefore = 0;
  let totalEdgesBefore = 0;
  try {
    const velocityData = await gql<{
      velocityStats: {
        totalEntitiesBefore: number;
        totalEdgesBefore: number;
        entitiesByKindBefore: { kind: string; count: number }[];
      };
    }>(VELOCITY_STATS_QUERY, { beforeTs: twoWeeksAgo });
    const rawVelocity = velocityData.velocityStats;
    velocityByKind = Object.fromEntries(
      rawVelocity.entitiesByKindBefore.map((e) => [e.kind, e.count])
    );
    totalEntitiesBefore = rawVelocity.totalEntitiesBefore;
    totalEdgesBefore = rawVelocity.totalEdgesBefore;
  } catch {
    // velocityStats not implemented on this backend — show zero deltas
  }

  const contactsBefore = velocityByKind["person"] ?? 0;
  const orgsBefore = velocityByKind["org"] ?? 0;

  return {
    stats,
    totalContacts,
    totalOrgs,
    // interactions not readily countable without a dedicated query; leave 0
    recentInteractionCount: 0,
    prospects: [],
    velocity: {
      contacts: computeVelocity(totalContacts, contactsBefore),
      orgs: computeVelocity(totalOrgs, orgsBefore),
      totalEntities: computeVelocity(stats.totalEntities, totalEntitiesBefore),
      totalEdges: computeVelocity(stats.totalEdges, totalEdgesBefore),
    },
  };
}

/**
 * Cached version of _fetchKissingerFunnelData.
 * TTL: 120 seconds. Tag: "funnel" — call revalidateTag("funnel") after graph mutations.
 */
export const fetchKissingerFunnelData = unstable_cache(
  _fetchKissingerFunnelData,
  ["kissinger-funnel"],
  { revalidate: 120, tags: ["funnel"] }
);

// ---------------------------------------------------------------------------
// Contacts list query (paginated, kind=person)
// ---------------------------------------------------------------------------

const CONTACTS_PAGE_QUERY = `
  query ContactsPage($kind: String, $first: Int, $after: String) {
    entities(kind: $kind, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        node {
          id
          kind
          name
          tags
          updatedAt
          archived
          location
        }
      }
    }
  }
`;

async function _fetchContactsPage(
  kind: "person" | "org",
  first: number,
  after?: string
): Promise<ContactsPage | null> {
  try {
    const data = await gql<{
      entities: {
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          startCursor: string | null;
          endCursor: string | null;
        };
        edges: { node: EntitySummary }[];
      };
    }>(CONTACTS_PAGE_QUERY, { kind, first, after });

    const raw = data.entities;
    const contacts = raw.edges.map((e) => e.node).filter((e) => !e.archived);
    return {
      contacts,
      total: contacts.length,
      hasNextPage: raw.pageInfo.hasNextPage,
      hasPreviousPage: raw.pageInfo.hasPreviousPage,
      endCursor: raw.pageInfo.endCursor,
      startCursor: raw.pageInfo.startCursor,
    };
  } catch {
    return null;
  }
}

/**
 * Cached version of _fetchContactsPage.
 * TTL: 60 seconds. Tag: "contacts" — call revalidateTag("contacts") after mutations.
 */
export const fetchContactsPage = unstable_cache(
  _fetchContactsPage,
  ["contacts-page"],
  { revalidate: 60, tags: ["contacts"] }
);

// ---------------------------------------------------------------------------
// Fetch all entities of a kind (multi-page, for segmented views)
// ---------------------------------------------------------------------------

async function _fetchAllEntities(kind: "person" | "org"): Promise<EntitySummary[]> {
  const PAGE = 500;
  const all: EntitySummary[] = [];
  let cursor: string | undefined;
  let safety = 0;

  while (safety < 20) {
    safety++;
    const data = await gql<{
      entities: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        edges: { node: EntitySummary }[];
      };
    }>(CONTACTS_PAGE_QUERY, { kind, first: PAGE, after: cursor });

    const raw = data.entities;
    const nodes = raw.edges.map((e) => e.node).filter((e) => !e.archived);
    all.push(...nodes);

    if (!raw.pageInfo.hasNextPage || !raw.pageInfo.endCursor) break;
    cursor = raw.pageInfo.endCursor;
  }

  return all;
}

/**
 * Cached fetch of ALL entities of a given kind (full pagination).
 * TTL: 120 seconds. Tag: "contacts" — call revalidateTag("contacts") after mutations.
 *
 * Use this for org sub-segments (vc, prospects, other-orgs) where tag-based filtering
 * must be done client-side across the full dataset (Kissinger has no server-side tag filter).
 * With 5,800+ orgs in the graph, prospect-tagged orgs can appear anywhere in the cursor order,
 * so fetching a limited page (200) may miss them entirely.
 */
export async function fetchAllEntities(kind: "person" | "org"): Promise<EntitySummary[]> {
  const cached = unstable_cache(
    _fetchAllEntities,
    [`all-entities-${kind}`],
    { revalidate: 120, tags: ["contacts"] }
  );
  return cached(kind);
}

export interface SegmentedContacts {
  people: EntitySummary[];
  vc: EntitySummary[];
  prospects: EntitySummary[];
  otherOrgs: EntitySummary[];
  /** Full entity details for prospects (includes meta fields like hq, revenue, employees). */
  prospectDetails: Map<string, ContactDetail>;
  /** Full entity details for people (includes meta fields like company, title). */
  peopleDetails: Map<string, ContactDetail>;
}

/**
 * Fetch full entity details for a set of entity IDs in parallel.
 * Used to enrich the prospects tab with meta fields (hq, revenue, employees).
 */
async function fetchEntityDetails(ids: string[]): Promise<Map<string, ContactDetail>> {
  const results = await Promise.allSettled(
    ids.map((id) =>
      gql<{ entity: ContactDetail }>(ENTITY_DETAIL_QUERY, { id }).then(
        (d) => d.entity
      )
    )
  );
  const map = new Map<string, ContactDetail>();
  for (let i = 0; i < ids.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      map.set(ids[i], r.value);
    }
  }
  return map;
}

export async function fetchSegmentedContacts(): Promise<SegmentedContacts | null> {
  try {
    const [allPeople, allOrgs] = await Promise.all([
      fetchAllEntities("person"),
      fetchAllEntities("org"),
    ]);

    // BIS-327: Exclude investor kinds from Contacts queries.
    // Investor people (tagged vc/investor) belong on the /investors page, not /contacts.
    const people = allPeople.filter((p) => !p.tags.some((t) => INVESTOR_PERSON_TAGS.has(t)));

    const vc: EntitySummary[] = [];
    const prospects: EntitySummary[] = [];
    const otherOrgs: EntitySummary[] = [];

    for (const org of allOrgs) {
      const seg = classifyOrg(org.tags);
      // VC orgs are now exclusively on /investors — exclude from contacts
      if (seg === "vc") vc.push(org);
      else if (seg === "prospects") prospects.push(org);
      else otherOrgs.push(org);
    }

    // Fetch full details for prospects and people to surface meta fields in the UI
    const [prospectDetails, peopleDetails] = await Promise.all([
      fetchEntityDetails(prospects.map((p) => p.id)),
      fetchEntityDetails(people.map((p) => p.id)),
    ]);

    return { people, vc, prospects, otherOrgs, prospectDetails, peopleDetails };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Single entity detail
// ---------------------------------------------------------------------------

const ENTITY_DETAIL_QUERY = `
  query EntityDetail($id: String!) {
    entity(id: $id) {
      id
      kind
      name
      tags
      notes
      meta { key value }
      createdAt
      updatedAt
      archived
    }
  }
`;

const EDGES_FROM_QUERY = `
  query EdgesFrom($entityId: String!, $first: Int) {
    edgesFrom(entityId: $entityId, first: $first) {
      edges {
        node {
          source
          target
          relation
          valueFrame
          strength
          notes
          createdAt
          updatedAt
        }
      }
    }
  }
`;

export interface EntityEdge {
  source: string;
  target: string;
  relation: string;
  valueFrame: string;
  strength: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedEdge extends EntityEdge {
  /** Resolved name of the target entity (fetched separately). */
  targetName: string;
  /** Kind of the target entity (person | org). */
  targetKind: string;
}

/** A person connected to an org via works_at, with their role extracted. */
export interface PersonAtOrg {
  id: string;
  name: string;
  /** Role/title extracted from the edge notes or person meta. */
  role: string;
  strength: number;
  edgeNotes: string;
}

const EDGES_TO_QUERY = `
  query EdgesTo($entityId: String!, $first: Int) {
    edgesTo(entityId: $entityId, first: $first) {
      edges {
        node {
          source
          target
          relation
          valueFrame
          strength
          notes
          createdAt
          updatedAt
        }
      }
    }
  }
`;

const ENTITY_NAME_QUERY = `
  query EntityName($id: String!) {
    entity(id: $id) {
      id
      name
      kind
      meta { key value }
    }
  }
`;

/**
 * Extract a role/title string from an edge's notes or person meta.
 * Edge notes typically look like "Co-Founder & COO at Anduril Industries".
 * We strip the " at OrgName" suffix if present to get just the title.
 */
function extractRole(edgeNotes: string, personMeta: { key: string; value: string }[]): string {
  // Try meta.title first (cleanest source)
  const metaTitle = personMeta.find((m) => m.key === "title")?.value;
  if (metaTitle) return metaTitle;

  // Fall back to parsing edge notes: strip " at <OrgName>" suffix
  if (edgeNotes) {
    const atIdx = edgeNotes.lastIndexOf(" at ");
    if (atIdx > 0) return edgeNotes.slice(0, atIdx);
    return edgeNotes;
  }

  return "";
}

export async function fetchContactDetail(
  id: string
): Promise<{ contact: ContactDetail; edges: ResolvedEdge[]; peopleAtOrg: PersonAtOrg[] } | null> {
  try {
    const [entityData, edgesData] = await Promise.all([
      gql<{ entity: ContactDetail }>(ENTITY_DETAIL_QUERY, { id }),
      gql<{
        edgesFrom: { edges: { node: EntityEdge }[] };
      }>(EDGES_FROM_QUERY, { entityId: id, first: 50 }).catch(() => ({
        edgesFrom: { edges: [] },
      })),
    ]);

    const contact = entityData.entity;
    const rawEdges = edgesData.edgesFrom.edges.map((e) => e.node);

    // Resolve target entity names and kinds in parallel (best-effort)
    const resolvedEdges: ResolvedEdge[] = await Promise.all(
      rawEdges.map(async (edge) => {
        try {
          const nameData = await gql<{
            entity: { id: string; name: string; kind: string; meta: { key: string; value: string }[] };
          }>(ENTITY_NAME_QUERY, { id: edge.target });
          return { ...edge, targetName: nameData.entity.name, targetKind: nameData.entity.kind };
        } catch {
          return { ...edge, targetName: edge.target, targetKind: "unknown" };
        }
      })
    );

    // For org entities, fetch reverse edges (people who work there)
    let peopleAtOrg: PersonAtOrg[] = [];
    if (contact.kind === "org") {
      const reverseEdgesData = await gql<{
        edgesTo: { edges: { node: EntityEdge }[] };
      }>(EDGES_TO_QUERY, { entityId: id, first: 100 }).catch(() => ({
        edgesTo: { edges: [] },
      }));

      const worksAtEdges = reverseEdgesData.edgesTo.edges
        .map((e) => e.node)
        .filter((e) => e.relation === "works_at");

      // Resolve person details in parallel
      peopleAtOrg = await Promise.allSettled(
        worksAtEdges.map(async (edge) => {
          try {
            const personData = await gql<{
              entity: { id: string; name: string; kind: string; meta: { key: string; value: string }[] };
            }>(ENTITY_NAME_QUERY, { id: edge.source });
            const role = extractRole(edge.notes, personData.entity.meta);
            return {
              id: edge.source,
              name: personData.entity.name,
              role,
              strength: edge.strength,
              edgeNotes: edge.notes,
            } satisfies PersonAtOrg;
          } catch {
            return {
              id: edge.source,
              name: edge.source,
              role: edge.notes || "",
              strength: edge.strength,
              edgeNotes: edge.notes,
            } satisfies PersonAtOrg;
          }
        })
      ).then((results) =>
        results
          .filter((r): r is PromiseFulfilledResult<PersonAtOrg> => r.status === "fulfilled")
          .map((r) => r.value)
          .sort((a, b) => b.strength - a.strength)
      );
    }

    return {
      contact,
      edges: resolvedEdges,
      peopleAtOrg,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Contact Events (CRM timeline) — BIS-399 / NET-2
// ---------------------------------------------------------------------------

export type ContactEventKind = "Note" | "Meeting" | "Email" | "Call" | "Custom";

export interface ContactEvent {
  id: string;
  personId: string;
  kind: ContactEventKind;
  notes: string;
  occurredAt: string;
  createdAt: string;
}

export const CONTACT_EVENTS_QUERY = `
  query ContactEvents($personId: ID!) {
    contactEvents(personId: $personId) {
      id
      personId
      kind
      notes
      occurredAt
      createdAt
    }
  }
`;

export const CREATE_CONTACT_EVENT_MUTATION = `
  mutation CreateContactEvent($personId: ID!, $kind: ContactEventKind!, $notes: String!, $occurredAt: String!) {
    createContactEvent(personId: $personId, kind: $kind, notes: $notes, occurredAt: $occurredAt) {
      id
      personId
      kind
      notes
      occurredAt
      createdAt
    }
  }
`;

export const DELETE_CONTACT_EVENT_MUTATION = `
  mutation DeleteContactEvent($id: ID!) {
    deleteContactEvent(id: $id)
  }
`;

/**
 * Fetch all CRM events for a contact (person or org).
 * Returns empty array if Kissinger is unreachable or feature not yet deployed.
 */
export async function fetchContactEvents(personId: string): Promise<ContactEvent[]> {
  try {
    const data = await gql<{ contactEvents: ContactEvent[] }>(
      CONTACT_EVENTS_QUERY,
      { personId }
    );
    return data.contactEvents ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Intro Path (NET-5 / BIS-402)
// ---------------------------------------------------------------------------

/**
 * Team member Kissinger person IDs used as BFS source nodes for intro paths.
 *
 * Configure via environment variable TEAM_PERSON_IDS (comma-separated).
 * Example: TEAM_PERSON_IDS=id1,id2,id3
 *
 * Until "knows" edges are imported into the graph, introPath will return
 * found:false for all queries — this is expected, and the UI shows an empty
 * state prompting LinkedIn import.
 */
export const TEAM_PERSON_IDS: string[] = (
  process.env.TEAM_PERSON_IDS ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export interface IntroPathStep {
  personId: string;
  name: string;
  title: string | null;
  organization: string | null;
  relationToNext: string | null;
}

export interface IntroPathResult {
  found: boolean;
  hops: number;
  steps: IntroPathStep[];
}

export const INTRO_PATH_QUERY = `
  query IntroPath($targetPersonId: String!, $sourcePersonIds: [String!]!, $maxHops: Int) {
    introPath(targetPersonId: $targetPersonId, sourcePersonIds: $sourcePersonIds, maxHops: $maxHops) {
      found
      hops
      steps {
        personId
        name
        title
        organization
        relationToNext
      }
    }
  }
`;

/**
 * Fetch the shortest warm intro path from any team member to the target person.
 *
 * @param targetPersonId  The Kissinger entity ID of the contact to reach.
 * @param sourcePersonIds Optional override — defaults to TEAM_PERSON_IDS.
 * @param maxHops         Maximum BFS depth (0 = unlimited).
 */
export async function fetchIntroPath(
  targetPersonId: string,
  sourcePersonIds: string[] = TEAM_PERSON_IDS,
  maxHops = 0
): Promise<IntroPathResult> {
  if (sourcePersonIds.length === 0) {
    // No source IDs configured — skip the network call.
    return { found: false, hops: 0, steps: [] };
  }
  try {
    const data = await gql<{ introPath: IntroPathResult }>(INTRO_PATH_QUERY, {
      targetPersonId,
      sourcePersonIds,
      maxHops,
    });
    return data.introPath;
  } catch {
    return { found: false, hops: 0, steps: [] };
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const SEARCH_QUERY = `
  query Search($query: String!, $limit: Int) {
    search(query: $query, limit: $limit) {
      __typename
      ... on EntitySearchHitGql {
        id
        kind
        name
        tags
        score
      }
      ... on InteractionSearchHitGql {
        id
        subject
        interactionKind
        occurredAt
        notesSnippet
        score
      }
    }
  }
`;

export async function searchKissinger(
  query: string,
  limit = 30
): Promise<SearchHit[]> {
  try {
    const data = await gql<{ search: SearchHit[] }>(SEARCH_QUERY, {
      query,
      limit,
    });
    return data.search ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Outreach: fetch prospect contacts with org context
// ---------------------------------------------------------------------------

/**
 * A prospect contact enriched with their org's sector tags.
 * Used by the Outreach Task Engine.
 */
export type OutreachStage = "cold" | "touched_1" | "touched_2" | "touched_3" | "responded";

export interface ProspectContactRaw {
  id: string;
  name: string;
  title: string;
  company: string;
  /** Sector tags from the linked org entity */
  sector: string[];
  fitTier: "high" | "medium" | "low";
  notes: string;
  /** ID of the linked org (if resolved) */
  orgId?: string;
  /** Current outreach cadence stage */
  outreachStage: OutreachStage;
  /** LinkedIn profile URL from meta (linkedin_url or linkedin key) */
  linkedinUrl: string;
}

const PROSPECT_CONTACT_QUERY = `
  query ProspectContacts($first: Int, $after: String) {
    entities(kind: "person", first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          tags
        }
      }
    }
  }
`;

const EDGES_FROM_PERSON_QUERY = `
  query PersonEdges($entityId: String!, $first: Int) {
    edgesFrom(entityId: $entityId, first: $first) {
      edges {
        node {
          source
          target
          relation
          notes
        }
      }
    }
  }
`;

/**
 * Fetch all prospect contacts (tagged "prospect-contact") from Kissinger,
 * and enrich each with their org's sector tags via the works_at edge.
 *
 * Returns null if Kissinger is unreachable.
 */
export async function fetchProspectContacts(): Promise<ProspectContactRaw[] | null> {
  try {
    // Fetch all person entities in pages (Kissinger has 7k+ people)
    // We only need those tagged "prospect-contact"
    const PAGE = 500;
    const prospectPersons: { id: string; name: string; tags: string[] }[] = [];
    let cursor: string | undefined;
    let safety = 0;

    while (safety < 30) {
      safety++;
      const data = await gql<{
        entities: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: { id: string; name: string; tags: string[] } }[];
        };
      }>(PROSPECT_CONTACT_QUERY, { first: PAGE, after: cursor });

      const raw = data.entities;
      const filtered = raw.edges
        .map((e) => e.node)
        .filter((n) => n.tags.includes("prospect-contact"));
      prospectPersons.push(...filtered);

      if (!raw.pageInfo.hasNextPage || !raw.pageInfo.endCursor) break;
      cursor = raw.pageInfo.endCursor;
    }

    if (prospectPersons.length === 0) return [];

    // For each prospect person, fetch their entity detail (for title/company meta)
    // and their outgoing edges to find the linked org
    const enriched = await Promise.allSettled(
      prospectPersons.map(async (person) => {
        const [detail, edgesData] = await Promise.all([
          gql<{ entity: ContactDetail }>(ENTITY_DETAIL_QUERY, { id: person.id }, { tags: ["contacts"] }),
          gql<{ edgesFrom: { edges: { node: EntityEdge }[] } }>(
            EDGES_FROM_PERSON_QUERY,
            { entityId: person.id, first: 20 }
          ).catch(() => ({ edgesFrom: { edges: [] } })),
        ]);

        const meta = Object.fromEntries(
          detail.entity.meta.map((m) => [m.key, m.value])
        );

        // Apollo-re-enriched contacts store title/org inside a JSON blob at key "meta"
        // rather than as direct top-level meta keys. Fall back to the nested blob when
        // the direct keys are absent.
        let nestedMeta: Record<string, string> = {};
        if (meta["meta"]) {
          try {
            nestedMeta = JSON.parse(meta["meta"]) as Record<string, string>;
          } catch {
            // not JSON — ignore
          }
        }

        const title = meta["title"] ?? nestedMeta["title"] ?? "";
        const company = meta["company"] ?? nestedMeta["org"] ?? "";

        // Find the linked org via works_at edge
        const worksAtEdge = edgesData.edgesFrom.edges
          .map((e) => e.node)
          .find((e) => e.relation === "works_at");

        let sector: string[] = [];
        let fitTier: "high" | "medium" | "low" = "high";
        let orgId: string | undefined;

        if (worksAtEdge) {
          orgId = worksAtEdge.target;
          // Fetch the org to get its sector tags
          try {
            const orgData = await gql<{ entity: { tags: string[] } }>(
              `query OrgTags($id: String!) { entity(id: $id) { tags } }`,
              { id: orgId }
            );
            const orgTags = orgData.entity.tags;
            // Extract sector tags (exclude meta tags like prospect, eloso, fit-*)
            sector = orgTags.filter(
              (t) => !["prospect", "eloso"].includes(t) && !t.startsWith("fit-")
            );
            // Extract fit tier
            const fitTag = orgTags.find((t) => t.startsWith("fit-"));
            if (fitTag === "fit-high") fitTier = "high";
            else if (fitTag === "fit-medium") fitTier = "medium";
            else if (fitTag === "fit-low") fitTier = "low";
          } catch {
            // Org fetch failed — proceed with empty sector
          }
        }

        const outreachStageMeta = meta["outreach_stage"] ?? "cold";
        const validStages: OutreachStage[] = ["cold", "touched_1", "touched_2", "touched_3", "responded"];
        const outreachStage: OutreachStage = validStages.includes(outreachStageMeta as OutreachStage)
          ? (outreachStageMeta as OutreachStage)
          : "cold";

        const linkedinUrl = meta["linkedin_url"] ?? meta["linkedin"] ?? nestedMeta["linkedin_url"] ?? nestedMeta["linkedin"] ?? "";

        return {
          id: person.id,
          name: person.name,
          title,
          company,
          sector,
          fitTier,
          notes: "",
          orgId,
          outreachStage,
          linkedinUrl,
        } satisfies ProspectContactRaw;
      })
    );

    const results: ProspectContactRaw[] = [];
    for (const r of enriched) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
    return results;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Investor-specific types and queries (BIS-325–333)
//
// ARCHITECTURE NOTE: Kissinger's EntityKind is a closed Rust enum.
// investor_firm and investor_person do NOT exist as native kinds.
// We use kind=org + tag=vc for investor firms, kind=person + tag=vc for
// investor people. This is consistent with classifyOrg() and requires no
// Kissinger recompile. The UI layer applies investor-specific rendering
// based on tags.
// ---------------------------------------------------------------------------

/** Tags that identify a VC / investor firm */
export const INVESTOR_FIRM_TAGS = new Set(["vc", "investor"]);

/** Tags that identify a VC / investor person */
export const INVESTOR_PERSON_TAGS = new Set(["vc", "investor"]);

/** Stage focus tags used to determine stage fit */
export const STAGE_TAGS = new Set([
  "pre-seed", "seed", "series-a", "series-b", "series-c",
  "growth", "late-stage", "venture", "corporate-vc", "family-office",
  "accelerator", "company-builder",
]);

/** Thesis tags for supply chain / AI alignment */
export const THESIS_MATCH_TAGS = new Set([
  "supply-chain", "logistics", "manufacturing", "industrial",
  "enterprise", "ai", "b2b", "saas", "deep-tech", "freight",
]);

export function isInvestorFirm(entity: EntitySummary): boolean {
  return entity.kind === "org" && entity.tags.some((t) => INVESTOR_FIRM_TAGS.has(t));
}

/**
 * US state names and territories — used to identify US-based contacts.
 */
const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
  "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
  "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
  "washington", "west virginia", "wisconsin", "wyoming",
  // Territories
  "puerto rico", "guam", "district of columbia", "dc",
]);

/**
 * Returns true if the entity's location indicates a US-based contact.
 * Handles variants like "United States", "USA", "US", "California, US",
 * "New York, NY", "Austin, Texas", etc.
 */
export function isUSContact(entity: EntitySummary): boolean {
  const loc = (entity.location ?? "").toLowerCase().trim();
  if (!loc) return false;

  // Direct country matches
  if (loc === "us" || loc === "usa" || loc === "united states" || loc === "united states of america") {
    return true;
  }
  // Contains explicit US markers
  if (loc.includes("united states") || loc.includes(", usa") || loc.includes(", us")) {
    return true;
  }
  // Matches ", US" at end (e.g. "San Francisco, CA, US")
  if (/,\s*us\b/.test(loc)) {
    return true;
  }
  // Check if location ends with a US state name or abbreviation
  // e.g. "Austin, Texas", "New York, NY"
  const parts = loc.split(",").map((p) => p.trim());
  const lastPart = parts[parts.length - 1];
  if (US_STATE_NAMES.has(lastPart)) return true;
  // Two-letter state abbreviations (e.g. "CA", "NY", "TX") — only if there are multiple parts
  if (parts.length >= 2 && /^[a-z]{2}$/.test(lastPart)) {
    // Could be a US state abbreviation — we accept it if it's plausible
    // (2-letter codes are overwhelmingly US states in this dataset)
    return true;
  }

  return false;
}

export function isInvestorPerson(entity: EntitySummary): boolean {
  return entity.kind === "person" && entity.tags.some((t) => INVESTOR_PERSON_TAGS.has(t));
}

export interface InvestorFirm extends EntitySummary {
  stage: string;
  checkSize: string;
  location: string;
  thesis: string;
  priority: string;
  pipelineStage: string;
  website: string;
  sectorFit: string;
  fitScore?: number;
}

export interface InvestorPerson extends EntitySummary {
  title: string;
  firmName: string;
  firmId?: string;
  incentive: string;
  linkedinUrl: string;
  priority: string;
  fitScore?: number;
}

export interface InvestorData {
  firms: InvestorFirm[];
  people: InvestorPerson[];
  firmDetails: Map<string, ContactDetail>;
  peopleDetails: Map<string, ContactDetail>;
}

function metaVal(detail: ContactDetail, key: string): string {
  return detail.meta.find((m) => m.key === key)?.value ?? "";
}

/**
 * Fetch all investor firms (kind=org, tag=vc) and investor people (kind=person, tag=vc).
 * Excludes investors from the regular contacts/prospects queries.
 */
export async function fetchInvestorData(): Promise<InvestorData | null> {
  try {
    const [allOrgs, allPeople] = await Promise.all([
      fetchAllEntities("org"),
      fetchAllEntities("person"),
    ]);

    const firmSummaries = allOrgs.filter(isInvestorFirm);
    const personSummaries = allPeople.filter(isInvestorPerson);

    // Fetch full details for enriched meta
    const [firmDetails, peopleDetails] = await Promise.all([
      fetchEntityDetails(firmSummaries.map((f) => f.id)),
      fetchEntityDetails(personSummaries.map((p) => p.id)),
    ]);

    const firms: InvestorFirm[] = firmSummaries.map((f) => {
      const detail = firmDetails.get(f.id);
      return {
        ...f,
        stage: detail ? metaVal(detail, "stage") : "",
        checkSize: detail ? metaVal(detail, "check_size") : "",
        location: detail ? metaVal(detail, "location") : "",
        thesis: detail ? metaVal(detail, "thesis") : "",
        priority: detail ? metaVal(detail, "priority") : "",
        pipelineStage: detail ? metaVal(detail, "pipeline_stage") : "Research",
        website: detail ? metaVal(detail, "website") : "",
        sectorFit: detail ? metaVal(detail, "sector_fit") : "",
      };
    });

    const people: InvestorPerson[] = personSummaries.map((p) => {
      const detail = peopleDetails.get(p.id);
      return {
        ...p,
        title: detail ? metaVal(detail, "title") : "",
        firmName: detail ? metaVal(detail, "org") : "",
        incentive: detail ? metaVal(detail, "incentive") : "",
        linkedinUrl: detail ? (metaVal(detail, "linkedin_url") || metaVal(detail, "linkedin")) : "",
        priority: detail ? metaVal(detail, "priority") : "",
      };
    });

    return { firms, people, firmDetails, peopleDetails };
  } catch {
    return null;
  }
}

/**
 * Fetch a single investor firm with full details, people, and edges.
 * Reuses fetchContactDetail which already handles reverse edges (peopleAtOrg).
 */
export async function fetchInvestorFirmDetail(id: string) {
  return fetchContactDetail(id);
}

/**
 * Fetch a single investor person with full details and firm link.
 */
export async function fetchInvestorPersonDetail(id: string) {
  return fetchContactDetail(id);
}

// ---------------------------------------------------------------------------
// Pipeline stage mutation
// ---------------------------------------------------------------------------

const UPDATE_PIPELINE_STAGE_MUTATION = `
  mutation UpdatePipelineStage($id: String!, $input: UpdateEntityInput!) {
    updateEntity(id: $id, input: $input) {
      id name meta { key value }
    }
  }
`;

/**
 * Update an investor firm's pipeline stage.
 * pipeline_stage is stored as a meta field on the entity.
 */
export async function updatePipelineStage(
  firmId: string,
  stage: string
): Promise<boolean> {
  try {
    // We need to fetch current meta to merge (updateEntity replaces meta entirely)
    const detail = await gql<{ entity: ContactDetail }>(
      `query E($id: String!) { entity(id: $id) { meta { key value } } }`,
      { id: firmId }
    );
    const existingMeta = detail.entity.meta ?? [];
    const withoutStage = existingMeta.filter((m) => m.key !== "pipeline_stage");
    const newMeta = [...withoutStage, { key: "pipeline_stage", value: stage }];

    await gql(UPDATE_PIPELINE_STAGE_MUTATION, {
      id: firmId,
      input: { meta: newMeta },
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// LinkedIn outreach interaction logging
// ---------------------------------------------------------------------------

const LOG_INTERACTION_MUTATION = `
  mutation LogInteraction($input: CreateInteractionInput!) {
    logInteraction(input: $input) {
      id
      kind
      occurredAt
      subject
      notes
    }
  }
`;

/**
 * Log a LinkedIn outreach interaction for a contact.
 * Encodes the platform in the notes field as a prefix (Option A).
 */
export async function logLinkedInOutreach(
  contactId: string,
  message: string,
  occurredAt: string
): Promise<boolean> {
  try {
    await gql(LOG_INTERACTION_MUTATION, {
      input: {
        kind: "message",
        subject: "LinkedIn outreach",
        notes: `Platform: LinkedIn\n\n${message}`,
        participantIds: [contactId],
        occurredAt,
      },
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Funnel Kanban — sales pipeline stages
// ---------------------------------------------------------------------------

export const FUNNEL_STAGES = [
  "Identified",
  "Researched",
  "Contacted",
  "Engaged",
  "Meeting Booked",
  "Proposal Sent",
  "Closed / Nurture",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelContact {
  id: string;
  name: string;
  company: string;
  title: string;
  tags: string[];
  funnelStage: FunnelStage;
  updatedAt: string;
}

export type FunnelKanbanData = Record<FunnelStage, FunnelContact[]>;

/**
 * Update a contact's funnel_stage meta field.
 * Merges with existing meta so other keys are preserved.
 */
export async function updateContactFunnelStage(
  contactId: string,
  stage: FunnelStage
): Promise<boolean> {
  try {
    const detail = await gql<{ entity: ContactDetail }>(
      `query E($id: String!) { entity(id: $id) { meta { key value } } }`,
      { id: contactId }
    );
    const existingMeta = detail.entity.meta ?? [];
    const withoutStage = existingMeta.filter((m) => m.key !== "funnel_stage");
    const newMeta = [...withoutStage, { key: "funnel_stage", value: stage }];

    await gql(UPDATE_PIPELINE_STAGE_MUTATION, {
      id: contactId,
      input: { meta: newMeta },
    });
    return true;
  } catch {
    return false;
  }
}

async function _fetchFunnelKanbanData(): Promise<FunnelKanbanData | null> {
  try {
    // Fetch all person entities with meta
    const people = await fetchAllEntities("person");

    const grouped = Object.fromEntries(
      FUNNEL_STAGES.map((s) => [s, [] as FunnelContact[]])
    ) as unknown as FunnelKanbanData;

    for (const person of people) {
      const stageMeta = person.meta?.find((m) => m.key === "funnel_stage")?.value;
      const stage: FunnelStage =
        stageMeta && (FUNNEL_STAGES as readonly string[]).includes(stageMeta)
          ? (stageMeta as FunnelStage)
          : "Identified";

      const company = person.meta?.find((m) => m.key === "company")?.value ?? "";
      const title = person.meta?.find((m) => m.key === "title")?.value ?? "";

      grouped[stage].push({
        id: person.id,
        name: person.name,
        company,
        title,
        tags: person.tags,
        funnelStage: stage,
        updatedAt: person.updatedAt,
      });
    }

    return grouped;
  } catch {
    return null;
  }
}

export const fetchFunnelKanbanData = unstable_cache(
  _fetchFunnelKanbanData,
  ["funnel-kanban"],
  { revalidate: 60, tags: ["contacts", "funnel"] }
);

// ---------------------------------------------------------------------------
// Outreach cadence mutations (BIS-396)
// ---------------------------------------------------------------------------

const RECORD_OUTREACH_TOUCH_MUTATION = `
  mutation RecordOutreachTouch($personId: String!, $touchNumber: Int!, $notes: String) {
    recordOutreachTouch(personId: $personId, touchNumber: $touchNumber, notes: $notes) {
      interactionId
      newStage
    }
  }
`;

const RECORD_OUTREACH_RESPONSE_MUTATION = `
  mutation RecordOutreachResponse($personId: String!, $responseType: ResponseTypeGql!, $notes: String) {
    recordOutreachResponse(personId: $personId, responseType: $responseType, notes: $notes) {
      interactionId
      responseType
    }
  }
`;

export type ResponseType = "Interested" | "NotNow" | "WrongPerson" | "NoReply" | "Bounced";

/**
 * Record an outreach touch for a person, advancing the outreach stage.
 * touch_number must match the current stage (1 for cold, 2 for touched_1, 3 for touched_2).
 * Returns the new stage on success.
 */
export async function recordOutreachTouch(
  personId: string,
  touchNumber: number,
  notes?: string
): Promise<{ interactionId: string; newStage: OutreachStage }> {
  const data = await gql<{
    recordOutreachTouch: { interactionId: string; newStage: string };
  }>(RECORD_OUTREACH_TOUCH_MUTATION, { personId, touchNumber, notes }, { noStore: true });
  return {
    interactionId: data.recordOutreachTouch.interactionId,
    newStage: data.recordOutreachTouch.newStage as OutreachStage,
  };
}

/**
 * Record a prospect response, moving them to the "responded" stage.
 * responseType must be one of: Interested, NotNow, WrongPerson, NoReply, Bounced
 */
export async function recordOutreachResponse(
  personId: string,
  responseType: ResponseType,
  notes?: string
): Promise<{ interactionId: string; responseType: string } | null> {
  try {
    const data = await gql<{
      recordOutreachResponse: { interactionId: string; responseType: string };
    }>(RECORD_OUTREACH_RESPONSE_MUTATION, { personId, responseType, notes });
    return data.recordOutreachResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sector aggregates (BIS-395)
// ---------------------------------------------------------------------------

/** Aggregated statistics for a single industry sector. */
export interface SectorAggregate {
  /** The sector name (from sector_primary meta on org entities). */
  sector: string;
  /** Number of non-archived org entities in this sector. */
  orgCount: number;
  /** Orgs with at least 1 prospect-contact person linked via works_at. */
  prospectsWithContacts: number;
  /** Mean ICP fit score (0.0–1.0), or null if unavailable. */
  avgIcpScore: number | null;
  /** Sum of apollo_market_size across orgs in sector, or null if none set. */
  apolloMarketSize: number | null;
}

const SECTOR_AGGREGATES_QUERY = `
  query SectorAggregates {
    sectorAggregates {
      sector
      orgCount
      prospectsWithContacts
      avgIcpScore
      apolloMarketSize
    }
  }
`;

/**
 * Fetch sector aggregates from Kissinger.
 * Returns empty array on error (Kissinger offline).
 */
export async function fetchSectorAggregates(): Promise<SectorAggregate[]> {
  try {
    const data = await gql<{ sectorAggregates: SectorAggregate[] }>(
      SECTOR_AGGREGATES_QUERY
    );
    return data.sectorAggregates ?? [];
  } catch {
    return [];
  }
}

/**
 * Fetch org entities tagged with a specific sector value (sector_primary meta).
 * Used by the /sectors/[sector] page.
 */
export async function fetchOrgsBySector(sector: string): Promise<EntitySummary[]> {
  try {
    const PAGE = 500;
    const all: EntitySummary[] = [];
    let cursor: string | undefined;
    let safety = 0;

    while (safety < 10) {
      safety++;
      const data = await gql<{
        entities: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: EntitySummary }[];
        };
      }>(CONTACTS_PAGE_QUERY, { kind: "org", first: PAGE, after: cursor });

      const raw = data.entities;
      all.push(...raw.edges.map((e) => e.node).filter((e) => !e.archived));

      if (!raw.pageInfo.hasNextPage || !raw.pageInfo.endCursor) break;
      cursor = raw.pageInfo.endCursor;
    }

    // Filter in JS: entities with matching sector_primary meta
    // Since we can't filter by meta server-side, we use fetchEntityDetails for a subset
    // For the stub page, return all orgs (sector filtering would require meta detail fetch)
    // TODO: Add a server-side sectorOrgs query if needed
    return all;
  } catch {
    return [];
  }
}
