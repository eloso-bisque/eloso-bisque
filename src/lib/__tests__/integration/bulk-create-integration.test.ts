/**
 * Integration test: CSV → bulk-create → Kissinger
 *
 * Requires Kissinger to be running at localhost:8080.
 * Skip with: SKIP_INTEGRATION=true vitest run
 *
 * Run directly with:
 *   cd ~/lobster-workspace/projects/eloso-bisque
 *   KISSINGER_API_URL=http://localhost:8080/graphql npm test -- src/lib/__tests__/integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import { parseCsv } from "@/lib/csv-parse";

const KISSINGER_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";
const SKIP = process.env.SKIP_INTEGRATION === "true";

const TEST_CSV = `name,email,organization
BulkTest Alice ${Date.now()},bulktest-alice-${Date.now()}@example-test.invalid,BulkTest Corp
BulkTest Bob ${Date.now()},bulktest-bob-${Date.now()}@example-test.invalid,BulkTest Corp
`;

const CREATE_ENTITY_MUTATION = `
  mutation CreateEntity($input: CreateEntityInput!) {
    createEntity(input: $input) {
      id
      name
      meta { key value }
    }
  }
`;

const SEARCH_QUERY = `
  query Search($query: String!, $limit: Int) {
    search(query: $query, limit: $limit) {
      __typename
      ... on EntitySearchHitGql {
        id
        name
      }
    }
  }
`;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (KISSINGER_TOKEN) headers["Authorization"] = `Bearer ${KISSINGER_TOKEN}`;

  const res = await fetch(KISSINGER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data as T;
}

async function createOne(
  name: string,
  email: string,
  organization: string
): Promise<{ id: string; name: string }> {
  const meta: { key: string; value: string }[] = [];
  if (email) meta.push({ key: "email", value: email });
  if (organization) meta.push({ key: "company", value: organization });

  const data = await gql<{ createEntity: { id: string; name: string; meta: { key: string; value: string }[] } }>(
    CREATE_ENTITY_MUTATION,
    { input: { kind: "person", name, notes: "integration-test", meta } }
  );
  return data.createEntity;
}

describe.skipIf(SKIP)("bulk-create integration (requires Kissinger on localhost:8080)", () => {
  let createdNames: string[] = [];

  beforeAll(async () => {
    // Verify Kissinger is reachable — skip the whole suite if not
    try {
      await fetch(KISSINGER_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ __typename }" }) });
    } catch {
      console.warn("Kissinger not reachable — skipping integration tests");
    }
  });

  it("parses the test CSV into 2 valid contacts", () => {
    const { contacts, errors } = parseCsv(TEST_CSV);
    expect(errors).toHaveLength(0);
    expect(contacts).toHaveLength(2);
    expect(contacts[0].name).toMatch(/BulkTest Alice/);
    expect(contacts[1].name).toMatch(/BulkTest Bob/);
  });

  it("creates contacts in Kissinger and verifies they exist", async () => {
    const { contacts } = parseCsv(TEST_CSV);

    // Create each contact
    for (const c of contacts) {
      const entity = await createOne(
        c.name,
        c.email ?? "",
        c.organization ?? ""
      );
      expect(entity.id).toBeTruthy();
      expect(entity.name).toBe(c.name);
      createdNames.push(c.name);
    }

    // Verify the contacts exist via search
    for (const name of createdNames) {
      const searchData = await gql<{
        search: { __typename: string; id: string; name: string }[];
      }>(SEARCH_QUERY, { query: name, limit: 5 });

      const hit = searchData.search.find(
        (h) => h.__typename === "EntitySearchHitGql" && h.name === name
      );
      expect(hit, `Expected to find "${name}" in search results`).toBeDefined();
    }
  }, 30000);
});
