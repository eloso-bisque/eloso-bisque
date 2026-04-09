/**
 * Unit tests for kissinger.ts paginated contacts and inline meta.
 *
 * P0: fetchContactsPage() is wired up and returns ContactsPage with meta fields
 * P1a: CONTACTS_PAGE_QUERY includes meta { key value } — no detail fetch needed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

function makeGQLResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data }),
  } as Response);
}

function entitiesResponse(overrides: Partial<{
  hasNextPage: boolean;
  endCursor: string | null;
  nodes: Array<{
    id: string; kind: string; name: string; tags: string[];
    updatedAt: string; archived: boolean;
    meta: { key: string; value: string }[];
    notes: string;
  }>;
}> = {}) {
  const nodes = overrides.nodes ?? [
    {
      id: "person-001",
      kind: "person",
      name: "Alice Chen",
      tags: ["prospect-contact"],
      updatedAt: "2026-01-01T00:00:00Z",
      archived: false,
      meta: [
        { key: "title", value: "VP Supply Chain" },
        { key: "company", value: "HeavyMfg Co" },
        { key: "email", value: "alice@heavymfg.com" },
      ],
      notes: "Key contact at prospect.",
    },
  ];
  return makeGQLResponse({
    entities: {
      pageInfo: {
        hasNextPage: overrides.hasNextPage ?? false,
        hasPreviousPage: false,
        startCursor: "cursor-start",
        endCursor: overrides.endCursor ?? "cursor-end",
      },
      edges: nodes.map((n) => ({ node: n })),
    },
  });
}

describe("fetchContactsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ContactsPage with contacts and pagination info", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      entitiesResponse({ hasNextPage: true, endCursor: "cursor-abc" })
    );

    const { fetchContactsPage } = await import("../kissinger");
    const page = await fetchContactsPage("person", 50);

    expect(page).not.toBeNull();
    expect(page!.contacts).toHaveLength(1);
    expect(page!.hasNextPage).toBe(true);
    expect(page!.endCursor).toBe("cursor-abc");
  });

  it("returns contacts with inline meta fields (P1a — no extra detail fetch)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      entitiesResponse()
    );

    const { fetchContactsPage } = await import("../kissinger");
    const page = await fetchContactsPage("person", 50);

    expect(page).not.toBeNull();
    const contact = page!.contacts[0];
    // Meta should be inline — no separate entity detail fetch required
    expect(contact.meta).toBeDefined();
    expect(contact.meta).toHaveLength(3);
    expect(contact.meta!.find((m) => m.key === "title")?.value).toBe("VP Supply Chain");
    expect(contact.meta!.find((m) => m.key === "company")?.value).toBe("HeavyMfg Co");
    // fetch should only have been called ONCE (not once per contact)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("inline notes are available on each contact", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      entitiesResponse()
    );

    const { fetchContactsPage } = await import("../kissinger");
    const page = await fetchContactsPage("person", 50);

    const contact = page!.contacts[0];
    expect(contact.notes).toBe("Key contact at prospect.");
  });

  it("filters out archived contacts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      entitiesResponse({
        nodes: [
          {
            id: "person-001",
            kind: "person",
            name: "Active Person",
            tags: [],
            updatedAt: "",
            archived: false,
            meta: [],
            notes: "",
          },
          {
            id: "person-archived",
            kind: "person",
            name: "Archived Person",
            tags: [],
            updatedAt: "",
            archived: true,
            meta: [],
            notes: "",
          },
        ],
      })
    );

    const { fetchContactsPage } = await import("../kissinger");
    const page = await fetchContactsPage("person", 50);

    expect(page!.contacts).toHaveLength(1);
    expect(page!.contacts[0].id).toBe("person-001");
  });

  it("returns null on fetch error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error")
    );

    const { fetchContactsPage } = await import("../kissinger");
    const page = await fetchContactsPage("person", 50);

    expect(page).toBeNull();
  });

  it("passes kind, first, and after cursor as variables", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      entitiesResponse()
    );

    const { fetchContactsPage } = await import("../kissinger");
    await fetchContactsPage("org", 25, "next-cursor");

    const callBody = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    expect(callBody.variables.kind).toBe("org");
    expect(callBody.variables.first).toBe(25);
    expect(callBody.variables.after).toBe("next-cursor");
  });

  it("CONTACTS_PAGE_QUERY requests meta fields (P1a)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      entitiesResponse()
    );

    const { fetchContactsPage } = await import("../kissinger");
    await fetchContactsPage("person", 50);

    const callBody = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
    );
    // The query must include meta fields inline
    expect(callBody.query).toContain("meta");
    expect(callBody.query).toContain("key");
    expect(callBody.query).toContain("value");
    // And notes
    expect(callBody.query).toContain("notes");
  });
});
