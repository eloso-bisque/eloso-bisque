/**
 * GET /api/contacts/[id]/score
 *
 * Returns a contact's Eloso fit score and breakdown.
 *
 * Fetches:
 *   1. Full entity details (meta, tags, notes)
 *   2. Edges from this entity (for org type + proximity)
 *   3. Interactions (for recency)
 *   4. Org entity tags if person works at an org (for org_type enrichment)
 *
 * Response: { score: number, breakdown: {...}, contact_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { scoreContact } from "@/lib/score-contact";
import type { ScoringContact, ScoringEdge } from "@/lib/score-contact";

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
    cache: "no-store",
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

const ENTITY_QUERY = `
  query EntityForScore($id: String!) {
    entity(id: $id) {
      id
      kind
      name
      tags
      notes
      meta { key value }
      updatedAt
    }
  }
`;

const EDGES_FROM_QUERY = `
  query EdgesForScore($entityId: String!, $first: Int) {
    edgesFrom(entityId: $entityId, first: $first) {
      edges {
        node {
          source
          target
          relation
          strength
          notes
        }
      }
    }
  }
`;

const INTERACTIONS_QUERY = `
  query InteractionsForScore($entityId: String!, $first: Int) {
    interactionsForEntity(entityId: $entityId, first: $first) {
      edges {
        node {
          id
          occurredAt
        }
      }
    }
  }
`;

const ENTITY_TAGS_QUERY = `
  query EntityTags($id: String!) {
    entity(id: $id) {
      id
      tags
    }
  }
`;

interface EntityData {
  entity: {
    id: string;
    kind: string;
    name: string;
    tags: string[];
    notes: string;
    meta: { key: string; value: string }[];
    updatedAt: string;
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  try {
    // 1. Fetch entity + edges + interactions in parallel
    const [entityData, edgesData, interactionsData] = await Promise.all([
      gql<EntityData>(ENTITY_QUERY, { id }),
      gql<{
        edgesFrom: { edges: { node: { source: string; target: string; relation: string; strength: number; notes: string } }[] };
      }>(EDGES_FROM_QUERY, { entityId: id, first: 50 }).catch(() => ({
        edgesFrom: { edges: [] },
      })),
      gql<{
        interactionsForEntity: { edges: { node: { id: string; occurredAt: string } }[] };
      }>(INTERACTIONS_QUERY, { entityId: id, first: 1 }).catch(() => ({
        interactionsForEntity: { edges: [] },
      })),
    ]);

    const entity = entityData.entity;
    const rawEdges = edgesData.edgesFrom.edges.map((e) => e.node);
    const interactions = interactionsData.interactionsForEntity.edges.map((e) => e.node);

    // 2. Find the most recent interaction date
    const mostRecentInteraction =
      interactions.length > 0
        ? interactions.reduce((latest, i) =>
            Date.parse(i.occurredAt) > Date.parse(latest.occurredAt) ? i : latest
          )
        : null;

    // 3. For person entities: enrich edges with target org tags (for org_type scoring)
    const worksAtEdges = rawEdges.filter((e) => e.relation === "works_at");
    const orgTagsMap = new Map<string, string[]>();

    if (worksAtEdges.length > 0) {
      const orgTagResults = await Promise.allSettled(
        worksAtEdges.map(async (edge) => {
          const data = await gql<{ entity: { id: string; tags: string[] } }>(
            ENTITY_TAGS_QUERY,
            { id: edge.target }
          );
          return { id: edge.target, tags: data.entity.tags };
        })
      );
      for (const r of orgTagResults) {
        if (r.status === "fulfilled") {
          orgTagsMap.set(r.value.id, r.value.tags);
        }
      }
    }

    // 4. Collect org_tags (union of all orgs this person works at)
    const orgTags: string[] = [];
    for (const [, tags] of orgTagsMap) {
      orgTags.push(...tags);
    }

    // 5. Build scoring edges with enriched target_tags
    const scoringEdges: ScoringEdge[] = rawEdges.map((edge) => ({
      relation: edge.relation,
      strength: edge.strength,
      target_tags: orgTagsMap.get(edge.target) ?? [],
    }));

    // 6. Build the scoring contact
    const scoringContact: ScoringContact = {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      tags: entity.tags,
      notes: entity.notes,
      meta: entity.meta,
      updatedAt: entity.updatedAt,
      last_interaction_at: mostRecentInteraction?.occurredAt,
      edges: scoringEdges,
      org_tags: orgTags,
    };

    // 7. Score it
    const result = scoreContact(scoringContact);

    return NextResponse.json({
      contact_id: id,
      contact_name: entity.name,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to score contact", details: message },
      { status: 500 }
    );
  }
}
