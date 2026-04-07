import Link from "next/link";
import { fetchKissingerFunnelData, VelocityMetric } from "@/lib/kissinger";

export default async function HomePage() {
  const kissinger = await fetchKissingerFunnelData();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <h1 className="text-3xl font-bold text-bisque-900">Dashboard</h1>

      {/* Kissinger stats */}
      <section>
        <h2 className="text-xl font-semibold text-bisque-800 mb-4">
          Kissinger CRM
        </h2>
        {kissinger ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Total Contacts"
              value={kissinger.totalContacts}
              velocity={kissinger.velocity.contacts}
            />
            <StatCard
              label="Organisations"
              value={kissinger.totalOrgs}
              velocity={kissinger.velocity.orgs}
            />
            <StatCard
              label="Total Entities"
              value={kissinger.stats.totalEntities}
              velocity={kissinger.velocity.totalEntities}
            />
            <StatCard
              label="Connections"
              value={kissinger.stats.totalEdges}
              velocity={kissinger.velocity.totalEdges}
            />
          </div>
        ) : (
          <p className="text-bisque-600 italic">
            Kissinger is offline or unreachable — stats unavailable.
          </p>
        )}
      </section>

      {/* Quick links */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/contacts"
          className="block p-6 bg-bisque-700 text-bisque-50 rounded-2xl shadow hover:bg-bisque-600 transition-colors"
        >
          <p className="text-lg font-semibold">Contacts</p>
          <p className="text-sm text-bisque-200 mt-1">
            Browse and search all people and organisations in the graph.
          </p>
        </Link>
        <Link
          href="/funnel"
          className="block p-6 bg-bisque-600 text-bisque-50 rounded-2xl shadow hover:bg-bisque-500 transition-colors"
        >
          <p className="text-lg font-semibold">Funnel Calculator</p>
          <p className="text-sm text-bisque-200 mt-1">
            Plan outreach from ARR target to first calls per week.
          </p>
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
    <div className="bg-white rounded-xl shadow p-4 border border-bisque-100">
      <p className="text-2xl font-bold text-bisque-800">{value.toLocaleString()}</p>
      <p className="text-sm text-bisque-600 mt-1">{label}</p>
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
