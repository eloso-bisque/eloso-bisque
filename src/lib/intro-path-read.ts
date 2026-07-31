/**
 * Postgres-backed intro-path BFS (warm-intro discovery over "knows" edges).
 *
 * Replaces `fetchIntroPath()` (src/lib/kissinger.ts), which called
 * Kissinger's `introPath` GraphQL query (a Rust-side BFS over the CozoDB
 * graph). This was Drew's own named exception during the 2026-07-22
 * dual-write disconnect ("leave intro-path on Kissinger") — his 2026-07-31
 * instruction explicitly supersedes that and asks for it to move to
 * Postgres along with everything else still on Kissinger in the frontend.
 *
 * Kissinger's "knows" edges were fully migrated into Postgres
 * `RelationshipFrom` rows during the original backfill — verified live
 * against prod Postgres on 2026-07-31: 7,669 person<->person `knows` edges
 * exist (`SELECT "relationType", count(*) FROM "RelationshipFrom" GROUP BY
 * "relationType"` -> knows=7669, works_at=7218). This is static,
 * LinkedIn-connections-derived graph data — nothing in the live app writes
 * new "knows" edges — so there is no dual-write staleness risk the way
 * there is for the Outreach/Signals subsystem still left on Kissinger (see
 * that subsystem's own flagged blocker).
 *
 * "knows" edges are treated as bidirectional for traversal purposes (a
 * LinkedIn connection is mutual — if A "knows" B, that connection can
 * equally introduce B to A), matching the informal semantics already
 * documented in IntroPathTab.tsx ("Intro paths are discovered by traversing
 * 'knows' edges in your network graph").
 *
 * ---------------------------------------------------------------------
 * Parity note: TEAM_PERSON_IDS has never been set in Vercel production
 * ---------------------------------------------------------------------
 * `fetchIntroPath()` (the Kissinger version) short-circuits to
 * `{found:false, hops:0, steps:[]}` before ever calling Kissinger whenever
 * `TEAM_PERSON_IDS` is empty — and `vercel env ls` / `vercel env pull`
 * against the `fully-parsed` production project confirm that env var has
 * never been set. So the live intro-path feature has always returned "no
 * path found" for every contact, regardless of Kissinger. This migration
 * preserves that exact env var name and the same empty-check short-circuit,
 * so behavior is exactly unchanged by this cutover — this is a pre-existing,
 * unrelated product gap (nobody configured which Contact rows represent the
 * team), not something this migration fixes or regresses. Worth flagging to
 * Drew separately if he wants the feature actually populated.
 */

import { prisma } from "@/lib/prisma";
import type { IntroPathResult, IntroPathStep } from "@/lib/kissinger";

export const TEAM_PERSON_IDS: string[] = (process.env.TEAM_PERSON_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** BFS depth cap — generous for warm-intro discovery, bounded to avoid a runaway traversal. */
const DEFAULT_MAX_HOPS = 6;

interface KnowsEdgeRow {
  sourcePersonId: string | null;
  targetPersonId: string | null;
  notes: string | null;
}

/**
 * Pure BFS over an undirected adjacency list built from "knows" edges.
 * Returns the shortest path of Postgres Contact ids from any of
 * `sourceIds` to `targetId` (inclusive of both ends), or null if
 * unreachable within `maxHops`. Unit-tested directly, no I/O.
 */
export function bfsShortestPath(
  edges: { a: string; b: string }[],
  sourceIds: string[],
  targetId: string,
  maxHops: number
): string[] | null {
  if (sourceIds.includes(targetId)) return [targetId];

  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const { a, b } of edges) {
    addEdge(a, b);
    addEdge(b, a);
  }

  const visited = new Set<string>(sourceIds);
  const parent = new Map<string, string>();
  let frontier = [...sourceIds];

  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const nextFrontier: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        parent.set(neighbor, node);
        if (neighbor === targetId) {
          const path: string[] = [neighbor];
          let cur = neighbor;
          while (parent.has(cur)) {
            cur = parent.get(cur)!;
            path.push(cur);
          }
          return path.reverse();
        }
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

export interface PathNodeInfo {
  id: string;
  kissingerId: string | null;
  name: string;
  title: string | null;
  organizationName: string | null;
}

/** Builds IntroPathStep[] from an ordered path of resolved nodes + a bidirectional edge-notes lookup. Pure, unit-tested directly. */
export function buildIntroPathSteps(
  path: PathNodeInfo[],
  relationNotes: Map<string, string | null>
): IntroPathStep[] {
  return path.map((node, i) => {
    const next = path[i + 1];
    const relationToNext = next ? relationNotes.get(`${node.id}|${next.id}`) ?? "knows" : null;
    return {
      personId: node.kissingerId ?? node.id,
      name: node.name,
      title: node.title,
      organization: node.organizationName,
      relationToNext,
    };
  });
}

/**
 * Postgres replacement for `fetchIntroPath()`. Returns `{found:false}`
 * (never throws) if `TEAM_PERSON_IDS` is unset, the target contact isn't
 * found, no path exists within `maxHops`, or any Postgres error occurs —
 * matching the exact fail-closed contract the Kissinger version had.
 */
export async function fetchIntroPathFromPostgres(
  targetKissingerId: string,
  sourceKissingerIds: string[] = TEAM_PERSON_IDS,
  maxHops = DEFAULT_MAX_HOPS
): Promise<IntroPathResult> {
  if (sourceKissingerIds.length === 0) {
    return { found: false, hops: 0, steps: [] };
  }
  try {
    const [target, sources] = await Promise.all([
      prisma.contact.findUnique({ where: { kissingerId: targetKissingerId }, select: { id: true } }),
      prisma.contact.findMany({ where: { kissingerId: { in: sourceKissingerIds } }, select: { id: true } }),
    ]);
    if (!target || sources.length === 0) return { found: false, hops: 0, steps: [] };

    const sourceIds = sources.map((s) => s.id);

    const edgeRows = (await prisma.relationshipFrom.findMany({
      where: { relationType: "knows", sourcePersonId: { not: null }, targetPersonId: { not: null } },
      select: { sourcePersonId: true, targetPersonId: true, notes: true },
    })) as KnowsEdgeRow[];

    const edges = edgeRows
      .filter(
        (e): e is { sourcePersonId: string; targetPersonId: string; notes: string | null } =>
          !!e.sourcePersonId && !!e.targetPersonId
      )
      .map((e) => ({ a: e.sourcePersonId, b: e.targetPersonId }));

    const path = bfsShortestPath(edges, sourceIds, target.id, maxHops);
    if (!path) return { found: false, hops: 0, steps: [] };

    const relationNotes = new Map<string, string | null>();
    for (const e of edgeRows) {
      if (e.sourcePersonId && e.targetPersonId) {
        relationNotes.set(`${e.sourcePersonId}|${e.targetPersonId}`, e.notes);
        relationNotes.set(`${e.targetPersonId}|${e.sourcePersonId}`, e.notes);
      }
    }

    const nodes = await prisma.contact.findMany({
      where: { id: { in: path } },
      select: {
        id: true,
        kissingerId: true,
        name: true,
        title: true,
        organization: { select: { name: true } },
      },
    });
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const orderedNodes: PathNodeInfo[] = path.map((id) => {
      const n = nodeById.get(id);
      return {
        id,
        kissingerId: n?.kissingerId ?? null,
        name: n?.name ?? "Unknown",
        title: n?.title ?? null,
        organizationName: n?.organization?.name ?? null,
      };
    });

    const steps = buildIntroPathSteps(orderedNodes, relationNotes);
    return { found: true, hops: steps.length - 1, steps };
  } catch (err) {
    console.warn(
      `[intro-path-read] fetchIntroPathFromPostgres failed for "${targetKissingerId}":`,
      err instanceof Error ? err.message : err
    );
    return { found: false, hops: 0, steps: [] };
  }
}
