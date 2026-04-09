/**
 * Tests for the bulk-create logic — specifically the parseCsv integration
 * and the expected BulkCreateResult shape. We test the CSV→contacts pipeline
 * end-to-end; the Kissinger network call is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCsv } from "@/lib/csv-parse";

// ---------------------------------------------------------------------------
// Helpers copied from the route module (we test the logic, not HTTP layer)
// ---------------------------------------------------------------------------

interface ParsedContact {
  name: string;
  email?: string;
  organization?: string;
}

interface BulkCreateResult {
  created: number;
  skipped: number;
  errors: { name: string; reason: string }[];
  parseErrors: { row: number; raw: string; reason: string }[];
}

async function bulkCreateContacts(
  contacts: ParsedContact[],
  kind: "person" | "org",
  createFn: (
    kind: "person" | "org",
    name: string,
    meta: { key: string; value: string }[]
  ) => Promise<{ id: string; name: string }>
): Promise<BulkCreateResult> {
  const creationErrors: { name: string; reason: string }[] = [];
  let created = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const name =
      contact.name || contact.email || contact.organization || "";
    if (!name) {
      skipped++;
      continue;
    }

    const meta: { key: string; value: string }[] = [];
    if (contact.email) meta.push({ key: "email", value: contact.email });
    if (contact.organization)
      meta.push({ key: "company", value: contact.organization });

    try {
      await createFn(kind, name, meta);
      created++;
    } catch (err) {
      creationErrors.push({
        name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, skipped, errors: creationErrors, parseErrors: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bulk-create route logic", () => {
  const mockCreate = vi.fn().mockResolvedValue({ id: "abc", name: "Alice" });

  beforeEach(() => {
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({ id: "abc", name: "Alice" });
  });

  it("creates one contact from a single-row contacts array", async () => {
    const result = await bulkCreateContacts(
      [{ name: "Alice", email: "alice@example.com" }],
      "person",
      mockCreate
    );
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("passes correct meta to createFn", async () => {
    await bulkCreateContacts(
      [{ name: "Bob", email: "bob@example.com", organization: "Acme" }],
      "person",
      mockCreate
    );
    const callArgs = mockCreate.mock.calls[0];
    expect(callArgs[0]).toBe("person"); // kind
    expect(callArgs[1]).toBe("Bob");    // name
    expect(callArgs[2]).toContainEqual({ key: "email", value: "bob@example.com" });
    expect(callArgs[2]).toContainEqual({ key: "company", value: "Acme" });
  });

  it("uses email as name fallback when name is empty", async () => {
    await bulkCreateContacts(
      [{ name: "", email: "noname@example.com" }],
      "person",
      mockCreate
    );
    expect(mockCreate.mock.calls[0][1]).toBe("noname@example.com");
  });

  it("skips contacts with no name, email, or organization", async () => {
    const result = await bulkCreateContacts(
      [{ name: "", email: undefined, organization: undefined }],
      "person",
      mockCreate
    );
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("tracks creation errors per contact and continues", async () => {
    mockCreate
      .mockResolvedValueOnce({ id: "1", name: "Alice" })
      .mockRejectedValueOnce(new Error("duplicate entity"))
      .mockResolvedValueOnce({ id: "3", name: "Carol" });

    const result = await bulkCreateContacts(
      [
        { name: "Alice" },
        { name: "Bob" },
        { name: "Carol" },
      ],
      "person",
      mockCreate
    );

    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe("Bob");
    expect(result.errors[0].reason).toMatch(/duplicate entity/);
  });

  it("creates multiple contacts from CSV text", async () => {
    const csv = "name,email,organization\nAlice,a@a.com,Acme\nBob,b@b.com,Widget";
    const { contacts, errors: parseErrors } = parseCsv(csv);

    expect(parseErrors).toHaveLength(0);
    expect(contacts).toHaveLength(2);

    const result = await bulkCreateContacts(contacts, "person", mockCreate);
    expect(result.created).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("handles a CSV with some invalid rows", async () => {
    const csv = "name,email\nAlice,alice@a.com\n,,\nBob,bob@b.com";
    const { contacts, errors: parseErrors } = parseCsv(csv);

    expect(parseErrors).toHaveLength(1); // the empty row
    expect(contacts).toHaveLength(2);

    const result = await bulkCreateContacts(contacts, "person", mockCreate);
    expect(result.created).toBe(2);
  });
});
