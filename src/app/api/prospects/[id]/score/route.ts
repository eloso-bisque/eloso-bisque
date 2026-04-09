/**
 * GET /api/prospects/[id]/score
 *
 * Returns a prospect company's ICP score and breakdown.
 *
 * Fetches:
 *   1. Full entity details (meta, tags, notes)
 *   2. Edges from this entity (for warm intro path)
 *   3. People at this org (reverse works_at edges, for buyer accessibility)
 *
 * Response: { icp_score: number, breakdown: {...}, entity_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { scoreProspect } from "@/lib/score-prospect";
import type { ScoringProspect, ProspectScoringEdge } from "@/lib/score-prospect";

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
  query EntityForProspectScore($id: String!) {
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
  query EdgesForProspectScore($entityId: String!, $first: Int) {
    edgesFrom(entityId: $entityId, first: $first) {
      edges {
        node {
          source
          target
          relation
          strength
        }
      }
    }
  }
`;

/** Reverse edges — people who work_at this org */
const PEOPLE_AT_ORG_QUERY = `
  query PeopleAtOrg($entityId: String!, $first: Int) {
    edgesTo(entityId: $entityId, relationType: "works_at", first: $first) {
      edges {
        node {
          source
          relation
          strength
        }
      }
    }
  }
`;

const PERSON_DETAIL_QUERY = `
  query PersonDetail($id: String!) {
    entity(id: $id) {
      id
      kind
      tags
      meta { key value }
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
    // 1. Fetch entity + edges in parallel
    const [entityData, edgesData, peopleAtOrgData] = await Promise.all([
      gql<EntityData>(ENTITY_QUERY, { id }),
      gql<{
        edgesFrom: { edges: { node: { source: string; target: string; relation: string; strength: number } }[] };
      }>(EDGES_FROM_QUERY, { entityId: id, first: 50 }).catch(() => ({
        edgesFrom: { edges: [] },
      })),
      gql<{
        edgesTo: { edges: { node: { source: string; relation: string; strength: number } }[] };
      }>(PEOPLE_AT_ORG_QUERY, { entityId: id, first: 100 }).catch(() => ({
        edgesTo: { edges: [] },
      })),
    ]);

    const entity = entityData.entity;
    const rawEdges = edgesData.edgesFrom.edges.map((e) => e.node);
    const personIds = peopleAtOrgData.edgesTo.edges.map((e) => e.node.source);

    // 2. Fetch person details (tags + meta) for buyer accessibility scoring
    const personDetails = await Promise.allSettled(
      personIds.map(async (personId) => {
        const data = await gql<{ entity: { id: string; kind: string; tags: string[]; meta: { key: string; value: string }[] } }>(
          PERSON_DETAIL_QUERY,
          { id: personId }
        );
        return data.entity;
      })
    );

    const people = personDetails
      .filter((r): r is PromiseFulfilledResult<{ id: string; kind: string; tags: string[]; meta: { key: string; value: string }[] }> =>
        r.status === "fulfilled"
      )
      .map((r) => r.value);

    // 3. Build scoring edges
    const scoringEdges: ProspectScoringEdge[] = rawEdges.map((edge) => ({
      relation: edge.relation,
      strength: edge.strength,
    }));

    // 4. Build the scoring prospect
    const scoringProspect: ScoringProspect = {
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      tags: entity.tags,
      notes: entity.notes,
      meta: entity.meta,
      updatedAt: entity.updatedAt,
      edges: scoringEdges,
      people,
    };

    // 5. Score it
    const result = scoreProspect(scoringProspect);

    return NextResponse.json({
      entity_id: id,
      entity_name: entity.name,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to score prospect", details: message },
      { status: 500 }
    );
  }
}
