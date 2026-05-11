/**
 * Helpers for building Kissinger GraphQL mock responses.
 *
 * The outreach page makes multiple GraphQL queries to http://localhost:8080/graphql.
 * These helpers generate the exact response shapes that the app code expects.
 */

import type { FixtureContact, FixtureSentContact } from "./jake-contacts";

/** Build a minimal person entity node (for the PROSPECT_CONTACT_QUERY scan) */
export function buildPersonNode(contact: FixtureContact) {
  return {
    id: contact.id,
    name: contact.name,
    tags: contact.tags,
  };
}

/** Build a minimal person node for a sent contact */
export function buildSentPersonNode(contact: FixtureSentContact) {
  return {
    id: contact.id,
    name: contact.name,
    tags: contact.tags,
  };
}

/** Build the ENTITY_DETAIL_QUERY response for a prospect contact */
export function buildEntityDetail(contact: FixtureContact) {
  const meta: { key: string; value: string }[] = [];

  if (contact.title) {
    meta.push({ key: "title", value: contact.title });
  }
  // LinkedIn CSV contacts have empty companyMeta — company resolved from org
  if (contact.companyMeta) {
    meta.push({ key: "company", value: contact.companyMeta });
  }
  if (contact.linkedinUrl) {
    meta.push({ key: "linkedin_url", value: contact.linkedinUrl });
  }
  // outreach_stage defaults to "cold" if omitted; include explicitly
  meta.push({ key: "outreach_stage", value: contact.outreachStage });

  return {
    entity: {
      id: contact.id,
      kind: "person",
      name: contact.name,
      tags: contact.tags,
      notes: "",
      meta,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      archived: false,
    },
  };
}

/** Build the ENTITY_DETAIL_QUERY response for a sent contact */
export function buildSentEntityDetail(contact: FixtureSentContact) {
  const meta: { key: string; value: string }[] = [
    { key: "title", value: contact.title },
    { key: "company", value: contact.company },
    { key: "outreach_stage", value: contact.outreachStage },
    { key: "outreach_message_sender", value: contact.outreachMessageSender },
  ];
  if (contact.linkedinUrl) {
    meta.push({ key: "linkedin_url", value: contact.linkedinUrl });
  }
  return {
    entity: {
      id: contact.id,
      kind: "person",
      name: contact.name,
      tags: contact.tags,
      notes: "",
      meta,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      archived: false,
    },
  };
}

/** Build the EDGES_FROM_PERSON_QUERY response — works_at edge pointing to org */
export function buildEdgesFrom(contact: FixtureContact) {
  // LinkedIn CSV contacts have a works_at edge; ones with companyMeta may or may not
  const edges = contact.orgId
    ? [
        {
          node: {
            source: contact.id,
            target: contact.orgId,
            relation: "works_at",
            notes: `${contact.title} at ${contact.orgName}`,
          },
        },
      ]
    : [];

  return {
    edgesFrom: { edges },
  };
}

/** Build the OrgTags query response */
export function buildOrgTags(contact: FixtureContact) {
  return {
    entity: {
      name: contact.orgName,
      tags: contact.orgTags,
    },
  };
}

/** Build a full paginated entities response (single page, no pagination) */
export function buildEntitiesPage(nodes: { id: string; name: string; tags: string[] }[]) {
  return {
    entities: {
      pageInfo: {
        hasNextPage: false,
        endCursor: null,
      },
      edges: nodes.map((node) => ({ node })),
    },
  };
}

/**
 * Determine which Kissinger query is being made by inspecting the request body.
 * Used in page.route() handlers to dispatch to the right mock response.
 */
export function detectQuery(body: { query?: string; variables?: Record<string, unknown> }): string {
  const q = body.query ?? "";

  // Order matters — more specific patterns first
  if (q.includes("edgesFrom") && q.includes("entityId")) return "EdgesFrom";
  if (q.includes("edgesFrom") && q.includes("entityId")) return "EdgesFrom";
  if (q.includes("OrgTags") || (q.includes("entity") && q.includes("tags") && body.variables?.["id"])) {
    const id = body.variables?.["id"] as string | undefined;
    if (id?.startsWith("org-")) return "OrgTags";
    return "EntityDetail";
  }
  if (q.includes("meta") && q.includes("notes") && body.variables?.["id"]) return "EntityDetail";
  if (q.includes("entities") && q.includes("pageInfo")) return "ProspectContactScan";
  if (q.includes("graphStats")) return "GraphStats";
  if (q.includes("velocityStats")) return "VelocityStats";
  if (q.includes("contactEvents")) return "ContactEvents";
  if (q.includes("introPath")) return "IntroPath";
  if (q.includes("sectorAggregates")) return "SectorAggregates";
  if (q.includes("recordOutreachTouch")) return "RecordOutreachTouch";

  return "Unknown";
}
