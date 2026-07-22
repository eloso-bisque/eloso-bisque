/**
 * Tests for the Postgres-backed Contact detail read path (Prisma Phase 3.6,
 * GH #46), which replaces `fetchContactDetail()` (src/lib/kissinger.ts) —
 * a Kissinger entity + edgesFrom + edgesTo + per-edge name resolution — with
 * typed Postgres queries.
 *
 * Behavior under test (from the GH #46 issue text and real-prod-data
 * investigation recorded in contact-detail-read.ts's module doc), not from
 * the implementation:
 *
 *   - Revenue formatting: Organization.revenueUsd (raw float) must render
 *     the same style of string the Kissinger `revenue` meta field always
 *     already was ("$1.2B"/"$450M"/"$800K").
 *   - Contact/Organization -> synthetic `meta` array: every key the contact
 *     detail pages read directly (title, email, connected_on, company/org,
 *     hq, revenue, employees, ...) must be reproduced from typed columns,
 *     and absent values must be omitted (not render as "null"/"undefined"
 *     strings) so the pages' existing `{field && (...)}` conditionals keep
 *     working unchanged.
 *   - RelationshipFrom row -> ResolvedEdge: both endpoints must have a
 *     kissingerId or the edge is dropped (never a dead link); the row is
 *     dropped if the "source" side doesn't match the entity being queried
 *     (defensive — RelationshipFrom is directional).
 *   - Employer edge completeness: a Contact with `organizationId` set but
 *     NO matching `works_at` RelationshipFrom row (the 137/9237 "meta_company_name
 *     fallback" case documented in scripts/backfill/relationships.ts) must
 *     still show its employer — `withSynthesizedEmployerEdge` closes this
 *     gap. Falsifiability: this is the one invariant most likely to silently
 *     regress if someone "simplifies" the edge-building code later, so it's
 *     covered by both the synthesis test and the no-duplicate test below.
 *   - No duplicate employer edge: when a real `works_at` RelationshipFrom
 *     row to the employer already exists, the synthesized edge must NOT be
 *     appended a second time.
 */

import { describe, it, expect } from "vitest";
import {
  formatRevenueUsd,
  buildContactMeta,
  buildOrgMeta,
  relationshipRowToResolvedEdge,
  synthesizeEmployerEdge,
  withSynthesizedEmployerEdge,
  employeeRowToPersonAtOrg,
  type RelationshipRow,
} from "../contact-detail-read";

describe("formatRevenueUsd", () => {
  it("formats billions", () => {
    expect(formatRevenueUsd(1_200_000_000)).toBe("$1.2B");
  });
  it("formats millions", () => {
    expect(formatRevenueUsd(450_000_000)).toBe("$450M");
  });
  it("formats thousands", () => {
    expect(formatRevenueUsd(800_000)).toBe("$800K");
  });
  it("returns empty string for null/undefined/zero/negative", () => {
    expect(formatRevenueUsd(null)).toBe("");
    expect(formatRevenueUsd(undefined)).toBe("");
    expect(formatRevenueUsd(0)).toBe("");
    expect(formatRevenueUsd(-500)).toBe("");
  });
});

describe("buildContactMeta", () => {
  it("maps typed columns to the meta keys the contact detail pages read", () => {
    const meta = buildContactMeta(
      {
        title: "VP Supply Chain",
        email: "a@b.com",
        linkedinUrl: "linkedin.com/in/a",
        linkedinConnectedOn: "2025-01-01",
        incentive: null,
        warmIntroPath: null,
        priority: null,
      },
      "Acme Corp"
    );
    expect(meta).toContainEqual({ key: "title", value: "VP Supply Chain" });
    expect(meta).toContainEqual({ key: "email", value: "a@b.com" });
    expect(meta).toContainEqual({ key: "connected_on", value: "2025-01-01" });
    expect(meta).toContainEqual({ key: "company", value: "Acme Corp" });
    expect(meta).toContainEqual({ key: "org", value: "Acme Corp" });
    expect(meta).toContainEqual({ key: "linkedin_url", value: "linkedin.com/in/a" });
  });

  it("omits absent fields rather than emitting empty/null values", () => {
    const meta = buildContactMeta(
      { title: null, email: null, linkedinUrl: null, linkedinConnectedOn: null, incentive: null, warmIntroPath: null, priority: null },
      null
    );
    expect(meta).toEqual([]);
  });
});

describe("buildOrgMeta", () => {
  it("maps typed columns to the meta keys the org detail pages read directly (not overridden by investors-read.ts)", () => {
    const meta = buildOrgMeta({
      hq: "Austin, TX",
      employees: 250,
      revenueUsd: 12_000_000,
      industry: "Aerospace",
      website: null,
      thesis: null,
      checkSize: null,
      investmentStage: null,
      sectorFit: null,
    });
    expect(meta).toContainEqual({ key: "hq", value: "Austin, TX" });
    expect(meta).toContainEqual({ key: "location", value: "Austin, TX" });
    expect(meta).toContainEqual({ key: "revenue", value: "$12M" });
    expect(meta).toContainEqual({ key: "employees", value: "250" });
    expect(meta).toContainEqual({ key: "industry", value: "Aerospace" });
  });

  it("never emits a `source` key — no Postgres column exists for it (see module doc)", () => {
    const meta = buildOrgMeta({
      hq: "X", employees: 1, revenueUsd: 1, industry: "Y",
      website: "w", thesis: "t", checkSize: "c", investmentStage: "s", sectorFit: "f",
    });
    expect(meta.find((m) => m.key === "source")).toBeUndefined();
  });
});

describe("relationshipRowToResolvedEdge", () => {
  const baseRow: RelationshipRow = {
    relationType: "works_at",
    strength: 0.8,
    notes: "VP Eng at Acme",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    sourcePerson: { kissingerId: "kis-person-1", name: "Jane Doe" },
    sourceOrg: null,
    targetPerson: null,
    targetOrg: { kissingerId: "kis-org-1", name: "Acme Corp" },
  };

  it("maps a person -> org works_at row to a ResolvedEdge", () => {
    const edge = relationshipRowToResolvedEdge(baseRow, "kis-person-1");
    expect(edge).toEqual({
      source: "kis-person-1",
      target: "kis-org-1",
      relation: "works_at",
      valueFrame: "",
      strength: 0.8,
      notes: "VP Eng at Acme",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      targetName: "Acme Corp",
      targetKind: "org",
    });
  });

  it("returns null when the source endpoint has no kissingerId", () => {
    const row: RelationshipRow = { ...baseRow, sourcePerson: { kissingerId: null, name: "Jane Doe" } };
    expect(relationshipRowToResolvedEdge(row, "kis-person-1")).toBeNull();
  });

  it("returns null when the target endpoint has no kissingerId", () => {
    const row: RelationshipRow = { ...baseRow, targetOrg: { kissingerId: null, name: "Acme Corp" } };
    expect(relationshipRowToResolvedEdge(row, "kis-person-1")).toBeNull();
  });

  it("returns null when the row's source doesn't match the entity being queried (defensive, directional)", () => {
    expect(relationshipRowToResolvedEdge(baseRow, "kis-person-DIFFERENT")).toBeNull();
  });
});

describe("synthesizeEmployerEdge / withSynthesizedEmployerEdge — the 137-contact completeness gap", () => {
  const employer = {
    contactKissingerId: "kis-person-1",
    organizationKissingerId: "kis-org-1",
    organizationName: "Acme Corp",
    roleAtOrg: "VP Engineering",
    orgStrength: 0.6,
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  };

  it("synthesizes a works_at edge from Contact.organizationId fields", () => {
    expect(synthesizeEmployerEdge(employer)).toEqual({
      source: "kis-person-1",
      target: "kis-org-1",
      relation: "works_at",
      valueFrame: "",
      strength: 0.6,
      notes: "VP Engineering",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      targetName: "Acme Corp",
      targetKind: "org",
    });
  });

  it("appends the synthesized edge when no matching works_at edge already exists (the fallback-matched case)", () => {
    const result = withSynthesizedEmployerEdge([], employer);
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe("kis-org-1");
  });

  it("does NOT duplicate the employer when a real works_at RelationshipFrom edge to the same org already exists", () => {
    const existingEdge = synthesizeEmployerEdge(employer); // stand-in for a "real" edge to the same org
    const result = withSynthesizedEmployerEdge([existingEdge], employer);
    expect(result).toHaveLength(1);
  });

  it("passes through unchanged when the contact has no employer (organizationId null)", () => {
    const edges = [synthesizeEmployerEdge(employer)];
    expect(withSynthesizedEmployerEdge(edges, null)).toBe(edges);
  });
});

describe("employeeRowToPersonAtOrg", () => {
  it("maps a Contact row (org's reverse employee lookup) to PersonAtOrg", () => {
    expect(
      employeeRowToPersonAtOrg({ kissingerId: "kis-p1", name: "Jane Doe", roleAtOrg: "CTO", orgStrength: 0.9 })
    ).toEqual({ id: "kis-p1", name: "Jane Doe", role: "CTO", strength: 0.9, edgeNotes: "CTO" });
  });

  it("returns null (dropped, never a dead link) when the row has no kissingerId", () => {
    expect(employeeRowToPersonAtOrg({ kissingerId: null, name: "Jane Doe", roleAtOrg: null, orgStrength: null })).toBeNull();
  });

  it("defaults role/strength when null", () => {
    expect(
      employeeRowToPersonAtOrg({ kissingerId: "kis-p1", name: "Jane Doe", roleAtOrg: null, orgStrength: null })
    ).toEqual({ id: "kis-p1", name: "Jane Doe", role: "", strength: 0, edgeNotes: "" });
  });
});
