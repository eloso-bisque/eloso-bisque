import { describe, it, expect } from "vitest";
import {
  buildRelationshipPlan,
  resolveContactOrganization,
  syntheticOrgKissingerId,
  findSyntheticOrgCandidates,
  buildQueueEntryPlan,
  buildContactEventPlan,
} from "../relationships";
import type { KissingerEdge, KissingerInteraction } from "../kissinger-client";

function edge(overrides: Partial<KissingerEdge>): KissingerEdge {
  return {
    source: "person-1",
    target: "org-1",
    relation: "works_at",
    strength: 0.8,
    notes: "",
    ...overrides,
  };
}

describe("buildRelationshipPlan", () => {
  it("maps a works_at edge between a known person and org", () => {
    const kindById = new Map([
      ["person-1", "person" as const],
      ["org-1", "org" as const],
    ]);
    const { plan, warning } = buildRelationshipPlan(edge({}), kindById);
    expect(warning).toBeUndefined();
    expect(plan).toEqual({
      relationType: "works_at",
      sourceKissingerId: "person-1",
      sourceKind: "person",
      targetKissingerId: "org-1",
      targetKind: "org",
      strength: 0.8,
      notes: null,
    });
  });

  it("skips and warns on a relation type with no RelationType enum value (e.g. real-data buys_from)", () => {
    const kindById = new Map([
      ["person-1", "person" as const],
      ["org-1", "org" as const],
    ]);
    const { plan, warning, reason } = buildRelationshipPlan(edge({ relation: "buys_from" }), kindById);
    expect(plan).toBeNull();
    expect(warning).toContain("buys_from");
    expect(reason).toBe("unmapped_type");
  });

  it("skips and warns when an endpoint's kind couldn't be resolved, distinctly from an unmapped type", () => {
    const kindById = new Map([["person-1", "person" as const]]); // org-1 missing
    const { plan, warning, reason } = buildRelationshipPlan(edge({}), kindById);
    expect(plan).toBeNull();
    expect(warning).toContain("org-1");
    // A mapped relation type (works_at) with a missing endpoint must NOT be
    // reported as an unmapped-type skip — the two failure modes have
    // different remediations and must stay distinguishable in the summary.
    expect(reason).toBe("missing_endpoint");
  });
});

describe("resolveContactOrganization", () => {
  it("prefers a works_at edge over meta company name", () => {
    const res = resolveContactOrganization(
      [edge({ target: "org-1", notes: "Co-Founder & COO at Anduril Industries", strength: 0.9 })],
      "Some Other Co",
      new Map([["some other co", "org-2"]])
    );
    expect(res.organizationKissingerId).toBe("org-1");
    expect(res.roleAtOrg).toBe("Co-Founder & COO");
    expect(res.orgStrength).toBe(0.9);
    expect(res.source).toBe("works_at_edge");
    expect(res.warning).toBeUndefined();
  });

  it("picks the highest-strength edge when a contact has multiple works_at edges", () => {
    const res = resolveContactOrganization(
      [
        edge({ target: "org-1", strength: 0.4 }),
        edge({ target: "org-2", strength: 0.95 }),
      ],
      null,
      new Map()
    );
    expect(res.organizationKissingerId).toBe("org-2");
    expect(res.orgStrength).toBe(0.95);
  });

  it("falls back to a case-insensitive meta company name match when no edge exists", () => {
    const res = resolveContactOrganization([], "Acme Capital", new Map([["acme capital", "org-9"]]));
    expect(res.organizationKissingerId).toBe("org-9");
    expect(res.source).toBe("meta_company_name");
    expect(res.roleAtOrg).toBeNull();
  });

  it("warns when a meta company name doesn't match any known Organization", () => {
    const res = resolveContactOrganization([], "Unknown Co", new Map());
    expect(res.organizationKissingerId).toBeNull();
    expect(res.warning).toContain("Unknown Co");
  });

  it("returns nulls with no warning when there is no edge and no company meta", () => {
    const res = resolveContactOrganization([], null, new Map());
    expect(res.organizationKissingerId).toBeNull();
    expect(res.warning).toBeUndefined();
  });
});

describe("syntheticOrgKissingerId", () => {
  it("is deterministic and case/whitespace-insensitive", () => {
    expect(syntheticOrgKissingerId("Acme Logistics")).toBe(syntheticOrgKissingerId("  acme logistics  "));
  });

  it("is prefixed to be unambiguously distinct from a real Kissinger entity id", () => {
    expect(syntheticOrgKissingerId("Acme Logistics")).toMatch(/^synthetic-org:/);
  });
});

describe("findSyntheticOrgCandidates", () => {
  it("flags a contact's company/org meta when it has no works_at edge and no matching Organization name", () => {
    const candidates = findSyntheticOrgCandidates(
      [{ kissingerId: "person-1", metaCompanyName: "Widget Manufacturing Co" }],
      new Map(),
      new Map()
    );
    expect(candidates).toEqual([
      { kissingerId: syntheticOrgKissingerId("Widget Manufacturing Co"), name: "Widget Manufacturing Co" },
    ]);
  });

  it("skips a contact that already has a works_at edge (edge wins, no synthetic org needed)", () => {
    const candidates = findSyntheticOrgCandidates(
      [{ kissingerId: "person-1", metaCompanyName: "Widget Manufacturing Co" }],
      new Map([["person-1", [edge({ target: "org-1" })]]]),
      new Map()
    );
    expect(candidates).toEqual([]);
  });

  it("skips a contact whose company name already matches a known Organization", () => {
    const candidates = findSyntheticOrgCandidates(
      [{ kissingerId: "person-1", metaCompanyName: "Acme Capital" }],
      new Map(),
      new Map([["acme capital", "org-9"]])
    );
    expect(candidates).toEqual([]);
  });

  it("skips a contact with no company/org meta at all", () => {
    const candidates = findSyntheticOrgCandidates([{ kissingerId: "person-1", metaCompanyName: null }], new Map(), new Map());
    expect(candidates).toEqual([]);
  });

  it("deduplicates by lowercased/trimmed name so contacts sharing an employer converge on one candidate", () => {
    const candidates = findSyntheticOrgCandidates(
      [
        { kissingerId: "person-1", metaCompanyName: "Widget Manufacturing Co" },
        { kissingerId: "person-2", metaCompanyName: "  widget manufacturing co  " },
      ],
      new Map(),
      new Map()
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe("Widget Manufacturing Co");
  });
});

describe("buildQueueEntryPlan", () => {
  it("returns null when there is no queue assignment", () => {
    expect(buildQueueEntryPlan(null, false)).toBeNull();
  });

  it("creates an active entry when queued and not yet sent", () => {
    expect(buildQueueEntryPlan("usr_ben", false)).toEqual({
      userId: "usr_ben",
      isActive: true,
      deactivatedReason: null,
    });
  });

  it("creates an already-deactivated entry (reason=sent) when the outreach-sent tag is present", () => {
    expect(buildQueueEntryPlan("usr_ben", true)).toEqual({
      userId: "usr_ben",
      isActive: false,
      deactivatedReason: "sent",
    });
  });
});

describe("buildContactEventPlan", () => {
  function interaction(overrides: Partial<KissingerInteraction>): KissingerInteraction {
    return {
      id: "int-1",
      kind: "outreach_touch_1",
      occurredAt: "2026-05-01T00:00:00Z",
      subject: "",
      notes: "",
      ...overrides,
    };
  }

  it("maps a known interaction kind and nulls out empty subject/notes", () => {
    const plan = buildContactEventPlan(interaction({ kind: "meeting", subject: "", notes: "" }));
    expect(plan).toEqual({
      kind: "Meeting",
      occurredAt: "2026-05-01T00:00:00Z",
      subject: null,
      notes: null,
    });
  });

  it("defaults an unrecognized interaction kind (e.g. outreach_touch_1) to Custom", () => {
    const plan = buildContactEventPlan(interaction({ kind: "outreach_touch_1", subject: "Outreach touch 1" }));
    expect(plan.kind).toBe("Custom");
    expect(plan.subject).toBe("Outreach touch 1");
  });
});
