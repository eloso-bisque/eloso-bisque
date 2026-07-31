/**
 * Tests for the Postgres-backed intro-path BFS (src/lib/intro-path-read.ts),
 * which replaces `fetchIntroPath()` (src/lib/kissinger.ts) — Kissinger's
 * Rust-side `introPath` GraphQL BFS over CozoDB — with an in-app BFS over
 * "knows" `RelationshipFrom` edges.
 *
 * Behavior under test (pure functions only — no Postgres I/O):
 *   - `bfsShortestPath` must find the shortest path when one exists, treat
 *     "knows" edges as bidirectional/undirected, return the source node
 *     itself as a 1-element path when the target IS a source, respect the
 *     `maxHops` cap (return null rather than a truncated/wrong path), and
 *     return null for a genuinely unreachable target.
 *   - `buildIntroPathSteps` must map an ordered node path into the
 *     IntroPathStep[] shape the frontend renders, attaching the correct
 *     relation label per hop (falling back to "knows" when no edge notes
 *     exist) and leaving `relationToNext: null` on the final (target) step.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { bfsShortestPath, buildIntroPathSteps, type PathNodeInfo } from "../intro-path-read";

const SRC_ROOT = path.resolve(__dirname, "../../");
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relPath), "utf-8");
}

describe("intro-path API route — Kissinger cutover", () => {
  const src = readSrc("app/api/contacts/[id]/intro-path/route.ts");

  it("calls the Postgres BFS, not Kissinger's fetchIntroPath", () => {
    expect(src).toContain("fetchIntroPathFromPostgres");
    expect(src).not.toContain("fetchIntroPath(");
    expect(src).not.toContain("@/lib/kissinger");
  });
});

describe("bfsShortestPath", () => {
  it("finds a direct 1-hop path", () => {
    const edges = [{ a: "team1", b: "target" }];
    expect(bfsShortestPath(edges, ["team1"], "target", 6)).toEqual(["team1", "target"]);
  });

  it("finds the shortest multi-hop path over a longer alternative", () => {
    // team1 -> b -> target (2 hops) is shorter than team1 -> c -> d -> target (3 hops)
    const edges = [
      { a: "team1", b: "b" },
      { a: "b", b: "target" },
      { a: "team1", b: "c" },
      { a: "c", b: "d" },
      { a: "d", b: "target" },
    ];
    expect(bfsShortestPath(edges, ["team1"], "target", 6)).toEqual(["team1", "b", "target"]);
  });

  it("treats edges as undirected/bidirectional", () => {
    // Edge is stored as target -> team1 (reversed) — should still traverse.
    const edges = [{ a: "target", b: "team1" }];
    expect(bfsShortestPath(edges, ["team1"], "target", 6)).toEqual(["team1", "target"]);
  });

  it("returns a 1-element path when the target is itself a source", () => {
    const edges = [{ a: "team1", b: "other" }];
    expect(bfsShortestPath(edges, ["team1", "target"], "target", 6)).toEqual(["target"]);
  });

  it("picks the nearest of multiple source nodes", () => {
    const edges = [
      { a: "team1", b: "x" },
      { a: "x", b: "y" },
      { a: "y", b: "target" },
      { a: "team2", b: "target" },
    ];
    expect(bfsShortestPath(edges, ["team1", "team2"], "target", 6)).toEqual(["team2", "target"]);
  });

  it("returns null when no path exists", () => {
    const edges = [{ a: "team1", b: "b" }];
    expect(bfsShortestPath(edges, ["team1"], "target", 6)).toBeNull();
  });

  it("respects maxHops — does not return a path longer than the cap", () => {
    const edges = [
      { a: "team1", b: "a" },
      { a: "a", b: "b" },
      { a: "b", b: "target" },
    ];
    // Path is 3 hops; cap at 2 must fail to find it.
    expect(bfsShortestPath(edges, ["team1"], "target", 2)).toBeNull();
    // Cap at 3 must find it.
    expect(bfsShortestPath(edges, ["team1"], "target", 3)).toEqual(["team1", "a", "b", "target"]);
  });
});

describe("buildIntroPathSteps", () => {
  const nodes: PathNodeInfo[] = [
    { id: "1", kissingerId: "k1", name: "Ben", title: "COO", organizationName: "Eloso" },
    { id: "2", kissingerId: "k2", name: "Connector", title: "VP Sales", organizationName: "Acme" },
    { id: "3", kissingerId: "k3", name: "Target Person", title: "CTO", organizationName: "Target Co" },
  ];

  it("maps every node with the correct relation label per hop", () => {
    const relationNotes = new Map<string, string | null>([
      ["1|2", "college roommate"],
      ["2|1", "college roommate"],
      ["2|3", null],
      ["3|2", null],
    ]);
    const steps = buildIntroPathSteps(nodes, relationNotes);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ personId: "k1", name: "Ben", relationToNext: "college roommate" });
    // Missing/null notes fall back to "knows"
    expect(steps[1]).toMatchObject({ personId: "k2", name: "Connector", relationToNext: "knows" });
    // Final step (the target) has no next hop
    expect(steps[2]).toMatchObject({ personId: "k3", name: "Target Person", relationToNext: null });
  });

  it("falls back to the Postgres id when kissingerId is null", () => {
    const soloNode: PathNodeInfo[] = [
      { id: "pg-only-id", kissingerId: null, name: "No Kissinger Id", title: null, organizationName: null },
    ];
    const steps = buildIntroPathSteps(soloNode, new Map());
    expect(steps[0].personId).toBe("pg-only-id");
  });
});
