/**
 * Tests for the Postgres-backed homepage stats widget (Kissinger live-path
 * disconnect).
 *
 * Behavior under test:
 *   - computeVelocity is pure: delta = current - before, pct = null when
 *     before is 0 (nothing to compare against), otherwise delta/before*100.
 *   - fetchHomepageStatsFromPostgres combines Contact/Organization/
 *     RelationshipFrom counts (now and as of 14 days ago) into the same
 *     shape the homepage previously got from Kissinger's graphStats +
 *     velocityStats queries.
 *   - Never throws — returns null on any Postgres error, matching the
 *     page's "Kissinger is offline" fallback contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const contactCountMock = vi.fn();
const organizationCountMock = vi.fn();
const relationshipFromCountMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { count: (...args: unknown[]) => contactCountMock(...args) },
    organization: { count: (...args: unknown[]) => organizationCountMock(...args) },
    relationshipFrom: { count: (...args: unknown[]) => relationshipFromCountMock(...args) },
  },
}));

import { computeVelocity, fetchHomepageStatsFromPostgres } from "../homepage-stats-read";

describe("computeVelocity", () => {
  it("computes a positive delta and percent for growth", () => {
    expect(computeVelocity(120, 100)).toEqual({ delta: 20, pct: 20 });
  });

  it("computes a negative delta for shrinkage", () => {
    expect(computeVelocity(80, 100)).toEqual({ delta: -20, pct: -20 });
  });

  it("returns pct=null when there was nothing to compare against", () => {
    expect(computeVelocity(10, 0)).toEqual({ delta: 10, pct: null });
  });

  it("returns delta=0, pct=0 for no change", () => {
    expect(computeVelocity(50, 50)).toEqual({ delta: 0, pct: 0 });
  });
});

describe("fetchHomepageStatsFromPostgres", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("combines current and 14-day-prior counts into the homepage stats shape", async () => {
    contactCountMock.mockResolvedValueOnce(9300).mockResolvedValueOnce(9200); // current, before
    organizationCountMock.mockResolvedValueOnce(5900).mockResolvedValueOnce(5846);
    relationshipFromCountMock.mockResolvedValueOnce(15000).mockResolvedValueOnce(14887);

    const stats = await fetchHomepageStatsFromPostgres();

    expect(stats).toEqual({
      totalContacts: 9300,
      totalOrgs: 5900,
      totalEntities: 9300 + 5900,
      totalEdges: 15000,
      velocity: {
        contacts: { delta: 100, pct: computeVelocity(9300, 9200).pct },
        orgs: { delta: 54, pct: computeVelocity(5900, 5846).pct },
        totalEntities: computeVelocity(9300 + 5900, 9200 + 5846),
        totalEdges: { delta: 113, pct: computeVelocity(15000, 14887).pct },
      },
    });
  });

  it("passes a 14-day-ago cutoff to each 'before' count query", async () => {
    contactCountMock.mockResolvedValue(1);
    organizationCountMock.mockResolvedValue(1);
    relationshipFromCountMock.mockResolvedValue(1);

    const before = Date.now();
    await fetchHomepageStatsFromPostgres();

    const beforeCallArgs = contactCountMock.mock.calls[1][0] as { where: { createdAt: { lt: Date } } };
    const cutoff = beforeCallArgs.where.createdAt.lt;
    const daysAgo = (before - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(13.9);
    expect(daysAgo).toBeLessThan(14.1);
  });

  it("returns null (never throws) on a Postgres error", async () => {
    contactCountMock.mockRejectedValue(new Error("connection refused"));

    await expect(fetchHomepageStatsFromPostgres()).resolves.toBeNull();
  });
});
