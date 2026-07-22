import Link from "next/link";
import {
  fetchSectorHeatmapFromPostgres,
  icpColor,
  icpLabel,
  type SectorHeatmapTile,
} from "@/lib/sectors-read";

export const metadata = {
  title: "Sectors — Eloso Bisque",
};

// This page has no dynamic params/searchParams, so without this Next.js
// would treat the Prisma read as statically analyzable and prerender it
// once at build time (unlike a Kissinger fetch(), a Prisma query gives Next
// no signal that the data is request-time-variable). Matches the same fix
// already applied to src/app/(main)/admin/activity/page.tsx (Phase 3.1) for
// the same reason — without this, the heatmap would silently freeze at
// whatever data existed at the last deploy.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
//
// icpColor/icpLabel now live in @/lib/sectors-read as exported, unit-tested
// pure functions (see src/lib/__tests__/sectors-read.test.ts) rather than as
// private helpers here — this is the fix for the 0-1-vs-0-100 ICP scale bug
// this PR calls out, and it needs regression protection, not just a code
// change.

function coveragePercent(sector: SectorHeatmapTile): number {
  if (sector.orgCount === 0) return 0;
  return sector.prospectsWithContacts / sector.orgCount;
}

/** Coverage ring as a simple horizontal progress bar using Tailwind */
function CoverageBar({ pct }: { pct: number }) {
  const pctClamped = Math.min(1, Math.max(0, pct));
  const pctDisplay = (pctClamped * 100).toFixed(0);
  const barColor =
    pctClamped >= 0.5
      ? "bg-green-500"
      : pctClamped >= 0.25
      ? "bg-yellow-400"
      : "bg-red-400";

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-bisque-500 mb-1">
        <span>Coverage</span>
        <span>{pctDisplay}%</span>
      </div>
      <div className="w-full bg-bisque-100 rounded-full h-1.5">
        <div
          className={`${barColor} h-1.5 rounded-full transition-all`}
          style={{ width: `${pctDisplay}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="text-center py-16 text-bisque-400">
      <svg
        className="mx-auto w-12 h-12 mb-4 opacity-40"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        />
      </svg>
      <p className="text-lg font-medium text-bisque-600">No sector data yet</p>
      <p className="text-sm mt-1">
        Assign orgs to a{" "}
        <code className="bg-bisque-100 px-1 rounded text-bisque-700">Sector</code>{" "}
        to populate this view.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sector tile
// ---------------------------------------------------------------------------

function SectorTile({ sector }: { sector: SectorHeatmapTile }) {
  const pct = coveragePercent(sector);
  const hasGap = pct < 0.5;
  const colorClass = icpColor(sector.avgIcpScore);

  return (
    <Link
      href={`/sectors/${encodeURIComponent(sector.slug)}`}
      className="block bg-white rounded-xl border border-bisque-200 p-5 hover:border-bisque-400 hover:shadow-md transition-all group"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-bold text-bisque-900 group-hover:text-bisque-700 leading-snug">
          {sector.displayName}
        </h2>
        <div className="flex gap-1.5 flex-shrink-0">
          {/* ICP fit badge */}
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}
          >
            ICP {icpLabel(sector.avgIcpScore)}
          </span>
          {/* Gap badge */}
          {hasGap && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
              Gap
            </span>
          )}
        </div>
      </div>

      {/* Org count */}
      <p className="text-2xl font-bold text-bisque-800 mt-3">
        {sector.orgCount}
        <span className="text-sm font-normal text-bisque-400 ml-1">orgs</span>
      </p>

      {/* Prospect contacts */}
      <p className="text-xs text-bisque-500 mt-1">
        {sector.prospectsWithContacts} of {sector.orgCount} have prospect contacts
      </p>

      {/* Coverage bar */}
      <CoverageBar pct={pct} />

      {/* Default assignee, if seeded (Sector.defaultAssignee) */}
      {sector.defaultAssignee !== null && (
        <p className="text-xs text-bisque-400 mt-2">
          Default assignee: <span className="font-medium text-bisque-600">{sector.defaultAssignee}</span>
        </p>
      )}

      {/* Apollo market size (if set) */}
      {sector.apolloMarketSize !== null && (
        <p className="text-xs text-bisque-400 mt-2">
          Market:{" "}
          <span className="font-medium text-bisque-600">
            {sector.apolloMarketSize.toLocaleString()}
          </span>
        </p>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SectorsPage() {
  const sectors = await fetchSectorHeatmapFromPostgres();
  const totalOrgs = sectors.reduce((sum, s) => sum + s.orgCount, 0);
  const gapCount = sectors.filter((s) => coveragePercent(s) < 0.5).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-bisque-900">Industry Heat Map</h1>
          <p className="text-sm text-bisque-500 mt-1">
            {sectors.length} sector{sectors.length !== 1 ? "s" : ""} · {totalOrgs} orgs
            {gapCount > 0 && (
              <span className="ml-2 text-orange-600">
                · {gapCount} sector{gapCount !== 1 ? "s" : ""} with coverage gaps
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Tiles grid */}
      {sectors.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sectors.map((sector) => (
            <SectorTile key={sector.slug} sector={sector} />
          ))}
        </div>
      )}
    </div>
  );
}
