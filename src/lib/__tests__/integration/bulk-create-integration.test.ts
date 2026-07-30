/**
 * Integration test: CSV -> bulk-create -> real Postgres.
 *
 * Superseded (2026-07-30): the original version of this file predated the
 * Kissinger disconnect (PR #53) and called Kissinger's `createEntity`
 * mutation directly, bypassing this app's actual `/api/contacts/bulk-create`
 * route/`dualWriteCreateEntity` entirely. That made it a false positive: it
 * proved nothing about what the app currently does (bulk-create no longer
 * touches Kissinger at all), and worse, it was opt-OUT (`SKIP_INTEGRATION`
 * had to be explicitly set to *skip* it) with zero cleanup — every default
 * `npx vitest run` created two more permanent "BulkTest Alice/Bob <ts>"
 * person entities directly in real production Kissinger. Auditing prod on
 * 2026-07-30 found 152 such orphaned entities (zero Postgres counterpart,
 * zero tags) accumulated this way, going back to this file's original
 * 2026-04-09 commit. They've since been deleted.
 *
 * This version drives the real current path instead: it calls
 * `dualWriteCreateEntity` (the same function `POST /api/contacts/create`
 * and `POST /api/contacts/bulk-create` both call) against a real Postgres
 * connection, then reads the rows back with a separate `prisma.contact`
 * query to prove the write actually persisted (not just that the function
 * resolved without throwing). It never touches Kissinger. Cleanup happens
 * in `afterAll`, matching the pattern in
 * `outreach-queue-second-deactivation-integration.test.ts`.
 *
 * Opt-in via RUN_INTEGRATION=true (not opt-out) — same rationale as that
 * sibling file: never run write-side integration tests against whatever
 * DATABASE_URL happens to be configured without deliberate intent.
 *
 * Run against real Postgres:
 *   cd ~/lobster-workspace/projects/eloso-bisque
 *   export $(grep -E '^DATABASE_URL=' .env.local | xargs)
 *   RUN_INTEGRATION=true npx vitest run src/lib/__tests__/integration/bulk-create-integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseCsv } from "@/lib/csv-parse";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === "true";
const SKIP = !RUN_INTEGRATION || !process.env.DATABASE_URL;

describe.skipIf(SKIP)("bulk-create integration (real Postgres, no Kissinger)", () => {
  // Imported lazily so this file never constructs the module-level
  // PrismaClient when the suite is skipped (e.g. a plain `npm test` run
  // with no DATABASE_URL set).
  let prisma: typeof import("@/lib/prisma").prisma;
  let dualWriteCreateEntity: typeof import("@/lib/contacts-dual-write").dualWriteCreateEntity;
  let withOrganizationNote: typeof import("@/lib/contacts-dual-write").withOrganizationNote;

  const runId = Date.now();
  const TEST_CSV = `name,email,organization
BulkTest Alice ${runId},bulktest-alice-${runId}@example-test.invalid,BulkTest Corp
BulkTest Bob ${runId},bulktest-bob-${runId}@example-test.invalid,BulkTest Corp
`;

  const createdIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ({ dualWriteCreateEntity, withOrganizationNote } = await import("@/lib/contacts-dual-write"));
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {
        // best-effort cleanup
      });
    }
    await prisma.$disconnect();
  });

  it("parses the test CSV into 2 valid contacts", () => {
    const { contacts, errors } = parseCsv(TEST_CSV);
    expect(errors).toHaveLength(0);
    expect(contacts).toHaveLength(2);
    expect(contacts[0].name).toMatch(/BulkTest Alice/);
    expect(contacts[1].name).toMatch(/BulkTest Bob/);
  });

  it("creates contacts in real Postgres and reads them back via a separate query", async () => {
    const { contacts } = parseCsv(TEST_CSV);

    for (const c of contacts) {
      const id = crypto.randomUUID();
      await dualWriteCreateEntity({
        kissingerId: id,
        kind: "person",
        name: c.name,
        email: c.email,
        notes: withOrganizationNote(undefined, c.organization),
      });
      createdIds.push(
        (await prisma.contact.findUniqueOrThrow({ where: { kissingerId: id }, select: { id: true } })).id
      );
    }

    expect(createdIds).toHaveLength(2);

    // Read back with a fresh query (not the same call path used to create)
    // to prove the write actually persisted in Postgres, not just that
    // dualWriteCreateEntity resolved without throwing.
    const rows = await prisma.contact.findMany({
      where: { id: { in: createdIds } },
      orderBy: { name: "asc" },
    });
    expect(rows).toHaveLength(2);

    const alice = rows.find((r) => r.name.startsWith("BulkTest Alice"));
    const bob = rows.find((r) => r.name.startsWith("BulkTest Bob"));
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(alice!.email).toBe(`bulktest-alice-${runId}@example-test.invalid`);
    expect(alice!.notes).toBe("Company: BulkTest Corp");
    expect(bob!.email).toBe(`bulktest-bob-${runId}@example-test.invalid`);
  }, 30000);
});
