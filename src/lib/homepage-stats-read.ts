/**
 * Postgres-backed homepage stats widget (Kissinger live-path disconnect).
 *
 * Replaces `fetchKissingerFunnelData()` (src/lib/kissinger.ts) for the
 * homepage's "Kissinger CRM" stat cards (src/app/(main)/page.tsx) — total
 * contacts / orgs / entities / connections, each with a 2-week velocity
 * (delta + percent change). This is plain aggregate counting (Contact/
 * Organization/RelationshipFrom row counts, and the same counts as of 14
 * days ago via `createdAt`), not a graph traversal, so it has a
 * straightforward Postgres equivalent unlike intro-path or the Outreach
 * queue's completeness-gated cutover.
 *
 * Same never-throw contract as every other read module in this migration:
 * a Postgres outage or unexpected error is caught and logged, returning
 * null so the page can render its existing "offline" state.
 */

import { prisma } from "@/lib/prisma";

export interface VelocityMetric {
  /** Absolute change (current - twoWeeksAgo). Positive = growth. */
  delta: number;
  /** Percent change, or null if there was nothing to compare against (before = 0). */
  pct: number | null;
}

export interface HomepageStats {
  totalContacts: number;
  totalOrgs: number;
  totalEntities: number;
  totalEdges: number;
  velocity: {
    contacts: VelocityMetric;
    orgs: VelocityMetric;
    totalEntities: VelocityMetric;
    totalEdges: VelocityMetric;
  };
}

/** Pure: absolute + percent change between a current and a prior count. */
export function computeVelocity(current: number, before: number): VelocityMetric {
  const delta = current - before;
  const pct = before > 0 ? (delta / before) * 100 : null;
  return { delta, pct };
}

const VELOCITY_WINDOW_DAYS = 14;

/**
 * Postgres replacement for `fetchKissingerFunnelData()`'s homepage stat
 * cards. Returns null (never throws) on any Postgres error, matching the
 * page's existing "Kissinger is offline" fallback contract.
 */
export async function fetchHomepageStatsFromPostgres(): Promise<HomepageStats | null> {
  try {
    const cutoff = new Date(Date.now() - VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [totalContacts, totalOrgs, totalEdges, contactsBefore, orgsBefore, edgesBefore] =
      await Promise.all([
        prisma.contact.count(),
        prisma.organization.count(),
        prisma.relationshipFrom.count(),
        prisma.contact.count({ where: { createdAt: { lt: cutoff } } }),
        prisma.organization.count({ where: { createdAt: { lt: cutoff } } }),
        prisma.relationshipFrom.count({ where: { createdAt: { lt: cutoff } } }),
      ]);

    const totalEntities = totalContacts + totalOrgs;
    const totalEntitiesBefore = contactsBefore + orgsBefore;

    return {
      totalContacts,
      totalOrgs,
      totalEntities,
      totalEdges,
      velocity: {
        contacts: computeVelocity(totalContacts, contactsBefore),
        orgs: computeVelocity(totalOrgs, orgsBefore),
        totalEntities: computeVelocity(totalEntities, totalEntitiesBefore),
        totalEdges: computeVelocity(totalEdges, edgesBefore),
      },
    };
  } catch (err) {
    console.warn(
      "[homepage-stats-read] fetchHomepageStatsFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
