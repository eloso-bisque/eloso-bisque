/**
 * /investors/firms/[id] — Investor firm detail page (BIS-328)
 *
 * Header: firm name, kind, AUM/check size, stage focus, thesis
 * Org chart: people at this firm (partner_at / works_at edges)
 * Portfolio: invested_in edges (if any)
 * Enrich button
 * Pipeline stage selector
 * Investor fit score breakdown
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchInvestorFirmDetail } from "@/lib/kissinger";
import type { PersonAtOrg } from "@/lib/kissinger";
import EnrichButton from "@/components/EnrichButton";
import { scoreInvestor } from "@/lib/score-contact";

// ---------------------------------------------------------------------------
// Stage selector (client island)
// ---------------------------------------------------------------------------

import PipelineStageSelector from "./PipelineStageSelector";

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  let cls: string;
  if (score >= 70) cls = "bg-green-100 text-green-700 border border-green-200";
  else if (score >= 40) cls = "bg-yellow-100 text-yellow-700 border border-yellow-200";
  else cls = "bg-bisque-100 text-bisque-600 border border-bisque-200";
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold tabular-nums ${cls}`}
      title={`Investor fit score: ${score}/100`}
    >
      {score} / 100
    </span>
  );
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

function metaVal(meta: { key: string; value: string }[], key: string): string {
  return meta.find((m) => m.key === key)?.value ?? "";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface FirmDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function FirmDetailPage({ params }: FirmDetailPageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const result = await fetchInvestorFirmDetail(id);

  if (!result) notFound();

  const { contact: firm, edges, peopleAtOrg } = result;

  // Meta extraction
  const stage = metaVal(firm.meta, "stage");
  const checkSize = metaVal(firm.meta, "check_size");
  const location = metaVal(firm.meta, "location");
  const thesis = metaVal(firm.meta, "thesis");
  const priority = metaVal(firm.meta, "priority");
  const pipelineStage = metaVal(firm.meta, "pipeline_stage") || "Research";
  const website = metaVal(firm.meta, "website");
  const sectorFit = metaVal(firm.meta, "sector_fit");
  const source = metaVal(firm.meta, "source");

  // Compute investor fit score
  const scoreResult = scoreInvestor({
    id: firm.id,
    name: firm.name,
    kind: firm.kind,
    tags: firm.tags,
    notes: firm.notes,
    meta: firm.meta,
    updatedAt: firm.updatedAt,
    edges: [],
    isInvestor: true,
  });

  // Portfolio: invested_in edges (forward)
  const portfolioEdges = edges.filter(
    (e) => e.relation === "funded_by" || e.relation === "works_on" || e.relation === "part_of"
  );

  // Stage tags
  const stageTags = firm.tags.filter((t) =>
    ["seed", "pre-seed", "series-a", "series-b", "series-c", "growth", "late-stage",
      "venture", "corporate-vc", "family-office", "accelerator", "company-builder"].includes(t)
  );

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back */}
      <Link
        href="/investors"
        className="inline-flex items-center gap-1 text-sm text-bisque-500 hover:text-bisque-700 mb-4"
      >
        ← Investors
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
            {firm.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-bisque-900">{firm.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">
                VC / Investor
              </span>
              {priority && (
                <span className={`text-xs rounded-full px-2 py-0.5 font-medium border ${
                  priority === "high" ? "bg-green-50 text-green-700 border-green-200"
                  : priority === "medium" ? "bg-yellow-50 text-yellow-700 border-yellow-200"
                  : "bg-bisque-50 text-bisque-600 border-bisque-200"
                }`}>
                  {priority} priority
                </span>
              )}
              <ScoreBadge score={scoreResult.score} />
            </div>
          </div>
        </div>

        {/* Key attributes */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
          {stage && (
            <>
              <dt className="text-bisque-400 font-medium">Stage</dt>
              <dd className="text-bisque-800">{stage}</dd>
            </>
          )}
          {stageTags.length > 0 && !stage && (
            <>
              <dt className="text-bisque-400 font-medium">Stage</dt>
              <dd className="text-bisque-800 capitalize">{stageTags.join(", ")}</dd>
            </>
          )}
          {checkSize && (
            <>
              <dt className="text-bisque-400 font-medium">Check size</dt>
              <dd className="text-bisque-800">{checkSize}</dd>
            </>
          )}
          {location && (
            <>
              <dt className="text-bisque-400 font-medium">Location</dt>
              <dd className="text-bisque-800">{location}</dd>
            </>
          )}
          {sectorFit && (
            <>
              <dt className="text-bisque-400 font-medium">Sector fit</dt>
              <dd className="text-bisque-800 capitalize">{sectorFit.replace(/_/g, " ")}</dd>
            </>
          )}
          {website && (
            <>
              <dt className="text-bisque-400 font-medium">Website</dt>
              <dd className="text-bisque-800">
                <a
                  href={website.startsWith("http") ? website : `https://${website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 hover:underline"
                >
                  {website.replace(/^https?:\/\//, "")}
                </a>
              </dd>
            </>
          )}
          {source && (
            <>
              <dt className="text-bisque-400 font-medium">Source</dt>
              <dd className="text-bisque-600 text-xs">{source}</dd>
            </>
          )}
        </dl>

        {/* Thesis */}
        {thesis && (
          <div className="mt-4 pt-4 border-t border-bisque-50">
            <p className="text-xs font-medium text-bisque-400 mb-1">Investment thesis</p>
            <p className="text-sm text-bisque-700 leading-relaxed">{thesis}</p>
          </div>
        )}

        {/* Notes */}
        {firm.notes && !thesis && (
          <div className="mt-4 pt-4 border-t border-bisque-50">
            <p className="text-xs font-medium text-bisque-400 mb-1">Notes</p>
            <p className="text-sm text-bisque-700 leading-relaxed">{firm.notes}</p>
          </div>
        )}
      </div>

      {/* Pipeline stage */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold text-bisque-700 mb-3">Fundraising Pipeline</h2>
        <PipelineStageSelector firmId={firm.id} currentStage={pipelineStage} />
      </div>

      {/* Fit score breakdown */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold text-bisque-700 mb-3">Investor Fit Score</h2>
        <div className="space-y-2">
          {Object.entries(scoreResult.breakdown).map(([key, factor]) => (
            <div key={key} className="flex items-center gap-3">
              <div className="w-36 text-xs text-bisque-500 shrink-0">{factor.label}</div>
              <div className="flex-1 bg-bisque-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    factor.raw >= 0.7 ? "bg-green-400"
                    : factor.raw >= 0.4 ? "bg-yellow-400"
                    : "bg-bisque-300"
                  }`}
                  style={{ width: `${Math.round(factor.raw * 100)}%` }}
                />
              </div>
              <div className="w-8 text-xs text-bisque-500 tabular-nums text-right">
                {Math.round(factor.raw * 100)}
              </div>
              <div className="w-12 text-xs text-bisque-400 text-right">
                ×{Math.round(factor.weight * 100)}%
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-bisque-50 flex justify-between items-center">
            <span className="text-sm font-semibold text-bisque-700">Total fit score</span>
            <ScoreBadge score={scoreResult.score} />
          </div>
        </div>
      </div>

      {/* People at this firm */}
      {peopleAtOrg.length > 0 && (
        <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-bisque-700 mb-3">
            Partners & Team ({peopleAtOrg.length})
          </h2>
          <div className="space-y-2">
            {peopleAtOrg.map((person: PersonAtOrg) => (
              <Link
                key={person.id}
                href={`/investors/people/${encodeURIComponent(person.id)}`}
                className="flex items-center gap-3 rounded-lg hover:bg-bisque-50 p-2 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {person.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-bisque-900 text-sm">{person.name}</p>
                  {person.role && (
                    <p className="text-xs text-bisque-500">{person.role}</p>
                  )}
                </div>
                <span className="text-bisque-300 text-sm">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio companies */}
      {portfolioEdges.length > 0 && (
        <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-bisque-700 mb-3">
            Portfolio ({portfolioEdges.length})
          </h2>
          <div className="space-y-2">
            {portfolioEdges.map((edge) => (
              <div key={`${edge.target}-${edge.relation}`} className="flex items-center gap-3 p-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-bisque-900 text-sm">{edge.targetName || edge.target}</p>
                  <p className="text-xs text-bisque-400 capitalize">{edge.relation.replace(/_/g, " ")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {firm.tags.length > 0 && (
        <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-bisque-700 mb-2">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {firm.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded-full text-xs bg-bisque-100 text-bisque-600"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Enrich */}
      <div className="mb-4">
        <EnrichButton contactId={firm.id} />
      </div>
    </div>
  );
}
