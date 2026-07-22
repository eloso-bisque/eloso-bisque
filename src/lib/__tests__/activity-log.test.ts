/**
 * Tests for the dual-write ActivityLog helper (Prisma Phase 3.1).
 *
 * Behavior under test (from the migration spec, not the implementation):
 *   - A successful call resolves the Postgres User by email and creates one
 *     ActivityLog row with the correct userId/eventType/contactId.
 *   - If no Postgres User exists yet for that email (expected during the
 *     dual-write transition, before the Kissinger backfill seeds Users),
 *     the call must not throw and must not attempt to write a row.
 *   - If the Postgres write itself throws (DB outage, etc.), the call must
 *     still resolve without throwing — the caller (login / outreach-touch
 *     routes) must never fail because of this instrumentation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findUniqueMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    activityLog: { create: (...args: unknown[]) => createMock(...args) },
  },
}));

import { logActivityEvent } from "@/lib/activity-log";

describe("logActivityEvent", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    createMock.mockReset();
  });

  it("creates an ActivityLog row for a known user", async () => {
    findUniqueMock.mockResolvedValue({ id: "usr_drew" });
    createMock.mockResolvedValue({ id: "log_1" });

    await logActivityEvent({ email: "drew@eloso.ai", eventType: "Login" });

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { email: "drew@eloso.ai" },
      select: { id: true },
    });
    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId: "usr_drew",
        eventType: "Login",
        contactId: undefined,
        metadata: undefined,
      },
    });
  });

  it("passes contactId and metadata through for outreach events", async () => {
    findUniqueMock.mockResolvedValue({ id: "usr_ben" });
    createMock.mockResolvedValue({ id: "log_2" });

    await logActivityEvent({
      email: "ben@eloso.ai",
      eventType: "OutreachTouchSent",
      contactId: "contact_123",
      metadata: { touchNumber: 1 },
    });

    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId: "usr_ben",
        eventType: "OutreachTouchSent",
        contactId: "contact_123",
        metadata: { touchNumber: 1 },
      },
    });
  });

  it("does not throw and does not write when the Postgres User does not exist yet", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      logActivityEvent({ email: "jake@eloso.ai", eventType: "Login" })
    ).resolves.toBeUndefined();

    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not throw when the ActivityLog write itself fails", async () => {
    findUniqueMock.mockResolvedValue({ id: "usr_drew" });
    createMock.mockRejectedValue(new Error("connection terminated"));

    await expect(
      logActivityEvent({ email: "drew@eloso.ai", eventType: "Login" })
    ).resolves.toBeUndefined();
  });

  it("does not throw when the User lookup itself fails", async () => {
    findUniqueMock.mockRejectedValue(new Error("connection terminated"));

    await expect(
      logActivityEvent({ email: "drew@eloso.ai", eventType: "Login" })
    ).resolves.toBeUndefined();

    expect(createMock).not.toHaveBeenCalled();
  });
});
