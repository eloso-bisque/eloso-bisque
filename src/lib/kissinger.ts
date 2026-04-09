/**
 * Kissinger GraphQL client helpers.
 *
 * All calls are server-side only — KISSINGER_API_URL must never be exposed
 * to the browser (no NEXT_PUBLIC_ prefix).
 */

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (KISSINGER_API_TOKEN) {
    headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  }

  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    // Next.js 14 cache: revalidate every 60 seconds
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(8000),
  });

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
  /** Inline meta fields — available when fetched via CONTACTS_PAGE_QUERY */
  meta?: { key: string; value: string }[];
  /** Inline notes — available when fetched via CONTACTS_PAGE_QUERY */
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

export async function fetchKissingerFunnelData(): Promise<KissingerFunnelData | null> {
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
          meta { key value }
          notes
        }
      }
    }
  }
`;

export async function fetchContactsPage(
  kind: "person" | "org" = "person",
  first: number = 50,
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

// ---------------------------------------------------------------------------
// Fetch all entities of a kind (multi-page, for segmented views)
// ---------------------------------------------------------------------------

async function fetchAllEntities(kind: "person" | "org"): Promise<EntitySummary[]> {
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
          notes
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
    const prospectPersons: { id: string; name: string; tags: string[]; notes: string }[] = [];
    let cursor: string | undefined;
    let safety = 0;

    while (safety < 30) {
      safety++;
      const data = await gql<{
        entities: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: { id: string; name: string; tags: string[]; notes: string } }[];
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
          gql<{ entity: ContactDetail }>(ENTITY_DETAIL_QUERY, { id: person.id }),
          gql<{ edgesFrom: { edges: { node: EntityEdge }[] } }>(
            EDGES_FROM_PERSON_QUERY,
            { entityId: person.id, first: 20 }
          ).catch(() => ({ edgesFrom: { edges: [] } })),
        ]);

        const meta = Object.fromEntries(
          detail.entity.meta.map((m) => [m.key, m.value])
        );
        const title = meta["title"] ?? "";
        const company = meta["company"] ?? "";

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

        return {
          id: person.id,
          name: person.name,
          title,
          company,
          sector,
          fitTier,
          notes: person.notes ?? "",
          orgId,
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
