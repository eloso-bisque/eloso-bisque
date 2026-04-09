/**
 * /investors/people/[id] — Investor person detail page (BIS-329)
 *
 * Header: name, title, firm (linked)
 * Incentive analysis: meta.incentive + role-based inference
 * Connection path: warm_intro_path meta field
 * LinkedIn outreach copy
 * Investor fit score breakdown
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchInvestorPersonDetail } from "@/lib/kissinger";
import EnrichButton from "@/components/EnrichButton";
import { scoreInvestor } from "@/lib/score-contact";

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
// Role-based incentive inference
// ---------------------------------------------------------------------------

function inferIncentive(title: string, existingIncentive: string): string {
  if (existingIncentive) return existingIncentive;

  const t = title.toLowerCase();
  if (t.includes("general partner") || t.includes("gp")) {
    return "Portfolio construction, LP relationships, firm reputation, carry";
  }
  if (t.includes("managing director") || t.includes("md")) {
    return "Deal flow quality, sector authority, portfolio returns";
  }
  if (t.includes("partner")) {
    return "Deal sourcing, portfolio company success, carry";
  }
  if (t.includes("principal") || t.includes("vice president")) {
    return "Deal origination, sector expertise development, path to partnership";
  }
  if (t.includes("associate") || t.includes("analyst")) {
    return "Deal support, market analysis, building track record for promotion";
  }
  if (t.includes("founder") || t.includes("co-founder")) {
    return "Portfolio construction, mission alignment, long-term returns";
  }
  return "Investment returns, LP relationships, deal flow";
}

// ---------------------------------------------------------------------------
// LinkedIn outreach copy generator
// ---------------------------------------------------------------------------

function generateLinkedInOutreach(
  personName: string,
  firmName: string,
  title: string
): string {
  const firstName = personName.split(" ")[0];
  return `Hi ${firstName},

I'm the founder of Eloso, an AI-native supply chain optimization platform. We help manufacturers reduce excess inventory by 15–30% using real-time demand signals and supplier visibility.

I noticed ${firmName} has backed companies in the supply chain / industrial space — it seems like a natural fit. I'd love to share what we're building and hear your perspective on the market.

Would you be open to a quick 15-minute call?

Best,
[Your name]`;
}

// ---------------------------------------------------------------------------
// Copy button (client-side copy)
// ---------------------------------------------------------------------------

import CopyButton from "./CopyButton";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PersonDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonDetailPage({ params }: PersonDetailPageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const result = await fetchInvestorPersonDetail(id);

  if (!result) notFound();

  const { contact: person, edges } = result;

  // Meta extraction
  const title = metaVal(person.meta, "title");
  const orgName = metaVal(person.meta, "org") || metaVal(person.meta, "company");
  const existingIncentive = metaVal(person.meta, "incentive");
  const warmIntroPath = metaVal(person.meta, "warm_intro_path");
  const linkedinUrl = metaVal(person.meta, "linkedin_url") || metaVal(person.meta, "linkedin");
  const priority = metaVal(person.meta, "priority");
  const source = metaVal(person.meta, "source");

  // Infer incentive
  const incentive = inferIncentive(title, existingIncentive);

  // Works at edge → link to firm detail
  const worksAtEdge = edges.find((e) => e.relation === "works_at");
  const firmId = worksAtEdge?.target;
  const firmName = worksAtEdge?.targetName || orgName;

  // Compute investor fit score
  const scoreResult = scoreInvestor({
    id: person.id,
    name: person.name,
    kind: person.kind,
    tags: person.tags,
    notes: person.notes,
    meta: person.meta,
    updatedAt: person.updatedAt,
    edges: [],
    isInvestor: true,
  });

  // Generate LinkedIn outreach
  const outreachCopy = generateLinkedInOutreach(person.name, firmName || "your firm", title);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back */}
      <Link
        href="/investors?tab=people"
        className="inline-flex items-center gap-1 text-sm text-bisque-500 hover:text-bisque-700 mb-4"
      >
        ← Investors / People
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
            {person.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-bisque-900">{person.name}</h1>
            {title && (
              <p className="text-bisque-600 text-sm mt-0.5">{title}</p>
            )}
            {firmName && (
              <p className="text-bisque-500 text-sm mt-0.5">
                {firmId ? (
                  <Link
                    href={`/investors/firms/${encodeURIComponent(firmId)}`}
                    className="text-emerald-700 hover:underline"
                  >
                    {firmName}
                  </Link>
                ) : (
                  firmName
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2 py-0.5 font-medium">
                VC Partner
              </span>
              {priority && (
                <span className={`text-xs rounded-full px-2 py-0.5 font-medium border ${
                  priority === "high" ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-bisque-50 text-bisque-600 border-bisque-200"
                }`}>
                  {priority} priority
                </span>
              )}
              <ScoreBadge score={scoreResult.score} />
            </div>
          </div>
        </div>

        {/* LinkedIn */}
        {linkedinUrl && (
          <div className="mt-4 pt-4 border-t border-bisque-50">
            <a
              href={linkedinUrl.startsWith("http") ? linkedinUrl : `https://${linkedinUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
              LinkedIn Profile
            </a>
          </div>
        )}

        {/* Notes */}
        {person.notes && (
          <div className="mt-4 pt-4 border-t border-bisque-50">
            <p className="text-xs font-medium text-bisque-400 mb-1">Notes</p>
            <p className="text-sm text-bisque-700 leading-relaxed">{person.notes}</p>
          </div>
        )}
      </div>

      {/* Incentive analysis */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold text-bisque-700 mb-3">Incentive Analysis</h2>
        <p className="text-sm text-bisque-700 leading-relaxed">{incentive}</p>
        {title && (
          <p className="text-xs text-bisque-400 mt-2">
            Inferred from role: <span className="font-medium">{title}</span>
          </p>
        )}
      </div>

      {/* Connection path */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold text-bisque-700 mb-3">Connection Path</h2>
        {warmIntroPath ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm text-green-800">{warmIntroPath}</p>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-700">
              No warm intro path recorded. Consider cold outreach or finding a mutual connection.
            </p>
          </div>
        )}
      </div>

      {/* Investor fit score */}
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

      {/* LinkedIn outreach copy */}
      <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-bisque-700">LinkedIn Outreach</h2>
          <CopyButton text={outreachCopy} />
        </div>
        <pre className="text-sm text-bisque-700 whitespace-pre-wrap font-sans leading-relaxed bg-bisque-50 rounded-lg p-3 border border-bisque-100">
          {outreachCopy}
        </pre>
        {linkedinUrl && (
          <a
            href={linkedinUrl.startsWith("http") ? linkedinUrl : `https://${linkedinUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-xs text-blue-600 hover:underline"
          >
            Open LinkedIn profile →
          </a>
        )}
      </div>

      {/* Tags */}
      {person.tags.length > 0 && (
        <div className="bg-white rounded-2xl border border-bisque-100 shadow-sm p-4 mb-4">
          <h2 className="text-sm font-semibold text-bisque-700 mb-2">Tags</h2>
          <div className="flex flex-wrap gap-2">
            {person.tags.map((tag) => (
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
        <EnrichButton contactId={person.id} />
      </div>
    </div>
  );
}
