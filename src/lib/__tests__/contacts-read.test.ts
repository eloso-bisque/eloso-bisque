import { describe, it, expect } from "vitest";
import {
  classifyOrganization,
  whereForOrgSegment,
  orgToEntitySummary,
  contactToEntitySummary,
} from "../contacts-read";

describe("classifyOrganization (typed-field segmentation, GH #44)", () => {
  it("classifies an org with isProspect=true, isVcFirm=false as prospects", () => {
    expect(classifyOrganization({ isVcFirm: false, isProspect: true })).toBe("prospects");
  });

  it("classifies an org with isVcFirm=true, isProspect=false as vc", () => {
    expect(classifyOrganization({ isVcFirm: true, isProspect: false })).toBe("vc");
  });

  it("classifies an org with neither flag set as other-orgs", () => {
    expect(classifyOrganization({ isVcFirm: false, isProspect: false })).toBe("other-orgs");
  });

  // Boundary case called out explicitly in GH #44: real prod data has 12 orgs
  // (of 5,846) where BOTH isProspect and isVcFirm are true, even though the
  // schema comment describes them as mutually exclusive. Legacy classifyOrg()
  // checked VC_TAGS before PROSPECT_TAGS, so VC status must win here too —
  // regressing to "prospects" (or splitting the org into both buckets) would
  // silently duplicate/misclassify real orgs and break the org-count parity
  // this migration depends on (vc=189 includes all 12 of these).
  it("classifies an org with BOTH isProspect and isVcFirm true as vc (VC takes precedence)", () => {
    expect(classifyOrganization({ isVcFirm: true, isProspect: true })).toBe("vc");
  });
});

describe("whereForOrgSegment", () => {
  it("vc segment matches isVcFirm regardless of isProspect", () => {
    expect(whereForOrgSegment("vc")).toEqual({ isVcFirm: true, isArchived: false });
  });

  it("prospects segment excludes VC-flagged orgs to avoid double-counting the boundary case", () => {
    expect(whereForOrgSegment("prospects")).toEqual({
      isProspect: true,
      isVcFirm: false,
      isArchived: false,
    });
  });

  it("other-orgs segment excludes both prospect and VC flagged orgs", () => {
    expect(whereForOrgSegment("other-orgs")).toEqual({
      isProspect: false,
      isVcFirm: false,
      isArchived: false,
    });
  });
});

describe("orgToEntitySummary", () => {
  const baseOrg = {
    kissingerId: "kis-org-1",
    name: "Acme Aerospace",
    hq: "Austin, TX",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    isArchived: false,
    tags: [{ tag: "prospect" }, { tag: "fit-high" }],
  };

  it("maps kissingerId to id (not the Postgres cuid), preserving downstream /contacts/[id] links", () => {
    const result = orgToEntitySummary(baseOrg);
    expect(result?.id).toBe("kis-org-1");
  });

  it("maps hq to location and flattens the tags join into a plain string array", () => {
    const result = orgToEntitySummary(baseOrg);
    expect(result?.location).toBe("Austin, TX");
    expect(result?.tags).toEqual(["prospect", "fit-high"]);
    expect(result?.kind).toBe("org");
  });

  it("returns null when kissingerId is missing, rather than surfacing a dead link", () => {
    expect(orgToEntitySummary({ ...baseOrg, kissingerId: null })).toBeNull();
  });
});

describe("contactToEntitySummary", () => {
  const baseContact = {
    kissingerId: "kis-person-1",
    name: "Erle Shepard",
    location: "Denver, CO",
    title: "VP Engineering",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    isArchived: false,
    tags: [{ tag: "prospect-contact" }],
  };

  it("maps kissingerId to id and preserves title/location typed fields", () => {
    const result = contactToEntitySummary(baseContact);
    expect(result?.id).toBe("kis-person-1");
    expect(result?.title).toBe("VP Engineering");
    expect(result?.location).toBe("Denver, CO");
    expect(result?.kind).toBe("person");
  });

  it("returns null when kissingerId is missing", () => {
    expect(contactToEntitySummary({ ...baseContact, kissingerId: null })).toBeNull();
  });
});
