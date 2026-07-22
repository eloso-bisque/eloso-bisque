/**
 * Pure Funnel stage enum/label helpers and row->card mapping (Prisma Phase
 * 3.6, GH #46).
 *
 * Deliberately has ZERO imports of `@/lib/prisma` (or anything else with a
 * server-only/Node-only dependency graph, e.g. `pg`). This module is
 * imported directly by client components (`FunnelKanban.tsx`, via
 * `FunnelTabs.tsx`'s dynamic import) — importing so much as one *value*
 * binding (not just a type) from a module that itself imports
 * `@/lib/prisma` pulls the `pg` driver's Node built-in requires (`fs`,
 * `net`, `tls`, `dns`) into the client bundle and breaks `next build`
 * ("Module not found: Can't resolve 'fs'" etc.). See `funnel-read.ts`,
 * which re-exports everything here for server-side callers (API routes,
 * Server Components) alongside the actual Postgres imperative shell.
 *
 * ---------------------------------------------------------------------
 * Judgment call: the Kanban tracks prospect ORGANIZATIONS, not contacts
 * ---------------------------------------------------------------------
 * See `funnel-read.ts`'s module doc for the full real-prod-data
 * investigation backing this decision (0 of 5,846 Organizations and 0 of a
 * 500-contact sample had a non-default/any `funnel_stage` ever set; the
 * Kanban UI was never wired into a page and thus never reachable by a real
 * user) — this module just implements the resulting schema, which already
 * models `funnelStage` on `Organization`.
 */

import type { FitTier, FunnelStage as PrismaFunnelStage } from "@prisma/client";

// ---------------------------------------------------------------------------
// Stage enum <-> UI label (same pattern as investors-read.ts's
// pipelineStageEnumToLabel/pipelineStageLabelToEnum)
// ---------------------------------------------------------------------------

export const FUNNEL_STAGE_LABELS: Record<PrismaFunnelStage, string> = {
  Identified: "Identified",
  Researched: "Researched",
  Contacted: "Contacted",
  Engaged: "Engaged",
  MeetingBooked: "Meeting Booked",
  ProposalSent: "Proposal Sent",
  ClosedNurture: "Closed / Nurture",
};

export const FUNNEL_STAGE_ORDER: PrismaFunnelStage[] = [
  "Identified",
  "Researched",
  "Contacted",
  "Engaged",
  "MeetingBooked",
  "ProposalSent",
  "ClosedNurture",
];

const LABEL_TO_STAGE: Record<string, PrismaFunnelStage> = Object.fromEntries(
  Object.entries(FUNNEL_STAGE_LABELS).map(([enumValue, label]) => [label, enumValue as PrismaFunnelStage])
);

export function funnelStageToLabel(stage: PrismaFunnelStage): string {
  return FUNNEL_STAGE_LABELS[stage] ?? "Identified";
}

/** Returns null (rather than defaulting) for an unrecognized label — callers must treat that as "do not write." */
export function funnelStageLabelToEnum(label: string): PrismaFunnelStage | null {
  return LABEL_TO_STAGE[label] ?? null;
}

// ---------------------------------------------------------------------------
// Row -> FunnelOrgCard mapping (pure)
// ---------------------------------------------------------------------------

export interface FunnelOrgCard {
  id: string; // kissingerId — the Kanban's PATCH endpoint and links key off this
  name: string;
  /** Descriptive subtitle — industry, falling back to HQ location. */
  subtitle: string;
  tags: string[];
  fitTier: FitTier | null;
  funnelStage: string; // UI label, e.g. "Meeting Booked"
  updatedAt: string;
}

export interface FunnelOrgRow {
  kissingerId: string | null;
  name: string;
  industry: string | null;
  hq: string | null;
  tags: { tag: string }[];
  fitTier: FitTier | null;
  funnelStage: PrismaFunnelStage;
  updatedAt: Date;
}

/** Returns null (dropped from the board) for a row without a kissingerId — same "no dead link" contract as contacts-read.ts's row mappers. */
export function orgRowToFunnelCard(row: FunnelOrgRow): FunnelOrgCard | null {
  if (!row.kissingerId) return null;
  return {
    id: row.kissingerId,
    name: row.name,
    subtitle: row.industry || row.hq || "",
    tags: row.tags.map((t) => t.tag),
    fitTier: row.fitTier,
    funnelStage: funnelStageToLabel(row.funnelStage),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type FunnelKanbanBoard = Record<string, FunnelOrgCard[]>;

/** Groups cards into the 7 Kanban columns, in FUNNEL_STAGE_ORDER's display order. Every column key is always present (possibly empty). */
export function groupFunnelCardsByStage(cards: FunnelOrgCard[]): FunnelKanbanBoard {
  const board: FunnelKanbanBoard = Object.fromEntries(
    FUNNEL_STAGE_ORDER.map((s) => [funnelStageToLabel(s), [] as FunnelOrgCard[]])
  );
  for (const card of cards) {
    const bucket = board[card.funnelStage] ?? board[funnelStageToLabel("Identified")];
    bucket.push(card);
  }
  return board;
}
