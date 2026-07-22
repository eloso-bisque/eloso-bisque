import { fetchFunnelKanbanDataFromPostgres } from "@/lib/funnel-read";
import FunnelTabs from "./FunnelTabs";

// ---------------------------------------------------------------------------
// /funnel — Funnel Kanban (Prisma Phase 3.6, GH #46) + Funnel Calculator
//
// Bug fix: `FunnelTabs`/`FunnelKanban` (the Kanban board) were added in
// commit 0bb4f8c, but this page was never updated to render them — a
// later commit (e51e88e) built this file as a calculator-only page. The
// Kanban has never been reachable by a real user in production. This
// restores the tab shell (Pipeline / Calculator) so the board — now
// Postgres-backed — is finally visible.
//
// This is a Server Component so the initial board data can be fetched
// directly from Postgres; FunnelTabs/FunnelKanban remain client
// components (drag-and-drop, filters) fed by `initialKanbanData`.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function FunnelPage() {
  const board = await fetchFunnelKanbanDataFromPostgres();

  return <FunnelTabs initialKanbanData={board ?? {}} />;
}
