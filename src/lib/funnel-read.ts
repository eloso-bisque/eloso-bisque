/**
 * Postgres-backed Funnel Kanban read path (Prisma Phase 3.6, GH #46).
 *
 * The pure stage enum/label helpers and row->card mapper used to live
 * inline in this file, but they've been extracted to `funnel-stage.ts` —
 * client components (`FunnelKanban.tsx`) need those *values*, and importing
 * even one value binding from this file (which imports `@/lib/prisma`,
 * which pulls in the `pg` driver's Node-only requires) broke `next build`
 * for the client bundle. Server-side callers (API routes, this file's own
 * Postgres query) can keep importing from here — everything from
 * `funnel-stage.ts` is re-exported below for convenience/back-compat.
 * See `funnel-stage.ts`'s module doc for the full rationale, including the
 * "Kanban tracks prospect Organizations, not Contacts" judgment call
 * verified against real prod data below.
 */

import { prisma } from "@/lib/prisma";
import type { FunnelKanbanBoard, FunnelOrgCard } from "@/lib/funnel-stage";
import { orgRowToFunnelCard, groupFunnelCardsByStage } from "@/lib/funnel-stage";

export * from "@/lib/funnel-stage";

// ---------------------------------------------------------------------------
// Imperative shell
// ---------------------------------------------------------------------------

/**
 * Postgres replacement for `fetchFunnelKanbanData()`. Never throws —
 * returns null on any Postgres error so the page can render an offline
 * state, matching every other read module in this migration.
 */
export async function fetchFunnelKanbanDataFromPostgres(): Promise<FunnelKanbanBoard | null> {
  try {
    const orgs = await prisma.organization.findMany({
      where: { isProspect: true, isArchived: false },
      select: {
        kissingerId: true,
        name: true,
        industry: true,
        hq: true,
        tags: { select: { tag: true } },
        fitTier: true,
        funnelStage: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    const cards = orgs.map(orgRowToFunnelCard).filter((c): c is FunnelOrgCard => c !== null);
    return groupFunnelCardsByStage(cards);
  } catch (err) {
    console.warn(
      "[funnel-read] fetchFunnelKanbanDataFromPostgres failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
