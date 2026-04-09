import Link from "next/link";
import { fetchKissingerFunnelData, VelocityMetric } from "@/lib/kissinger";

export default async function HomePage() {
  const kissinger = await fetchKissingerFunnelData();

  return (
    <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
      <h1 className="text-2xl md:text-3xl font-bold text-bisque-900">Dashboard</h1>

      {/* Kissinger stats — 2-col on mobile, 4-col on sm+ */}
      <section>
        <h2 className="text-base md:text-xl font-semibold text-bisque-800 mb-3 md:mb-4">
          Kissinger CRM
        </h2>
        {kissinger ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
            <Link href="/contacts?segment=people">
              <StatCard
                label="Contacts"
                value={kissinger.totalContacts}
                velocity={kissinger.velocity.contacts}
              />
            </Link>
            <Link href="/contacts?segment=other-orgs">
              <StatCard
                label="Orgs"
                value={kissinger.totalOrgs}
                velocity={kissinger.velocity.orgs}
              />
            </Link>
            <Link href="/contacts?segment=all">
              <StatCard
                label="Entities"
                value={kissinger.stats.totalEntities}
                velocity={kissinger.velocity.totalEntities}
              />
            </Link>
            <Link href="/contacts">
              <StatCard
                label="Connections"
                value={kissinger.stats.totalEdges}
                velocity={kissinger.velocity.totalEdges}
              />
            </Link>
          </div>
        ) : (
          <p className="text-bisque-600 italic text-sm">
            Kissinger is offline — stats unavailable.
          </p>
        )}
      </section>

      {/* Quick links — stacked on mobile, 2-col on sm+ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        <Link
          href="/contacts"
          className="flex items-center gap-4 md:block p-4 md:p-6 bg-bisque-700 text-bisque-50 rounded-2xl shadow active:bg-bisque-600 hover:bg-bisque-600 transition-colors min-h-[64px] md:min-h-0"
        >
          <span className="text-2xl md:hidden" aria-hidden="true">👥</span>
          <div>
            <p className="text-base md:text-lg font-semibold">Contacts</p>
            <p className="text-sm text-bisque-200 mt-0.5 md:mt-1">
              Browse and search all people and organisations in the graph.
            </p>
          </div>
        </Link>
        <Link
          href="/outreach"
          className="flex items-center gap-4 md:block p-4 md:p-6 bg-bisque-800 text-bisque-50 rounded-2xl shadow active:bg-bisque-700 hover:bg-bisque-700 transition-colors min-h-[64px] md:min-h-0"
        >
          <span className="text-2xl md:hidden" aria-hidden="true">✉️</span>
          <div>
            <p className="text-base md:text-lg font-semibold">Outreach</p>
            <p className="text-sm text-bisque-200 mt-0.5 md:mt-1">
              LinkedIn outreach tasks for Ben, Jake, and Drew.
            </p>
          </div>
        </Link>
        <Link
          href="/investors"
          className="flex items-center gap-4 md:block p-4 md:p-6 bg-bisque-500 text-bisque-50 rounded-2xl shadow active:bg-bisque-400 hover:bg-bisque-400 transition-colors min-h-[64px] md:min-h-0"
        >
          <span className="text-2xl md:hidden" aria-hidden="true">💼</span>
          <div>
            <p className="text-base md:text-lg font-semibold">Investors</p>
            <p className="text-sm text-bisque-200 mt-0.5 md:mt-1">
              VC firms and investor pipeline.
            </p>
          </div>
        </Link>
        <Link
          href="/funnel"
          className="flex items-center gap-4 md:block p-4 md:p-6 bg-bisque-600 text-bisque-50 rounded-2xl shadow active:bg-bisque-500 hover:bg-bisque-500 transition-colors min-h-[64px] md:min-h-0"
        >
          <span className="text-2xl md:hidden" aria-hidden="true">📊</span>
          <div>
            <p className="text-base md:text-lg font-semibold">Funnel Calculator</p>
            <p className="text-sm text-bisque-200 mt-0.5 md:mt-1">
              Plan outreach from ARR target to first calls per week.
            </p>
          </div>
        </Link>
      </section>
    </div>
  );
}

function formatVelocity(v: VelocityMetric): string | null {
  if (v.delta === 0) return null;
  const sign = v.delta > 0 ? "+" : "";
  const gross = `${sign}${v.delta.toLocaleString()}`;
  if (v.pct === null) return gross;
  const pctStr = `${sign}${v.pct.toFixed(1)}%`;
  return `${gross} (${pctStr})`;
}

function StatCard({
  label,
  value,
  velocity,
}: {
  label: string;
  value: number;
  velocity?: VelocityMetric;
}) {
  const velocityText = velocity ? formatVelocity(velocity) : null;
  const isPositive = velocity && velocity.delta > 0;
  const isNegative = velocity && velocity.delta < 0;

  return (
    <div className="bg-white rounded-xl shadow p-3 md:p-4 border border-bisque-100 hover:shadow-md hover:border-bisque-200 transition-all cursor-pointer">
      <p className="text-xl md:text-2xl font-bold text-bisque-800">{value.toLocaleString()}</p>
      <p className="text-xs md:text-sm text-bisque-600 mt-0.5 md:mt-1">{label}</p>
      {velocityText && (
        <p
          className={`text-xs mt-1 font-medium ${
            isPositive
              ? "text-green-600"
              : isNegative
              ? "text-red-500"
              : "text-bisque-400"
          }`}
        >
          {velocityText} <span className="font-normal text-bisque-400">2w</span>
        </p>
      )}
    </div>
  );
}
