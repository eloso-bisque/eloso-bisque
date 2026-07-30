import { describe, it, expect } from "vitest";
import { parseNestedMeta, resolveTitleFromMeta, resolveCompanyFromMeta } from "../kissinger-meta";

describe("parseNestedMeta", () => {
  it("parses the nested JSON blob stored at meta key \"meta\"", () => {
    const meta = { meta: JSON.stringify({ title: "VP Supply Chain", org: "Acme Corp" }) };
    expect(parseNestedMeta(meta)).toEqual({ title: "VP Supply Chain", org: "Acme Corp" });
  });

  it("returns {} when the \"meta\" key is absent", () => {
    expect(parseNestedMeta({})).toEqual({});
  });

  it("returns {} when the \"meta\" key is not valid JSON, instead of throwing", () => {
    expect(parseNestedMeta({ meta: "not json" })).toEqual({});
  });
});

describe("resolveTitleFromMeta", () => {
  it("prefers the direct meta.title key", () => {
    const meta = { title: "Director Supply Chain" };
    expect(resolveTitleFromMeta(meta, {})).toBe("Director Supply Chain");
  });

  it("falls back to the nested blob's title when meta.title is absent", () => {
    const meta = {};
    const nested = { title: "VP Ops" };
    expect(resolveTitleFromMeta(meta, nested)).toBe("VP Ops");
  });

  it("falls back to meta.headline when no title signal exists at the top level or nested", () => {
    const meta = { headline: "Head of Logistics" };
    expect(resolveTitleFromMeta(meta, {})).toBe("Head of Logistics");
  });

  it("falls back to the nested blob's headline as the last resort", () => {
    const meta = {};
    const nested = { headline: "Procurement Lead" };
    expect(resolveTitleFromMeta(meta, nested)).toBe("Procurement Lead");
  });

  it("returns \"\" when no title signal exists anywhere in the chain", () => {
    expect(resolveTitleFromMeta({}, {})).toBe("");
  });

  it("respects fallback order: direct title > nested title > direct headline > nested headline", () => {
    const meta = { title: "Direct Title", headline: "Direct Headline" };
    const nested = { title: "Nested Title", headline: "Nested Headline" };
    expect(resolveTitleFromMeta(meta, nested)).toBe("Direct Title");
    expect(resolveTitleFromMeta({ headline: "Direct Headline" }, { title: "Nested Title", headline: "Nested Headline" })).toBe(
      "Nested Title"
    );
  });
});

describe("resolveCompanyFromMeta", () => {
  it("prefers the direct meta.company key", () => {
    expect(resolveCompanyFromMeta({ company: "Centra Health" }, {})).toBe("Centra Health");
  });

  it("falls back to meta.org when meta.company is absent", () => {
    expect(resolveCompanyFromMeta({ org: "Anduril" }, {})).toBe("Anduril");
  });

  it("falls back to the nested blob's org when no direct signal exists", () => {
    expect(resolveCompanyFromMeta({}, { org: "Nested Org Co" })).toBe("Nested Org Co");
  });

  it("falls back to the nested blob's company as the last resort", () => {
    expect(resolveCompanyFromMeta({}, { company: "Nested Company Co" })).toBe("Nested Company Co");
  });

  it("returns \"\" when no company signal exists anywhere in the chain", () => {
    expect(resolveCompanyFromMeta({}, {})).toBe("");
  });
});
