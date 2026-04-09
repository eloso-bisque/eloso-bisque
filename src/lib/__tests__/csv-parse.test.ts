import { describe, it, expect } from "vitest";
import { parseCsv } from "../csv-parse";

describe("parseCsv", () => {
  // -------------------------------------------------------------------------
  // Basic cases
  // -------------------------------------------------------------------------

  it("returns empty result for empty string", () => {
    const result = parseCsv("");
    expect(result.contacts).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.hadHeaders).toBe(false);
  });

  it("returns empty result for whitespace-only input", () => {
    const result = parseCsv("   \n  \n  ");
    expect(result.contacts).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // No-header CSV
  // -------------------------------------------------------------------------

  it("parses name-only CSV without headers", () => {
    const result = parseCsv("Alice\nBob\nCarol");
    expect(result.hadHeaders).toBe(false);
    expect(result.contacts).toHaveLength(3);
    expect(result.contacts[0]).toEqual({ name: "Alice", email: undefined, organization: undefined });
  });

  it("parses name + email CSV without headers", () => {
    const result = parseCsv("Alice,alice@example.com\nBob,bob@example.com");
    expect(result.hadHeaders).toBe(false);
    expect(result.contacts[0]).toEqual({ name: "Alice", email: "alice@example.com", organization: undefined });
    expect(result.contacts[1]).toEqual({ name: "Bob", email: "bob@example.com", organization: undefined });
  });

  it("parses name + email + org CSV without headers", () => {
    const result = parseCsv("Alice,alice@example.com,Acme Corp");
    expect(result.contacts[0]).toEqual({
      name: "Alice",
      email: "alice@example.com",
      organization: "Acme Corp",
    });
  });

  // -------------------------------------------------------------------------
  // Header detection
  // -------------------------------------------------------------------------

  it("detects and skips header row with 'name,email,organization'", () => {
    const csv = "name,email,organization\nAlice,alice@example.com,Acme";
    const result = parseCsv(csv);
    expect(result.hadHeaders).toBe(true);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].name).toBe("Alice");
  });

  it("detects header with different column order", () => {
    const csv = "email,name,organization\nalice@example.com,Alice,Acme";
    const result = parseCsv(csv);
    expect(result.hadHeaders).toBe(true);
    expect(result.contacts[0]).toEqual({
      name: "Alice",
      email: "alice@example.com",
      organization: "Acme",
    });
  });

  it("detects 'org' as a header alias", () => {
    const csv = "name,email,org\nAlice,alice@example.com,Acme Corp";
    const result = parseCsv(csv);
    expect(result.hadHeaders).toBe(true);
    expect(result.contacts[0].organization).toBe("Acme Corp");
  });

  it("detects 'company' as a header alias", () => {
    const csv = "name,company\nBob,Widget Inc";
    const result = parseCsv(csv);
    expect(result.hadHeaders).toBe(true);
    expect(result.contacts[0].organization).toBe("Widget Inc");
  });

  // -------------------------------------------------------------------------
  // Whitespace trimming
  // -------------------------------------------------------------------------

  it("trims whitespace from fields", () => {
    const result = parseCsv("  Alice  ,  alice@example.com  ,  Acme  ");
    expect(result.contacts[0]).toEqual({
      name: "Alice",
      email: "alice@example.com",
      organization: "Acme",
    });
  });

  it("skips blank rows", () => {
    const result = parseCsv("Alice\n\n\nBob\n");
    expect(result.contacts).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  it("reports error for row with no name or email", () => {
    const csv = "name,email\nAlice,\n,";
    const result = parseCsv(csv);
    expect(result.contacts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].reason).toMatch(/no name or email/i);
  });

  // -------------------------------------------------------------------------
  // Quoted fields
  // -------------------------------------------------------------------------

  it("handles quoted fields with commas inside", () => {
    const csv = `name,email,organization\n"Smith, John",john@example.com,"Acme, Inc."`;
    const result = parseCsv(csv);
    expect(result.hadHeaders).toBe(true);
    expect(result.contacts[0]).toEqual({
      name: "Smith, John",
      email: "john@example.com",
      organization: "Acme, Inc.",
    });
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const csv = `name\n"O""Brien"`;
    const result = parseCsv(csv);
    expect(result.contacts[0].name).toBe('O"Brien');
  });

  // -------------------------------------------------------------------------
  // Multiple rows mixed with errors
  // -------------------------------------------------------------------------

  it("returns valid contacts and tracks errors independently", () => {
    const csv = [
      "name,email,organization",
      "Alice,alice@example.com,Acme",
      ",, ",        // no name, no email — error
      "Bob,,Widget", // name only — valid
      ",,",         // empty — error
    ].join("\n");
    const result = parseCsv(csv);
    expect(result.contacts).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.contacts[1].name).toBe("Bob");
    expect(result.contacts[1].organization).toBe("Widget");
  });

  // -------------------------------------------------------------------------
  // Windows-style line endings
  // -------------------------------------------------------------------------

  it("handles CRLF line endings", () => {
    const result = parseCsv("name,email\r\nAlice,alice@example.com\r\nBob,bob@example.com");
    expect(result.contacts).toHaveLength(2);
  });
});
