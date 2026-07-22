import Link from "next/link";
import {
  fetchOrgsForSectorFromPostgres,
  fetchSectorDisplayName,
  type SectorOrgListItem,
} from "@/lib/sectors-read";

export const metadata = {
  title: "Sector — Eloso Bisque",
};

// See src/app/(main)/sectors/page.tsx for why this is required for a
// Prisma-backed page with no other dynamic signal.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function OrgCard({ org }: { org: SectorOrgListItem }) {
  return (
    <Link
      href={`/contacts/${org.id}`}
      className="block bg-white rounded-lg border border-bisque-200 px-4 py-3 hover:border-bisque-400 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-bisque-900">{org.name}</p>
        {org.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap justify-end">
            {org.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] bg-bisque-100 text-bisque-600 px-1.5 py-0.5 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {(org.hq || org.website) && (
        <p className="text-xs text-bisque-400 mt-1">
          {[org.hq, org.website].filter(Boolean).join(" · ")}
        </p>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PageProps {
  params: Promise<{ sector: string }>;
}

export default async function SectorDetailPage({ params }: PageProps) {
  const { sector: sectorEncoded } = await params;
  // The slug here is Sector.slug (hyphenated, e.g. "defense-aerospace") —
  // the same identifier the heatmap tile links with, per src/lib/sectors-read.ts.
  const slug = decodeURIComponent(sectorEncoded);

  const [orgsResult, displayName] = await Promise.all([
    fetchOrgsForSectorFromPostgres(slug),
    fetchSectorDisplayName(slug),
  ]);
  const orgs = orgsResult ?? [];
  const heading = displayName ?? slug;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-bisque-400" aria-label="Breadcrumb">
        <Link href="/sectors" className="hover:text-bisque-600 transition-colors">
          Sectors
        </Link>
        <span className="mx-2">/</span>
        <span className="text-bisque-700 font-medium">{heading}</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-bisque-900">{heading}</h1>
        <p className="text-sm text-bisque-500 mt-1">
          {orgs.length} org{orgs.length !== 1 ? "s" : ""} in this sector
        </p>
      </div>

      {/* Org list */}
      {orgs.length === 0 ? (
        <div className="text-center py-12 text-bisque-400">
          <p className="text-lg font-medium text-bisque-600">No orgs found</p>
          <p className="text-sm mt-1">
            Assign orgs to this sector to populate this list.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {orgs.map((org) => (
            <OrgCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}
