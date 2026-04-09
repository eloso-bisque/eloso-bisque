/**
 * CSV bulk-contact parsing utility.
 *
 * Accepts raw CSV text and returns parsed contact rows plus any validation
 * errors. Designed to be used both server-side (API route) and in tests.
 *
 * Expected CSV shape (headers optional):
 *   name, email, organization
 *
 * Rules:
 * - If the first row looks like headers (contains "name", "email", "org", etc.)
 *   it is skipped and column mapping is derived from it.
 * - If no headers are detected, columns are assumed to be: name, email, organization.
 * - Blank rows are silently skipped.
 * - Rows with no usable data after trimming are skipped.
 * - A row is flagged with a validation error if it has no name AND no email.
 */

export interface ParsedContact {
  name: string;
  email?: string;
  organization?: string;
}

export interface ParseResult {
  contacts: ParsedContact[];
  /** Rows that were skipped due to validation errors, with the reason. */
  errors: { row: number; raw: string; reason: string }[];
  /** True if a header row was detected and consumed. */
  hadHeaders: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Very simple CSV row splitter — handles quoted fields with commas inside. */
function splitCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double-quote inside a quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const HEADER_KEYWORDS = new Set([
  "name",
  "email",
  "organization",
  "org",
  "company",
  "first_name",
  "last_name",
  "firstname",
  "lastname",
  "full_name",
  "fullname",
  "mail",
  "e-mail",
]);

/** Returns true if the row looks like a CSV header row. */
function isHeaderRow(fields: string[]): boolean {
  const lower = fields.map((f) => f.toLowerCase().replace(/\s+/g, "_"));
  return lower.some((f) => HEADER_KEYWORDS.has(f));
}

/** Map a header-derived field name to our canonical key. */
function mapHeaderToKey(
  header: string
): "name" | "email" | "organization" | null {
  const h = header.toLowerCase().replace(/[-\s]+/g, "_");
  if (["name", "full_name", "fullname", "contact_name"].includes(h))
    return "name";
  if (["first_name", "firstname"].includes(h)) return "name"; // best effort
  if (
    ["email", "mail", "e_mail", "email_address"].includes(h)
  )
    return "email";
  if (
    [
      "organization",
      "org",
      "company",
      "company_name",
      "org_name",
      "organisation",
    ].includes(h)
  )
    return "organization";
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseCsv(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { contacts: [], errors: [], hadHeaders: false };
  }

  const firstFields = splitCsvRow(lines[0]);
  const hadHeaders = isHeaderRow(firstFields);

  // Build column index → canonical key mapping
  let colMap: ("name" | "email" | "organization" | null)[];

  if (hadHeaders) {
    colMap = firstFields.map(mapHeaderToKey);
  } else {
    // Default column order: name, email, organization
    colMap = ["name", "email", "organization"];
  }

  const dataLines = hadHeaders ? lines.slice(1) : lines;
  const contacts: ParsedContact[] = [];
  const errors: { row: number; raw: string; reason: string }[] = [];

  // Row index in terms of the original file (1-based, header = row 1)
  const rowOffset = hadHeaders ? 2 : 1;

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const rowNum = i + rowOffset;

    const fields = splitCsvRow(line);
    const mapped: Partial<ParsedContact> = {};

    for (let c = 0; c < colMap.length; c++) {
      const key = colMap[c];
      if (!key) continue;
      const val = (fields[c] ?? "").trim();
      if (!val) continue;

      // For "name" key, concatenate first+last if we already have a value
      // (handles separate first/last columns gracefully — just append)
      if (key === "name" && mapped.name) {
        mapped.name = `${mapped.name} ${val}`;
      } else {
        (mapped as Record<string, string>)[key] = val;
      }
    }

    // Validate: must have at least a name or email
    if (!mapped.name && !mapped.email) {
      errors.push({
        row: rowNum,
        raw: line,
        reason: "Row has no name or email — skipped.",
      });
      continue;
    }

    contacts.push({
      name: mapped.name ?? "",
      email: mapped.email,
      organization: mapped.organization,
    });
  }

  return { contacts, errors, hadHeaders };
}
