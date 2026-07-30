/**
 * Tests for the Postgres-backed full-text search that replaces
 * searchKissinger() for the Contacts page search box (issue #59).
 *
 * Behavior under test (from the migration + call-site contract, not the
 * implementation):
 *   - Results are ranked (ts_rank via the generated tsvector columns), and a
 *     name match must outrank a notes-only match for the same term.
 *   - Contact and Organization hits are merged into a single ranked list,
 *     capped at the requested limit.
 *   - Multi-word queries are passed through to Postgres verbatim (no manual
 *     tokenizing/AND-ing on our side — websearch_to_tsquery handles it).
 *   - Rows without a kissingerId are dropped (same rule as contacts-read.ts —
 *     the UI is still keyed by Kissinger id in this phase).
 *   - Classification (isVcFirm/isProspect/isInvestorContact) is folded back
 *     into a synthetic tags array so the existing classifyOrg()/
 *     INVESTOR_PERSON_TAGS tag-matching in contacts/page.tsx keeps working
 *     unchanged against search results.
 *   - A Postgres failure never throws — returns [] (matching the exact
 *     never-throw contract searchKissinger() already had at this call site).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRawMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
  },
}));

import {
  organizationRowToEntitySummary,
  contactRowToEntitySummary,
  mergeRankedHits,
  searchContactsPostgres,
  type OrgSearchRow,
  type ContactSearchRow,
} from "../contacts-search";

// ---------------------------------------------------------------------------
// Pure row -> EntitySummary mappers (no I/O)
// ---------------------------------------------------------------------------

describe("organizationRowToEntitySummary", () => {
  const baseRow: OrgSearchRow = {
    id: "cuid-org-1",
    kissingerId: "kis-org-1",
    name: "Acme Aerospace Manufacturing",
    isVcFirm: false,
    isProspect: false,
    isArchived: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    rank: 0.5,
    tags: ["aerospace-defense"],
  };

  it("maps kissingerId to id, kind=org, and preserves joined tags", () => {
    const result = organizationRowToEntitySummary(baseRow);
    expect(result?.id).toBe("kis-org-1");
    expect(result?.kind).toBe("org");
    expect(result?.tags).toContain("aerospace-defense");
  });

  it("synthesizes a 'vc' tag when isVcFirm is true, so classifyOrg() still routes it to the VC tab", () => {
    const result = organizationRowToEntitySummary({ ...baseRow, isVcFirm: true });
    expect(result?.tags).toContain("vc");
  });

  it("synthesizes a 'prospect' tag when isProspect is true, so classifyOrg() still routes it to Prospects", () => {
    const result = organizationRowToEntitySummary({ ...baseRow, isProspect: true });
    expect(result?.tags).toContain("prospect");
  });

  it("returns null when kissingerId is missing, rather than surfacing a dead link", () => {
    expect(organizationRowToEntitySummary({ ...baseRow, kissingerId: null })).toBeNull();
  });
});

describe("contactRowToEntitySummary", () => {
  const baseRow: ContactSearchRow = {
    id: "cuid-contact-1",
    kissingerId: "kis-person-1",
    name: "Jane Aerospace",
    title: "VP of Supply Chain",
    location: "Austin, TX",
    isInvestorContact: false,
    isArchived: false,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    rank: 0.6,
    tags: ["prospect-contact"],
  };

  it("maps kissingerId to id, kind=person, and preserves title/location", () => {
    const result = contactRowToEntitySummary(baseRow);
    expect(result?.id).toBe("kis-person-1");
    expect(result?.kind).toBe("person");
    expect(result?.title).toBe("VP of Supply Chain");
    expect(result?.location).toBe("Austin, TX");
  });

  it("synthesizes an 'investor' tag when isInvestorContact is true, so INVESTOR_PERSON_TAGS filtering still excludes it from People", () => {
    const result = contactRowToEntitySummary({ ...baseRow, isInvestorContact: true });
    expect(result?.tags).toContain("investor");
  });

  it("returns null when kissingerId is missing", () => {
    expect(contactRowToEntitySummary({ ...baseRow, kissingerId: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeRankedHits — pure ranking/merge logic
// ---------------------------------------------------------------------------

describe("mergeRankedHits", () => {
  it("sorts merged Contact + Organization hits by rank descending", () => {
    const orgHit = { entity: { id: "org", kind: "org", name: "Org", tags: [], updatedAt: "", archived: false }, rank: 0.2 };
    const contactHit = { entity: { id: "person", kind: "person", name: "Person", tags: [], updatedAt: "", archived: false }, rank: 0.9 };
    const result = mergeRankedHits([orgHit], [contactHit], 10);
    expect(result.map((e) => e.id)).toEqual(["person", "org"]);
  });

  it("caps the merged result at the requested limit", () => {
    const hits = Array.from({ length: 5 }, (_, i) => ({
      entity: { id: `e${i}`, kind: "org", name: `E${i}`, tags: [], updatedAt: "", archived: false },
      rank: i,
    }));
    const result = mergeRankedHits(hits, [], 2);
    expect(result).toHaveLength(2);
    // highest rank (4, 3) survive the cap
    expect(result.map((e) => e.id)).toEqual(["e4", "e3"]);
  });
});

// ---------------------------------------------------------------------------
// searchContactsPostgres — end-to-end with a mocked prisma.$queryRaw
// ---------------------------------------------------------------------------

describe("searchContactsPostgres", () => {
  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it("ranks a name match above a notes-only match for the same term, across both tables", async () => {
    // First call = Organization search, second = Contact search (Promise.all
    // call order matches searchOrganizations() then searchContacts()).
    queryRawMock.mockResolvedValueOnce([
      {
        id: "cuid-org-4",
        kissingerId: "kis-org-4",
        name: "Delta Holdings",
        isVcFirm: false,
        isProspect: false,
        isArchived: false,
        updatedAt: new Date(),
        rank: 0.12,
        tags: [],
      },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        id: "cuid-c-1",
        kissingerId: "kis-c-1",
        name: "Jane Aerospace",
        title: null,
        location: null,
        isInvestorContact: false,
        isArchived: false,
        updatedAt: new Date(),
        rank: 0.6,
        tags: [],
      },
    ]);

    const results = await searchContactsPostgres("aerospace", 200);
    expect(results.map((r) => r.id)).toEqual(["kis-c-1", "kis-org-4"]);
  });

  it("passes multi-word queries through without throwing and merges hits from both tables", async () => {
    queryRawMock.mockResolvedValueOnce([
      {
        id: "cuid-org-2",
        kissingerId: "kis-org-2",
        name: "Blue Ridge Ventures",
        isVcFirm: true,
        isProspect: false,
        isArchived: false,
        updatedAt: new Date(),
        rank: 0.4,
        tags: [],
      },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        id: "cuid-c-2",
        kissingerId: "kis-c-2",
        name: "Bob Ridge",
        title: "Partner",
        location: null,
        isInvestorContact: true,
        isArchived: false,
        updatedAt: new Date(),
        rank: 0.5,
        tags: [],
      },
    ]);

    const results = await searchContactsPostgres("industrial automation", 200);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id).sort()).toEqual(["kis-c-2", "kis-org-2"]);
  });

  it("returns an empty array (never throws) when Postgres fails", async () => {
    queryRawMock.mockRejectedValueOnce(new Error("connection refused"));
    queryRawMock.mockRejectedValueOnce(new Error("connection refused"));
    const results = await searchContactsPostgres("anything", 200);
    expect(results).toEqual([]);
  });

  it("returns an empty array for a blank query without hitting the database", async () => {
    const results = await searchContactsPostgres("   ", 200);
    expect(results).toEqual([]);
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
