/**
 * GET /api/contacts/[id]/detail
 *
 * Returns full contact details for a single entity (for use in the outreach
 * contact detail panel).
 *
 * Response: ContactDetailPayload
 */

import { NextRequest, NextResponse } from "next/server";

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
    throw new Error(
      `Kissinger GraphQL request failed: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

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

const RECENT_INTERACTIONS_QUERY = `
  query RecentInteractions($entityId: String!, $first: Int) {
    interactionsForEntity(entityId: $entityId, first: $first) {
      edges {
        node {
          id
          kind
          occurredAt
          subject
          notes
        }
      }
    }
  }
`;

export interface ContactDetailPayload {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  notes: string;
  meta: { key: string; value: string }[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  recentInteractions: {
    id: string;
    kind: string;
    occurredAt: string;
    subject: string;
    notes: string;
  }[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);

  try {
    const [entityData, interactionsData] = await Promise.all([
      gql<{
        entity: {
          id: string;
          kind: string;
          name: string;
          tags: string[];
          notes: string;
          meta: { key: string; value: string }[];
          createdAt: string;
          updatedAt: string;
          archived: boolean;
        };
      }>(ENTITY_DETAIL_QUERY, { id }),
      gql<{
        interactionsForEntity: {
          edges: {
            node: {
              id: string;
              kind: string;
              occurredAt: string;
              subject: string;
              notes: string;
            };
          }[];
        };
      }>(RECENT_INTERACTIONS_QUERY, { entityId: id, first: 5 }).catch(() => ({
        interactionsForEntity: { edges: [] },
      })),
    ]);

    const entity = entityData.entity;
    const interactions = interactionsData.interactionsForEntity.edges.map(
      (e) => e.node
    );

    const payload: ContactDetailPayload = {
      ...entity,
      recentInteractions: interactions,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch contact details", details: message },
      { status: 500 }
    );
  }
}
