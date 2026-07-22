/**
 * Tests for the Contact/Organization mutation write path (GH #44; cut over
 * to Postgres-only in the Kissinger live-path disconnect).
 *
 * Behavior under test (from the route contracts, not the implementation):
 *   - Creating an entity via /api/contacts/create or /bulk-create must
 *     insert a Contact (kind=person) or Organization (kind=org) row keyed by
 *     a stable external id (self-minted post-disconnect, or the original
 *     Kissinger id for pre-existing entities).
 *   - Updating notes must land on whichever table (Contact or Organization)
 *     actually has a matching kissingerId — the route doesn't know the kind.
 *   - Removing the "prospect-contact" tag must clear the typed
 *     isProspectContact field AND drop the redundant ContactTag row, so tag
 *     list displays and segmentation queries never disagree.
 *   - Creating a contact event must resolve the Postgres Contact by
 *     kissingerId and only ever write a valid ContactEventKind value.
 *   - Since Kissinger is no longer called from any of these routes, Postgres
 *     is the sole write of record — every helper now THROWS on failure
 *     (a missing row, a Postgres outage) instead of swallowing it, so a
 *     failed write is never mistaken for a successful one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const contactCreateMock = vi.fn();
const organizationCreateMock = vi.fn();
const contactUpdateManyMock = vi.fn();
const organizationUpdateManyMock = vi.fn();
const contactFindUniqueMock = vi.fn();
const contactUpdateMock = vi.fn();
const contactTagDeleteManyMock = vi.fn();
const contactEventCreateMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      create: (...args: unknown[]) => contactCreateMock(...args),
      updateMany: (...args: unknown[]) => contactUpdateManyMock(...args),
      findUnique: (...args: unknown[]) => contactFindUniqueMock(...args),
      update: (...args: unknown[]) => contactUpdateMock(...args),
    },
    organization: {
      create: (...args: unknown[]) => organizationCreateMock(...args),
      updateMany: (...args: unknown[]) => organizationUpdateManyMock(...args),
    },
    contactTag: {
      deleteMany: (...args: unknown[]) => contactTagDeleteManyMock(...args),
    },
    contactEvent: {
      create: (...args: unknown[]) => contactEventCreateMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

import {
  dualWriteCreateEntity,
  dualWriteUpdateNotes,
  dualWriteRemoveProspectTag,
  dualWriteCreateContactEvent,
  toContactEventKind,
  withOrganizationNote,
  PROSPECT_CONTACT_TAG,
} from "../contacts-dual-write";

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
});

describe("dualWriteCreateEntity", () => {
  it("creates a Contact row for kind=person", async () => {
    contactCreateMock.mockResolvedValue({ id: "c1" });
    await dualWriteCreateEntity({ kissingerId: "kis-1", kind: "person", name: "Erle Shepard", email: "erle@x.com" });
    expect(contactCreateMock).toHaveBeenCalledWith({
      data: { kissingerId: "kis-1", name: "Erle Shepard", email: "erle@x.com", linkedinUrl: null, notes: null },
    });
    expect(organizationCreateMock).not.toHaveBeenCalled();
  });

  it("persists linkedinUrl for kind=person", async () => {
    contactCreateMock.mockResolvedValue({ id: "c1" });
    await dualWriteCreateEntity({
      kissingerId: "kis-1",
      kind: "person",
      name: "Erle Shepard",
      linkedinUrl: "https://linkedin.com/in/erle",
    });
    expect(contactCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ linkedinUrl: "https://linkedin.com/in/erle" }),
    });
  });

  it("creates an Organization row for kind=org", async () => {
    organizationCreateMock.mockResolvedValue({ id: "o1" });
    await dualWriteCreateEntity({ kissingerId: "kis-2", kind: "org", name: "Denver Ventures" });
    expect(organizationCreateMock).toHaveBeenCalledWith({
      data: { kissingerId: "kis-2", name: "Denver Ventures", notes: null },
    });
    expect(contactCreateMock).not.toHaveBeenCalled();
  });

  it("throws when Prisma rejects (e.g. duplicate kissingerId) — no longer swallowed now that Postgres is the sole write", async () => {
    contactCreateMock.mockRejectedValue(new Error("unique constraint"));
    await expect(
      dualWriteCreateEntity({ kissingerId: "kis-3", kind: "person", name: "X" })
    ).rejects.toThrow("unique constraint");
  });

  it("throws when kissingerId or name is missing", async () => {
    await expect(dualWriteCreateEntity({ kissingerId: "", kind: "person", name: "X" })).rejects.toThrow();
    await expect(dualWriteCreateEntity({ kissingerId: "kis-4", kind: "person", name: "" })).rejects.toThrow();
    expect(contactCreateMock).not.toHaveBeenCalled();
  });
});

describe("withOrganizationNote", () => {
  it("prepends a Company line when organization is provided", () => {
    expect(withOrganizationNote(undefined, "Acme Corp")).toBe("Company: Acme Corp");
  });

  it("prepends the Company line ahead of existing notes", () => {
    expect(withOrganizationNote("Met at a conference", "Acme Corp")).toBe(
      "Company: Acme Corp\nMet at a conference"
    );
  });

  it("returns notes unchanged when organization is empty or whitespace", () => {
    expect(withOrganizationNote("Met at a conference", "")).toBe("Met at a conference");
    expect(withOrganizationNote("Met at a conference", "   ")).toBe("Met at a conference");
    expect(withOrganizationNote(undefined, undefined)).toBeUndefined();
  });
});

describe("dualWriteUpdateNotes", () => {
  it("updates Contact when a matching kissingerId exists there", async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 1 });
    await dualWriteUpdateNotes({ kissingerId: "kis-1", notes: "Met at conference" });
    expect(contactUpdateManyMock).toHaveBeenCalledWith({
      where: { kissingerId: "kis-1" },
      data: { notes: "Met at conference" },
    });
    expect(organizationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("falls back to Organization when Contact has no matching row", async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 0 });
    organizationUpdateManyMock.mockResolvedValue({ count: 1 });
    await dualWriteUpdateNotes({ kissingerId: "kis-org-1", notes: "Series B" });
    expect(organizationUpdateManyMock).toHaveBeenCalledWith({
      where: { kissingerId: "kis-org-1" },
      data: { notes: "Series B" },
    });
  });

  it("throws when neither table has the row", async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 0 });
    organizationUpdateManyMock.mockResolvedValue({ count: 0 });
    await expect(dualWriteUpdateNotes({ kissingerId: "kis-unknown", notes: "x" })).rejects.toThrow();
  });

  it("throws when Prisma rejects", async () => {
    contactUpdateManyMock.mockRejectedValue(new Error("connection reset"));
    await expect(dualWriteUpdateNotes({ kissingerId: "kis-1", notes: "x" })).rejects.toThrow("connection reset");
  });
});

describe("dualWriteRemoveProspectTag", () => {
  it("clears isProspectContact and deletes the ContactTag row together", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "c1" });
    await dualWriteRemoveProspectTag({ kissingerId: "kis-1" });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(contactUpdateMock).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isProspectContact: false },
    });
    expect(contactTagDeleteManyMock).toHaveBeenCalledWith({
      where: { contactId: "c1", tag: PROSPECT_CONTACT_TAG },
    });
  });

  it("throws when the contact does not exist", async () => {
    contactFindUniqueMock.mockResolvedValue(null);
    await expect(dualWriteRemoveProspectTag({ kissingerId: "kis-unknown" })).rejects.toThrow();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("throws when Prisma rejects", async () => {
    contactFindUniqueMock.mockRejectedValue(new Error("timeout"));
    await expect(dualWriteRemoveProspectTag({ kissingerId: "kis-1" })).rejects.toThrow("timeout");
  });
});

describe("toContactEventKind", () => {
  it("passes through recognized kinds unchanged", () => {
    expect(toContactEventKind("Note")).toBe("Note");
    expect(toContactEventKind("Meeting")).toBe("Meeting");
    expect(toContactEventKind("Email")).toBe("Email");
    expect(toContactEventKind("Call")).toBe("Call");
  });

  it("falls back to Custom for an unrecognized kind", () => {
    expect(toContactEventKind("Carrier Pigeon")).toBe("Custom");
  });
});

describe("dualWriteCreateContactEvent", () => {
  it("resolves the contact by kissingerId, creates a ContactEvent row, and returns it", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "c1" });
    const createdRow = {
      id: "evt-1",
      kind: "Meeting" as const,
      notes: "Intro call",
      occurredAt: new Date("2026-07-20T00:00:00.000Z"),
      createdAt: new Date("2026-07-20T00:01:00.000Z"),
    };
    contactEventCreateMock.mockResolvedValue(createdRow);

    const result = await dualWriteCreateContactEvent({
      kissingerId: "kis-1",
      kind: "Meeting",
      notes: "Intro call",
      occurredAt: "2026-07-20T00:00:00.000Z",
    });

    expect(contactEventCreateMock).toHaveBeenCalledWith({
      data: {
        contactId: "c1",
        kind: "Meeting",
        notes: "Intro call",
        occurredAt: new Date("2026-07-20T00:00:00.000Z"),
      },
      select: { id: true, kind: true, notes: true, occurredAt: true, createdAt: true },
    });
    expect(result).toEqual(createdRow);
  });

  it("throws when the contact does not exist", async () => {
    contactFindUniqueMock.mockResolvedValue(null);
    await expect(
      dualWriteCreateContactEvent({
        kissingerId: "kis-unknown",
        kind: "Note",
        notes: "x",
        occurredAt: "2026-07-20T00:00:00.000Z",
      })
    ).rejects.toThrow();
    expect(contactEventCreateMock).not.toHaveBeenCalled();
  });

  it("throws when Prisma rejects", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "c1" });
    contactEventCreateMock.mockRejectedValue(new Error("db down"));
    await expect(
      dualWriteCreateContactEvent({
        kissingerId: "kis-1",
        kind: "Note",
        notes: "x",
        occurredAt: "2026-07-20T00:00:00.000Z",
      })
    ).rejects.toThrow("db down");
  });
});
