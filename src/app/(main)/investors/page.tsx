/**
 * /investors — Investor CRM page (BIS-327)
 *
 * Three sub-tabs: Firms | People | Pipeline
 *
 * Architecture note: Investors are kind=org+tag=vc (firms) and kind=person+tag=vc (people).
 * Kissinger's closed EntityKind enum does not have investor_firm/investor_person.
 * We use tags for disambiguation and investor-specific scoring.
 */

import Link from "next/link";
import { fetchInvestorData } from "@/lib/kissinger";
import type { InvestorFirm, InvestorPerson } from "@/lib/kissinger";
import { scoreInvestor } from "@/lib/score-contact";
import type { ScoreResult } from "@/lib/score-contact";

// ---------------------------------------------------------------------------
// Sub-tab type
// ---------------------------------------------------------------------------

type InvestorTab = "firms" | "people" | "pipeline";

function isValidTab(v: string | undefined): v is InvestorTab {
  return ["firms", "people", "pipeline"].includes(v ?? "");
}

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score, label = "Fit" }: { score: number; label?: string }) {
  let cls: string;
  if (score >= 70) cls = "bg-green-100 text-green-700 border border-green-200";
  else if (score >= 40) cls = "bg-yellow-100 text-yellow-700 border border-yellow-200";
  else cls = "bg-bisque-100 text-bisque-600 border border-bisque-200";

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${cls}`}
      title={`${label} score: ${score}/100`}
    >
      {score}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pipeline stage badge
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<string, string> = {
  "Research": "bg-gray-100 text-gray-600",
  "Warm Intro": "bg-blue-100 text-blue-700",
  "First Meeting": "bg-indigo-100 text-indigo-700",
  "Partner Meeting": "bg-violet-100 text-violet-700",
  "Term Sheet": "bg-amber-100 text-amber-700",
  "Closed": "bg-green-100 text-green-700",
  "Passed": "bg-red-100 text-red-600",
};

function StageBadge({ stage }: { stage: string }) {
  const cls = STAGE_COLORS[stage] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {stage || "Research"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Firm card
// ---------------------------------------------------------------------------

function FirmCard({ firm, score }: { firm: InvestorFirm; score?: ScoreResult }) {
  const stageStr = firm.stage || firm.tags.find((t) =>
    ["seed", "pre-seed", "series-a", "series-b", "growth"].includes(t)
  ) || "";

  return (
    <Link
      href={`/investors/firms/${encodeURIComponent(firm.id)}`}
      className="flex items-center gap-3 bg-white rounded-xl border border-bisque-100 shadow-sm px-4 py-3 min-h-[72px] active:bg-bisque-50 transition-colors"
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 bg-emerald-100 text-emerald-700"
        aria-hidden="true"
      >
        {firm.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-bisque-900 text-base leading-tight truncate">
          {firm.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {stageStr && (
            <span className="text-xs text-bisque-500">{stageStr}</span>
          )}
          {firm.checkSize && (
            <span className="text-xs text-bisque-400">{firm.checkSize}</span>
          )}
          {firm.pipelineStage && firm.pipelineStage !== "Research" && (
            <StageBadge stage={firm.pipelineStage} />
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {score !== undefined && <ScoreBadge score={score.score} label="Investor Fit" />}
        <span className="text-bisque-300 text-sm" aria-hidden="true">→</span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Person card
// ---------------------------------------------------------------------------

function PersonCard({ person, score }: { person: InvestorPerson; score?: ScoreResult }) {
  return (
    <Link
      href={`/investors/people/${encodeURIComponent(person.id)}`}
      className="flex items-center gap-3 bg-white rounded-xl border border-bisque-100 shadow-sm px-4 py-3 min-h-[72px] active:bg-bisque-50 transition-colors"
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 bg-sky-100 text-sky-700"
        aria-hidden="true"
      >
        {person.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-bisque-900 text-base leading-tight truncate">
          {person.name}
        </p>
        {(person.title || person.firmName) && (
          <p className="text-sm text-bisque-500 mt-0.5 truncate">
            {[person.title, person.firmName].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {score !== undefined && <ScoreBadge score={score.score} label="Investor Fit" />}
        <span className="text-bisque-300 text-sm" aria-hidden="true">→</span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Pipeline view (BIS-330 stub extended)
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = [
  "Research",
  "Warm Intro",
  "First Meeting",
  "Partner Meeting",
  "Term Sheet",
  "Closed",
  "Passed",
] as const;

function PipelineView({ firms }: { firms: InvestorFirm[] }) {
  const byStage: Record<string, InvestorFirm[]> = {};
  for (const stage of PIPELINE_STAGES) byStage[stage] = [];

  for (const firm of firms) {
    const stage = firm.pipelineStage || "Research";
    if (byStage[stage]) byStage[stage].push(firm);
    else byStage["Research"].push(firm);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-bisque-500">
        Stages are stored as <code className="font-mono text-xs bg-bisque-100 px-1 rounded">pipeline_stage</code> meta on each firm.
        Click a firm to view details and update stage.
      </p>
      {PIPELINE_STAGES.map((stage) => {
        const stageFirms = byStage[stage] ?? [];
        if (stageFirms.length === 0) return null;
        return (
          <div key={stage}>
            <div className="flex items-center gap-2 mb-2">
              <StageBadge stage={stage} />
              <span className="text-xs text-bisque-400">{stageFirms.length} firm{stageFirms.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-2">
              {stageFirms.map((firm) => (
                <Link
                  key={firm.id}
                  href={`/investors/firms/${encodeURIComponent(firm.id)}`}
                  className="flex items-center gap-3 bg-white rounded-lg border border-bisque-100 shadow-sm px-3 py-2 hover:bg-bisque-50 transition-colors"
                >
                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {firm.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-bisque-900 text-sm truncate">{firm.name}</p>
                    {firm.stage && <p className="text-xs text-bisque-400">{firm.stage}</p>}
                  </div>
                  <span className="text-bisque-300 text-sm">→</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page props
// ---------------------------------------------------------------------------

interface InvestorsPageProps {
  searchParams: Promise<{ tab?: string }>;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default async function InvestorsPage({ searchParams }: InvestorsPageProps) {
  const params = await searchParams;
  const tab: InvestorTab = isValidTab(params.tab) ? params.tab : "firms";

  const data = await fetchInvestorData();
  const offline = !data;

  const firms: InvestorFirm[] = data?.firms ?? [];
  const people: InvestorPerson[] = data?.people ?? [];
  const firmDetails = data?.firmDetails ?? new Map();

  // Compute investor fit scores
  const firmScores = new Map<string, ScoreResult>();
  for (const firm of firms) {
    const detail = firmDetails.get(firm.id);
    firmScores.set(
      firm.id,
      scoreInvestor({
        id: firm.id,
        name: firm.name,
        kind: firm.kind,
        tags: firm.tags,
        notes: detail?.notes ?? "",
        meta: detail?.meta ?? [],
        updatedAt: firm.updatedAt,
        edges: [],
        isInvestor: true,
      })
    );
  }

  // Sort firms by score desc
  const sortedFirms = [...firms].sort((a, b) => {
    const sa = firmScores.get(a.id)?.score ?? 0;
    const sb = firmScores.get(b.id)?.score ?? 0;
    return sb - sa;
  });

  const tabs: { key: InvestorTab; label: string; count: number }[] = [
    { key: "firms", label: "Firms", count: firms.length },
    { key: "people", label: "People", count: people.length },
    { key: "pipeline", label: "Pipeline", count: firms.length },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-bisque-900">Investors</h1>
        {!offline && (
          <span className="text-sm text-bisque-500">
            {firms.length} firms · {people.length} people
          </span>
        )}
      </div>

      {/* Offline banner */}
      {offline && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Kissinger is offline — showing cached data.
        </div>
      )}

      {/* Tab bar */}
      <div
        className="flex gap-1 bg-bisque-100 p-1 rounded-xl mb-6 overflow-x-auto"
        role="tablist"
        aria-label="Investor sections"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/investors?tab=${t.key}`}
            role="tab"
            aria-selected={tab === t.key}
            className={`flex-1 min-w-[80px] py-1.5 px-3 text-center rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.key
                ? "bg-white text-bisque-900 shadow-sm"
                : "text-bisque-500 hover:text-bisque-700"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 text-xs text-bisque-400">({t.count})</span>
            )}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {tab === "firms" && (
        <div className="space-y-2" role="tabpanel">
          {sortedFirms.length === 0 && !offline && (
            <p className="text-bisque-500 text-sm text-center py-8">
              No investor firms found. Run the migration script to import VC firms.
            </p>
          )}
          {sortedFirms.map((firm) => (
            <FirmCard
              key={firm.id}
              firm={firm}
              score={firmScores.get(firm.id)}
            />
          ))}
        </div>
      )}

      {tab === "people" && (
        <div className="space-y-2" role="tabpanel">
          {people.length === 0 && !offline && (
            <p className="text-bisque-500 text-sm text-center py-8">
              No investor people found.
            </p>
          )}
          {people.map((person) => (
            <PersonCard key={person.id} person={person} />
          ))}
        </div>
      )}

      {tab === "pipeline" && (
        <div role="tabpanel">
          <PipelineView firms={sortedFirms} />
        </div>
      )}
    </div>
  );
}
