/**
 * Tests for the Outreach Queue dual-write helpers (Prisma Phase 3.2).
 *
 * Behavior under test (from GH #43 / docs/prisma-schema-design.md sections
 * 3.1/3.2), not from the implementation:
 *
 *   - State machine transitions: cold -> touched_1 -> touched_2 -> touched_3
 *     -> responded. Each "Mark Sent" touch must record the stage the contact
 *     was in *before* the touch and the stage it moves to *after*, and must
 *     advance Contact.outreachStage + OutreachQueueEntry.currentStage to
 *     match.
 *   - The "at most one active queue entry per contact" invariant
 *     (@@unique([contactId, isActive], name: "unique_active_assignment") in
 *     prisma/schema.prisma) must be respected by application code: before a
 *     new assignment is created for a contact, any existing active
 *     assignment for that same contact must be deactivated first — never two
 *     live rows for the same contact.
 *   - "Skip" and "Mark Sent" (first touch only) and "Log Response" each
 *     deactivate the current queue entry with the correct
 *     deactivatedReason ("skipped" | "sent" | "responded").
 *   - None of these dual-write helpers may ever throw — a Postgres outage or
 *     a not-yet-backfilled contact/user must degrade gracefully (log +
 *     skip), because Kissinger remains the source of truth during the
 *     dual-write period and must never be blocked by this instrumentation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const userFindUniqueMock = vi.fn();
const contactFindUniqueMock = vi.fn();
const contactUpdateMock = vi.fn();
const queueEntryUpdateManyMock = vi.fn();
const queueEntryCreateManyMock = vi.fn();
const queueEntryFindFirstMock = vi.fn();
const queueEntryUpdateMock = vi.fn();
const touchCreateMock = vi.fn();
const responseCreateMock = vi.fn();
const generatedMessageUpdateManyMock = vi.fn();
const generatedMessageCreateMock = vi.fn();

/** A fake `$transaction` that just invokes the callback with the same mocked client. */
function makeTxClient() {
  return {
    outreachQueueEntry: {
      updateMany: (...args: unknown[]) => queueEntryUpdateManyMock(...args),
      createMany: (...args: unknown[]) => queueEntryCreateManyMock(...args),
      findFirst: (...args: unknown[]) => queueEntryFindFirstMock(...args),
      update: (...args: unknown[]) => queueEntryUpdateMock(...args),
    },
    contact: {
      update: (...args: unknown[]) => contactUpdateMock(...args),
    },
    outreachTouch: {
      create: (...args: unknown[]) => touchCreateMock(...args),
    },
    outreachResponse: {
      create: (...args: unknown[]) => responseCreateMock(...args),
    },
    generatedMessage: {
      updateMany: (...args: unknown[]) => generatedMessageUpdateManyMock(...args),
      create: (...args: unknown[]) => generatedMessageCreateMock(...args),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    contact: {
      findUnique: (...args: unknown[]) => contactFindUniqueMock(...args),
      update: (...args: unknown[]) => contactUpdateMock(...args),
    },
    outreachQueueEntry: {
      updateMany: (...args: unknown[]) => queueEntryUpdateManyMock(...args),
      createMany: (...args: unknown[]) => queueEntryCreateManyMock(...args),
      findFirst: (...args: unknown[]) => queueEntryFindFirstMock(...args),
      update: (...args: unknown[]) => queueEntryUpdateMock(...args),
    },
    outreachTouch: { create: (...args: unknown[]) => touchCreateMock(...args) },
    outreachResponse: { create: (...args: unknown[]) => responseCreateMock(...args) },
    generatedMessage: {
      updateMany: (...args: unknown[]) => generatedMessageUpdateManyMock(...args),
      create: (...args: unknown[]) => generatedMessageCreateMock(...args),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(makeTxClient())),
  },
}));

import {
  nextStageForTouch,
  FIRST_TOUCH_NUMBER,
  dualWriteNewBatchAssignment,
  dualWriteSkip,
  dualWriteMarkSent,
  dualWriteOutreachResponse,
  dualWriteGeneratedMessage,
} from "@/lib/outreach-dual-write";

function resetAllMocks() {
  [
    userFindUniqueMock,
    contactFindUniqueMock,
    contactUpdateMock,
    queueEntryUpdateManyMock,
    queueEntryCreateManyMock,
    queueEntryFindFirstMock,
    queueEntryUpdateMock,
    touchCreateMock,
    responseCreateMock,
    generatedMessageUpdateManyMock,
    generatedMessageCreateMock,
  ].forEach((m) => m.mockReset());
}

describe("nextStageForTouch (state machine: cold -> touched_1 -> touched_2 -> touched_3)", () => {
  it("maps touch 1 as cold -> touched_1", () => {
    expect(nextStageForTouch(1)).toEqual({ before: "cold", after: "touched_1" });
  });
  it("maps touch 2 as touched_1 -> touched_2", () => {
    expect(nextStageForTouch(2)).toEqual({ before: "touched_1", after: "touched_2" });
  });
  it("maps touch 3 as touched_2 -> touched_3", () => {
    expect(nextStageForTouch(3)).toEqual({ before: "touched_2", after: "touched_3" });
  });
  it("returns null for an out-of-range touch number", () => {
    expect(nextStageForTouch(4)).toBeNull();
    expect(nextStageForTouch(0)).toBeNull();
  });
  it("FIRST_TOUCH_NUMBER constant is 1 (the touch that deactivates the queue entry)", () => {
    expect(FIRST_TOUCH_NUMBER).toBe(1);
  });
});

describe("dualWriteNewBatchAssignment", () => {
  beforeEach(() => {
    resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "usr_ben" });
  });

  it("creates a queue entry for each resolvable contact, scoped to the resolved user", async () => {
    contactFindUniqueMock.mockImplementation(({ where }: { where: { kissingerId: string } }) =>
      Promise.resolve({ id: `pg_${where.kissingerId}`, organizationId: "org_1", outreachStage: "cold" })
    );
    queueEntryUpdateManyMock.mockResolvedValue({ count: 0 });
    queueEntryCreateManyMock.mockResolvedValue({ count: 2 });

    await dualWriteNewBatchAssignment({
      assigneeLower: "ben",
      kissingerContactIds: ["kiss_1", "kiss_2"],
    });

    expect(queueEntryCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          contactId: "pg_kiss_1",
          userId: "usr_ben",
          organizationId: "org_1",
          stageAtAssignment: "cold",
          currentStage: "cold",
        },
        {
          contactId: "pg_kiss_2",
          userId: "usr_ben",
          organizationId: "org_1",
          stageAtAssignment: "cold",
          currentStage: "cold",
        },
      ],
      skipDuplicates: true,
    });
  });

  it("enforces the unique_active_assignment invariant: deactivates any existing active entry for a contact BEFORE creating the new one", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "cold" });
    queueEntryUpdateManyMock.mockResolvedValue({ count: 1 });
    queueEntryCreateManyMock.mockResolvedValue({ count: 1 });

    await dualWriteNewBatchAssignment({ assigneeLower: "ben", kissingerContactIds: ["kiss_1"] });

    // The pre-emptive deactivation must be for THIS contact, isActive:true -> false,
    // reason "reassigned", and it must happen before createMany is invoked.
    expect(queueEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { contactId: "pg_kiss_1", isActive: true },
      data: expect.objectContaining({ isActive: false, deactivatedReason: "reassigned" }),
    });
    const deactivateOrder = queueEntryUpdateManyMock.mock.invocationCallOrder[0];
    const createOrder = queueEntryCreateManyMock.mock.invocationCallOrder[0];
    expect(deactivateOrder).toBeLessThan(createOrder);
  });

  it("skips contacts that have not been backfilled into Postgres yet (no throw)", async () => {
    contactFindUniqueMock.mockResolvedValue(null);

    await expect(
      dualWriteNewBatchAssignment({ assigneeLower: "ben", kissingerContactIds: ["kiss_unknown"] })
    ).resolves.toBeUndefined();

    expect(queueEntryCreateManyMock).not.toHaveBeenCalled();
  });

  it("does not throw and does not write when the assignee has no Postgres User row", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    await expect(
      dualWriteNewBatchAssignment({ assigneeLower: "ben", kissingerContactIds: ["kiss_1"] })
    ).resolves.toBeUndefined();

    expect(queueEntryCreateManyMock).not.toHaveBeenCalled();
  });

  it("does not throw when the transaction itself fails", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "cold" });
    queueEntryUpdateManyMock.mockRejectedValue(new Error("connection terminated"));

    await expect(
      dualWriteNewBatchAssignment({ assigneeLower: "ben", kissingerContactIds: ["kiss_1"] })
    ).resolves.toBeUndefined();
  });
});

describe("dualWriteSkip", () => {
  beforeEach(resetAllMocks);

  it("deactivates the contact's active queue entry with deactivatedReason='skipped'", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "cold" });
    queueEntryUpdateManyMock.mockResolvedValue({ count: 1 });

    await dualWriteSkip({ kissingerContactId: "kiss_1" });

    expect(queueEntryUpdateManyMock).toHaveBeenCalledWith({
      where: { contactId: "pg_kiss_1", isActive: true },
      data: expect.objectContaining({ isActive: false, deactivatedReason: "skipped" }),
    });
  });

  it("no-ops without throwing when the contact is not yet backfilled", async () => {
    contactFindUniqueMock.mockResolvedValue(null);
    await expect(dualWriteSkip({ kissingerContactId: "kiss_unknown" })).resolves.toBeUndefined();
    expect(queueEntryUpdateManyMock).not.toHaveBeenCalled();
  });

  it("does not throw when the update itself fails", async () => {
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "cold" });
    queueEntryUpdateManyMock.mockRejectedValue(new Error("connection terminated"));
    await expect(dualWriteSkip({ kissingerContactId: "kiss_1" })).resolves.toBeUndefined();
  });
});

describe("dualWriteMarkSent (state machine transitions + first-touch deactivation)", () => {
  beforeEach(() => {
    resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "usr_ben" });
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "cold" });
    contactUpdateMock.mockResolvedValue({});
    touchCreateMock.mockResolvedValue({ id: "touch_1" });
    queueEntryUpdateMock.mockResolvedValue({});
  });

  it("touch 1: records stageBeforeTouch=cold/stageAfterTouch=touched_1, advances Contact.outreachStage, and deactivates the queue entry with reason='sent'", async () => {
    queueEntryFindFirstMock.mockResolvedValue({ id: "qe_1", isActive: true });

    await dualWriteMarkSent({ kissingerContactId: "kiss_1", touchNumber: 1, assigneeLower: "ben" });

    expect(touchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: "pg_kiss_1",
        queueEntryId: "qe_1",
        userId: "usr_ben",
        touchNumber: 1,
        stageBeforeTouch: "cold",
        stageAfterTouch: "touched_1",
      }),
    });
    expect(contactUpdateMock).toHaveBeenCalledWith({
      where: { id: "pg_kiss_1" },
      data: { outreachStage: "touched_1" },
    });
    expect(queueEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "qe_1" },
      data: expect.objectContaining({
        currentStage: "touched_1",
        isActive: false,
        deactivatedReason: "sent",
      }),
    });
  });

  it("touch 2: records stageBeforeTouch=touched_1/stageAfterTouch=touched_2 and does NOT re-deactivate (queue entry already inactive from touch 1)", async () => {
    queueEntryFindFirstMock.mockResolvedValue({ id: "qe_1", isActive: false });

    await dualWriteMarkSent({ kissingerContactId: "kiss_1", touchNumber: 2, assigneeLower: "ben" });

    expect(touchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ stageBeforeTouch: "touched_1", stageAfterTouch: "touched_2" }),
    });
    expect(queueEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "qe_1" },
      data: { currentStage: "touched_2" },
    });
  });

  it("touch 3: records stageBeforeTouch=touched_2/stageAfterTouch=touched_3", async () => {
    queueEntryFindFirstMock.mockResolvedValue({ id: "qe_1", isActive: false });

    await dualWriteMarkSent({ kissingerContactId: "kiss_1", touchNumber: 3, assigneeLower: "ben" });

    expect(touchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ stageBeforeTouch: "touched_2", stageAfterTouch: "touched_3" }),
    });
  });

  it("still records the touch and advances Contact.outreachStage even when no queue entry exists yet", async () => {
    queueEntryFindFirstMock.mockResolvedValue(null);

    await dualWriteMarkSent({ kissingerContactId: "kiss_1", touchNumber: 1, assigneeLower: "ben" });

    expect(touchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ queueEntryId: null }),
    });
    expect(contactUpdateMock).toHaveBeenCalled();
    expect(queueEntryUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range touchNumber without writing anything", async () => {
    await dualWriteMarkSent({ kissingerContactId: "kiss_1", touchNumber: 4, assigneeLower: "ben" });
    expect(touchCreateMock).not.toHaveBeenCalled();
  });

  it("does not throw when the contact has not been backfilled", async () => {
    contactFindUniqueMock.mockResolvedValue(null);
    await expect(
      dualWriteMarkSent({ kissingerContactId: "kiss_unknown", touchNumber: 1, assigneeLower: "ben" })
    ).resolves.toBeUndefined();
  });

  it("does not throw when the transaction fails", async () => {
    queueEntryFindFirstMock.mockRejectedValue(new Error("connection terminated"));
    await expect(
      dualWriteMarkSent({ kissingerContactId: "kiss_1", touchNumber: 1, assigneeLower: "ben" })
    ).resolves.toBeUndefined();
  });
});

describe("dualWriteOutreachResponse", () => {
  beforeEach(() => {
    resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "usr_ben" });
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "touched_3" });
    responseCreateMock.mockResolvedValue({ id: "resp_1" });
    contactUpdateMock.mockResolvedValue({});
    queueEntryUpdateMock.mockResolvedValue({});
  });

  it("creates an OutreachResponse row, sets Contact.outreachStage='responded', and deactivates the queue entry with reason='responded'", async () => {
    queueEntryFindFirstMock.mockResolvedValue({ id: "qe_1", isActive: false });

    await dualWriteOutreachResponse({
      kissingerContactId: "kiss_1",
      responseType: "Interested",
      notes: "very keen",
      assigneeLower: "ben",
    });

    expect(responseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: "pg_kiss_1",
        userId: "usr_ben",
        responseType: "Interested",
        notes: "very keen",
      }),
    });
    expect(contactUpdateMock).toHaveBeenCalledWith({
      where: { id: "pg_kiss_1" },
      data: { outreachStage: "responded" },
    });
    expect(queueEntryUpdateMock).toHaveBeenCalledWith({
      where: { id: "qe_1" },
      data: expect.objectContaining({
        isActive: false,
        deactivatedReason: "responded",
        currentStage: "responded",
      }),
    });
  });

  it("records userId=null when no assignee is known (system-logged response)", async () => {
    queueEntryFindFirstMock.mockResolvedValue(null);

    await dualWriteOutreachResponse({
      kissingerContactId: "kiss_1",
      responseType: "NoReply",
      assigneeLower: null,
    });

    expect(responseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null }),
    });
  });

  it("does not throw when the contact has not been backfilled", async () => {
    contactFindUniqueMock.mockResolvedValue(null);
    await expect(
      dualWriteOutreachResponse({ kissingerContactId: "kiss_unknown", responseType: "Interested", assigneeLower: null })
    ).resolves.toBeUndefined();
    expect(responseCreateMock).not.toHaveBeenCalled();
  });
});

describe("dualWriteGeneratedMessage", () => {
  beforeEach(() => {
    resetAllMocks();
    contactFindUniqueMock.mockResolvedValue({ id: "pg_kiss_1", organizationId: null, outreachStage: "cold" });
    generatedMessageUpdateManyMock.mockResolvedValue({ count: 1 });
    generatedMessageCreateMock.mockResolvedValue({ id: "msg_2" });
  });

  it("deactivates the prior active message for (contact, angle) before inserting the new one", async () => {
    await dualWriteGeneratedMessage({
      kissingerContactId: "kiss_1",
      angle: "vision",
      messageBody: "Hi there...",
      generationMethod: "ai",
      modelId: "claude-opus-4-5",
    });

    expect(generatedMessageUpdateManyMock).toHaveBeenCalledWith({
      where: { contactId: "pg_kiss_1", angle: "vision", isActive: true },
      data: { isActive: false },
    });
    expect(generatedMessageCreateMock).toHaveBeenCalledWith({
      data: {
        contactId: "pg_kiss_1",
        angle: "vision",
        messageBody: "Hi there...",
        generationMethod: "ai",
        modelId: "claude-opus-4-5",
        isActive: true,
      },
    });
    const deactivateOrder = generatedMessageUpdateManyMock.mock.invocationCallOrder[0];
    const createOrder = generatedMessageCreateMock.mock.invocationCallOrder[0];
    expect(deactivateOrder).toBeLessThan(createOrder);
  });

  it("does not throw when the contact has not been backfilled", async () => {
    contactFindUniqueMock.mockResolvedValue(null);
    await expect(
      dualWriteGeneratedMessage({ kissingerContactId: "kiss_unknown", angle: "vision", messageBody: "x" })
    ).resolves.toBeUndefined();
    expect(generatedMessageCreateMock).not.toHaveBeenCalled();
  });
});
