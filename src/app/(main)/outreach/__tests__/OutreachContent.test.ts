/**
 * Behavior under test: the Outreach page's Active/Sent tabs must read from
 * the Postgres-backed queue (`fetchProspectContactsFromPostgres`/
 * `fetchSentContactsFromPostgres`, src/lib/outreach-queue-read.ts), not the
 * Kissinger-backed `fetchProspectContacts`/`fetchSentContacts`
 * (src/lib/kissinger.ts) — the 2026-07-30 read-path cutover (org completeness
 * 97.6%, title completeness 62.3% verified as a Kissinger-side hard ceiling,
 * see src/lib/outreach-queue-read.ts module doc comment).
 *
 * `fetchSignalContacts` (Trigify signals) is a separate, still-Kissinger-backed
 * exception and must remain called — this test also guards against
 * accidentally dropping it while touching the other two imports.
 *
 * If the wiring in src/app/(main)/outreach/OutreachContent.tsx were reverted back to the
 * Kissinger reads, this test fails: the Postgres mocks would see zero calls
 * and the Kissinger prospect/sent mocks would be called instead.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchProspectContactsFromPostgresMock = vi.fn().mockResolvedValue([]);
const fetchSentContactsFromPostgresMock = vi.fn().mockResolvedValue([]);
const fetchProspectContactsMock = vi.fn().mockResolvedValue([]);
const fetchSentContactsMock = vi.fn().mockResolvedValue([]);
const fetchSignalContactsMock = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/outreach-queue-read", () => ({
  fetchProspectContactsFromPostgres: (...args: unknown[]) =>
    fetchProspectContactsFromPostgresMock(...args),
  fetchSentContactsFromPostgres: (...args: unknown[]) => fetchSentContactsFromPostgresMock(...args),
}));

vi.mock("@/lib/kissinger", () => ({
  fetchProspectContacts: (...args: unknown[]) => fetchProspectContactsMock(...args),
  fetchSentContacts: (...args: unknown[]) => fetchSentContactsMock(...args),
  fetchSignalContacts: (...args: unknown[]) => fetchSignalContactsMock(...args),
}));

import { OutreachContent } from "../OutreachContent";

describe("OutreachContent data source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads active queue contacts from Postgres, scoped to the current member", async () => {
    await OutreachContent({ currentMember: "Drew" });

    expect(fetchProspectContactsFromPostgresMock).toHaveBeenCalledWith("drew");
    expect(fetchProspectContactsMock).not.toHaveBeenCalled();
  });

  it("reads sent contacts from Postgres", async () => {
    await OutreachContent({ currentMember: "Drew" });

    expect(fetchSentContactsFromPostgresMock).toHaveBeenCalled();
    expect(fetchSentContactsMock).not.toHaveBeenCalled();
  });

  it("still reads Trigify signal contacts from Kissinger (unrelated, untouched exception)", async () => {
    await OutreachContent({ currentMember: "Drew" });

    expect(fetchSignalContactsMock).toHaveBeenCalled();
  });

  it("defaults to the drew queue when unauthenticated", async () => {
    await OutreachContent({ currentMember: null });

    expect(fetchProspectContactsFromPostgresMock).toHaveBeenCalledWith("drew");
  });
});
