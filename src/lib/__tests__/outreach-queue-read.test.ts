/**
 * Tests for the Postgres-backed Outreach queue read path (Prisma Phase 3.2,
 * GH #43). These functions are NOT yet wired into
 * src/app/(main)/outreach/page.tsx — see the module doc comment in
 * src/lib/outreach-queue-read.ts for why the cutover is deliberately gated.
 *
 * Behavior under test (from the ProspectContactRaw contract in
 * src/lib/kissinger.ts, which the frontend components depend on verbatim):
 *   - `mapQueueEntryRowToProspectContactRaw` is a pure function: given a
 *     joined OutreachQueueEntry+Contact+Organization+User row, it produces
 *     exactly the ProspectContactRaw shape the frontend already renders.
 *   - `id` MUST be the Kissinger entity ID (`contact.kissingerId`), NOT the
 *     Postgres row id — every mutation route (skip, outreach-touch,
 *     outreach-response, generate-message) still takes a Kissinger entity ID
 *     from the frontend and dual-writes into Postgres internally. If the read
 *     path returned the Postgres cuid instead, every mutation button on every
 *     card would silently 404/fail against Kissinger.
 *   - sector tags exclude the "prospect"/"eloso"/"fit-*" bookkeeping tags,
 *     matching the Kissinger-based fetchProspectContacts filtering.
 *   - fitTier defaults to "high" when the org has no fit tier data, matching
 *     the Kissinger-based default.
 *   - signal fields (lastSignalDate, signalDismissed, etc.) are read directly
 *     off the Contact row — per docs/prisma-schema-design.md, these were
 *     captured as plain Contact columns during the GH #41 backfill,
 *     independent of the (currently empty) Signal history table.
 *   - outreachMessageSender/queueOwner are derived from the queue entry's
 *     assigned user, not from GeneratedMessage (which is empty in prod today
 *     — see the module doc comment for why this doesn't regress the UI).
 */

import { describe, it, expect } from "vitest";
import { mapQueueEntryRowToProspectContactRaw, type QueueEntryJoinRow } from "@/lib/outreach-queue-read";

function baseRow(overrides: Partial<QueueEntryJoinRow> = {}): QueueEntryJoinRow {
  return {
    contact: {
      kissingerId: "kiss_1",
      name: "Jane Prospect",
      title: "VP Supply Chain",
      notes: "Met at a conference",
      outreachStage: "cold",
      linkedinUrl: "https://www.linkedin.com/in/jane-prospect",
      lastSignalDate: null,
      lastSignalKeyword: null,
      lastSignalUrl: null,
      signalDismissed: false,
      signalSnoozedUntil: null,
      organization: null,
    },
    user: { email: "ben@eloso.ai" },
    activeGeneratedMessage: null,
    ...overrides,
  };
}

describe("mapQueueEntryRowToProspectContactRaw", () => {
  it("uses the Kissinger entity ID, not the Postgres row id, as the returned id", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(baseRow());
    expect(raw.id).toBe("kiss_1");
  });

  it("derives company from the joined Organization name", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({
        contact: {
          ...baseRow().contact,
          organization: { name: "Acme Rail Co", fitTier: null, tags: [] },
        },
      })
    );
    expect(raw.company).toBe("Acme Rail Co");
  });

  it("returns an empty company string when there is no linked organization", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(baseRow());
    expect(raw.company).toBe("");
  });

  it("derives sector tags from OrganizationTag, excluding prospect/eloso/fit-* bookkeeping tags", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({
        contact: {
          ...baseRow().contact,
          organization: {
            name: "Acme Rail Co",
            fitTier: null,
            tags: [{ tag: "prospect" }, { tag: "eloso" }, { tag: "fit-high" }, { tag: "rail-transportation-equipment" }],
          },
        },
      })
    );
    expect(raw.sector).toEqual(["rail-transportation-equipment"]);
  });

  it("uses Organization.fitTier when set", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({
        contact: {
          ...baseRow().contact,
          organization: { name: "Acme Rail Co", fitTier: "medium", tags: [] },
        },
      })
    );
    expect(raw.fitTier).toBe("medium");
  });

  it("defaults fitTier to 'high' when the org has no fit data at all", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(baseRow());
    expect(raw.fitTier).toBe("high");
  });

  it("reads signal fields directly off the Contact row (independent of the Signal table)", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({
        contact: {
          ...baseRow().contact,
          lastSignalDate: new Date("2026-07-20T00:00:00.000Z"),
          lastSignalKeyword: "expansion",
          lastSignalUrl: "https://linkedin.com/posts/123",
          signalDismissed: true,
          signalSnoozedUntil: new Date("2026-08-01T00:00:00.000Z"),
        },
      })
    );
    expect(raw.lastSignalDate).toBe("2026-07-20T00:00:00.000Z");
    expect(raw.lastSignalKeyword).toBe("expansion");
    expect(raw.lastSignalUrl).toBe("https://linkedin.com/posts/123");
    expect(raw.signalDismissed).toBe(true);
    expect(raw.signalSnoozedUntil).toBe("2026-08-01T00:00:00.000Z");
  });

  it("derives outreachMessageSender and queueOwner from the assigned user's email", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(baseRow({ user: { email: "jake@eloso.ai" } }));
    expect(raw.outreachMessageSender).toBe("jake");
    expect(raw.queueOwner).toBe("jake");
  });

  it("falls back to a LinkedIn search URL when no direct profile URL is stored", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({ contact: { ...baseRow().contact, linkedinUrl: null, name: "Jane Prospect" } })
    );
    expect(raw.linkedinUrl).toContain("linkedin.com/search/results/people");
    expect(raw.linkedinUrl).toContain(encodeURIComponent("Jane Prospect"));
  });

  it("passes through outreachStage from the Contact row unchanged", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({ contact: { ...baseRow().contact, outreachStage: "touched_2" } })
    );
    expect(raw.outreachStage).toBe("touched_2");
  });

  it("returns undefined outreachMessage/outreachMessageGeneratedAt when no active GeneratedMessage row exists (empty table today — see module doc)", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(baseRow({ activeGeneratedMessage: null }));
    expect(raw.outreachMessage).toBeUndefined();
    expect(raw.outreachMessageGeneratedAt).toBeUndefined();
  });

  it("surfaces the active GeneratedMessage body/timestamp when one exists", () => {
    const raw = mapQueueEntryRowToProspectContactRaw(
      baseRow({
        activeGeneratedMessage: {
          messageBody: "Hi Jane, ...",
          generatedAt: new Date("2026-07-21T00:00:00.000Z"),
        },
      })
    );
    expect(raw.outreachMessage).toBe("Hi Jane, ...");
    expect(raw.outreachMessageGeneratedAt).toBe("2026-07-21T00:00:00.000Z");
  });
});
