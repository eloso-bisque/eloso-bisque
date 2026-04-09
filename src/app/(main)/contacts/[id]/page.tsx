import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchContactDetail, classifyOrg } from "@/lib/kissinger";
import type { ResolvedEdge, ContactDetail, PersonAtOrg } from "@/lib/kissinger";
import NotesEditor from "@/components/NotesEditor";
import EnrichButton from "@/components/EnrichButton";
import MobileEnrichSection from "@/components/MobileEnrichSection";
import { scoreContact } from "@/lib/score-contact";
import type { ScoreResult, ScoringEdge } from "@/lib/score-contact";
import { scoreProspect } from "@/lib/score-prospect";
import type { ProspectScoreResult } from "@/lib/score-prospect";

// ---------------------------------------------------------------------------
// Server-side score computation using already-fetched contact data
// ---------------------------------------------------------------------------

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

async function gqlFetch<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (KISSINGER_API_TOKEN) headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Kissinger request failed: ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Kissinger errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

const INTERACTIONS_QUERY = `
  query InteractionsForScore($entityId: String!, $first: Int) {
    interactionsForEntity(entityId: $entityId, first: $first) {
      edges { node { id occurredAt } }
    }
  }
`;

const ENTITY_TAGS_QUERY = `
  query EntityTags($id: String!) {
    entity(id: $id) { id tags }
  }
`;

async function fetchContactScore(
  contact: ContactDetail,
  rawEdges: { target: string; relation: string; strength: number }[]
): Promise<ScoreResult> {
  // Fetch interactions and org tags in parallel
  const worksAtEdges = rawEdges.filter((e) => e.relation === "works_at");

  const [interactionsData, orgTagResults] = await Promise.all([
    gqlFetch<{ interactionsForEntity: { edges: { node: { id: string; occurredAt: string } }[] } }>(
      INTERACTIONS_QUERY,
      { entityId: contact.id, first: 1 }
    ).catch(() => ({ interactionsForEntity: { edges: [] } })),

    Promise.allSettled(
      worksAtEdges.map(async (edge) => {
        const data = await gqlFetch<{ entity: { id: string; tags: string[] } }>(
          ENTITY_TAGS_QUERY,
          { id: edge.target }
        );
        return { id: edge.target, tags: data.entity.tags };
      })
    ),
  ]);

  const interactions = interactionsData.interactionsForEntity.edges.map((e) => e.node);
  const mostRecentInteraction =
    interactions.length > 0
      ? interactions.reduce((latest, i) =>
          Date.parse(i.occurredAt) > Date.parse(latest.occurredAt) ? i : latest
        )
      : null;

  const orgTagsMap = new Map<string, string[]>();
  for (const r of orgTagResults) {
    if (r.status === "fulfilled") orgTagsMap.set(r.value.id, r.value.tags);
  }

  const orgTags: string[] = [];
  for (const [, tags] of orgTagsMap) orgTags.push(...tags);

  const scoringEdges: ScoringEdge[] = rawEdges.map((edge) => ({
    relation: edge.relation,
    strength: edge.strength,
    target_tags: orgTagsMap.get(edge.target) ?? [],
  }));

  return scoreContact({
    id: contact.id,
    name: contact.name,
    kind: contact.kind,
    tags: contact.tags,
    notes: contact.notes,
    meta: contact.meta,
    updatedAt: contact.updatedAt,
    last_interaction_at: mostRecentInteraction?.occurredAt,
    edges: scoringEdges,
    org_tags: orgTags,
  });
}

interface ContactDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactDetailPage({
  params,
}: ContactDetailPageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const result = await fetchContactDetail(id);

  if (!result) notFound();

  const { contact, edges, peopleAtOrg } = result;

  // Compute full contact score (with interactions + edge enrichment)
  const scoreResult = await fetchContactScore(
    contact,
    edges.map((e) => ({ target: e.target, relation: e.relation, strength: e.strength }))
  ).catch(() => null);

  // For prospect orgs: also compute ICP score
  const isProspect = contact.kind === "org" && classifyOrg(contact.tags) === "prospects";
  const icpScoreResult: ProspectScoreResult | null = isProspect
    ? scoreProspect({
        id: contact.id,
        name: contact.name,
        kind: contact.kind,
        tags: contact.tags,
        notes: contact.notes,
        meta: contact.meta,
        edges: edges.map((e) => ({ relation: e.relation, strength: e.strength })),
        people: peopleAtOrg.map((p) => ({
          tags: [],
          meta: p.role ? [{ key: "title", value: p.role }] : [],
        })),
      })
    : null;

  // For person: outbound works_at edges point to orgs
  const worksAtEdges = edges.filter((e) => e.relation === "works_at");
  const otherEdges = edges.filter((e) => e.relation !== "works_at");

  // Get job title from meta
  const title = contact.meta.find((m) => m.key === "title")?.value;
  const email = contact.meta.find((m) => m.key === "email")?.value;
  const connectedOn = contact.meta.find((m) => m.key === "connected_on")?.value;
  const company = contact.meta.find((m) => m.key === "company")?.value;

  // Org-specific meta
  const hq = contact.meta.find((m) => m.key === "hq")?.value;
  const revenue = contact.meta.find((m) => m.key === "revenue")?.value;
  const employees = contact.meta.find((m) => m.key === "employees")?.value;

  // Classify org entities for context badges
  const orgClass =
    contact.kind === "org" ? classifyOrg(contact.tags) : null;
  const backHref =
    contact.kind === "person"
      ? "/contacts?segment=people"
      : orgClass === "vc"
      ? "/contacts?segment=vc"
      : orgClass === "prospects"
      ? "/contacts?segment=prospects"
      : "/contacts?segment=other-orgs";

  return (
    <div className="max-w-3xl mx-auto space-y-4 md:space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-bisque-500">
        <Link href={backHref} className="hover:text-bisque-700 hover:underline">
          ← Contacts
        </Link>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-4 md:p-6">
        {/* On mobile: name/info stacked; on desktop: side-by-side with enrich */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl md:text-2xl font-bold text-bisque-900 leading-tight">
              {contact.name}
            </h1>
            {/* Person: show title and org */}
            {contact.kind === "person" && title && (
              <p className="text-bisque-600 mt-1 text-sm font-medium">{title}</p>
            )}
            {contact.kind === "person" && worksAtEdges.length > 0 && (
              <p className="text-bisque-500 text-sm mt-0.5">
                {worksAtEdges.map((e) => (
                  <Link
                    key={e.target}
                    href={`/contacts/${encodeURIComponent(e.target)}`}
                    className="hover:text-bisque-700 hover:underline"
                  >
                    {e.targetName}
                  </Link>
                ))}
              </p>
            )}
            {/* Org: show employee count inline */}
            {contact.kind === "org" && employees && (
              <p className="text-bisque-500 text-sm mt-1">{employees} employees</p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {contact.kind === "person" ? (
                <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full text-xs font-medium">
                  Person
                </span>
              ) : orgClass === "vc" ? (
                <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">
                  VC Firm
                </span>
              ) : orgClass === "prospects" ? (
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                  Prospect
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-bisque-100 text-bisque-700 rounded-full text-xs font-medium capitalize">
                  {contact.kind}
                </span>
              )}
              {contact.archived && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                  Archived
                </span>
              )}
            </div>
          </div>

          {/* Desktop: enrich + timestamps in top-right */}
          <div className="hidden md:flex flex-col items-end gap-2 shrink-0">
            <div className="text-right text-xs text-bisque-400">
              <p>Updated {formatDate(contact.updatedAt)}</p>
              <p className="mt-0.5">Added {formatDate(contact.createdAt)}</p>
            </div>
            <EnrichButton contactId={contact.id} />
          </div>

          {/* Mobile: timestamps below name, inline small */}
          <div className="flex md:hidden text-xs text-bisque-400 gap-4">
            <span>Updated {formatDate(contact.updatedAt)}</span>
            <span>Added {formatDate(contact.createdAt)}</span>
          </div>
        </div>

        {/* Contact details */}
        {(email || connectedOn || hq || revenue) && (
          <div className="mt-4 pt-4 border-t border-bisque-50 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {email && (
              <div>
                <dt className="text-xs text-bisque-400">Email</dt>
                <dd className="text-sm mt-0.5">
                  <a
                    href={`mailto:${email}`}
                    className="text-bisque-600 hover:underline"
                  >
                    {email}
                  </a>
                </dd>
              </div>
            )}
            {connectedOn && (
              <div>
                <dt className="text-xs text-bisque-400">LinkedIn Connected</dt>
                <dd className="text-sm text-bisque-800 mt-0.5">{connectedOn}</dd>
              </div>
            )}
            {hq && (
              <div>
                <dt className="text-xs text-bisque-400">HQ</dt>
                <dd className="text-sm text-bisque-800 mt-0.5">{hq}</dd>
              </div>
            )}
            {revenue && (
              <div>
                <dt className="text-xs text-bisque-400">Revenue (est.)</dt>
                <dd className="text-sm text-bisque-800 mt-0.5">{revenue}</dd>
              </div>
            )}
          </div>
        )}

        {/* Tags */}
        {contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-4 pt-4 border-t border-bisque-50">
            {contact.tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-bisque-100 text-bisque-700 rounded-full text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Notes — editable, saves on blur */}
        <NotesEditor entityId={contact.id} initialNotes={contact.notes ?? ""} />

        {/* Mobile: prominent Enrich button at bottom of header card */}
        <div className="md:hidden mt-4 pt-4 border-t border-bisque-50">
          <MobileEnrichSection contactId={contact.id} />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Score section — Eloso fit score with breakdown                       */}
      {/* ------------------------------------------------------------------ */}
      {scoreResult && <ScoreSection result={scoreResult} />}

      {/* ------------------------------------------------------------------ */}
      {/* ICP Score section — prospect orgs only                              */}
      {/* ------------------------------------------------------------------ */}
      {icpScoreResult && <ICPScoreSection result={icpScoreResult} />}

      {/* ------------------------------------------------------------------ */}
      {/* PERSON VIEW: Organisation section (outbound works_at edges)          */}
      {/* ------------------------------------------------------------------ */}
      {contact.kind === "person" && worksAtEdges.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-bisque-800 mb-3">
            Organisation
          </h2>
          <div className="space-y-2">
            {worksAtEdges.map((edge) => (
              <OrgCard key={edge.target} edge={edge} personTitle={title} personCompany={company} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ORG VIEW: People section (reverse works_at edges via edgesTo)        */}
      {/* ------------------------------------------------------------------ */}
      {contact.kind === "org" && peopleAtOrg.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-bisque-800 mb-3">
            People
            <span className="ml-2 text-sm font-normal text-bisque-500">
              ({peopleAtOrg.length})
            </span>
          </h2>
          <div className="bg-white rounded-xl border border-bisque-100 shadow-sm divide-y divide-bisque-50">
            {peopleAtOrg.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Other connections (non works_at)                                    */}
      {/* ------------------------------------------------------------------ */}
      {otherEdges.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-bisque-800 mb-3">
            Other Connections
          </h2>
          <div className="bg-white rounded-xl border border-bisque-100 shadow-sm divide-y divide-bisque-50">
            {otherEdges.map((edge, i) => (
              <EdgeRow key={i} edge={edge} />
            ))}
          </div>
        </section>
      )}

      {edges.length === 0 && peopleAtOrg.length === 0 && (
        <div className="bg-white rounded-xl border border-bisque-100 p-6 text-center text-bisque-500 italic text-sm">
          No connections recorded.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreSection — Eloso fit score with expandable breakdown
// ---------------------------------------------------------------------------

function ScoreSection({ result }: { result: ScoreResult }) {
  const { score, breakdown } = result;

  let badgeCls: string;
  let label: string;
  if (score >= 70) {
    badgeCls = "bg-green-100 text-green-700 border border-green-200";
    label = "Strong fit";
  } else if (score >= 40) {
    badgeCls = "bg-yellow-100 text-yellow-700 border border-yellow-200";
    label = "Moderate fit";
  } else {
    badgeCls = "bg-red-100 text-red-600 border border-red-200";
    label = "Weak fit";
  }

  const factors = Object.entries(breakdown).sort((a, b) => b[1].weighted - a[1].weighted);

  return (
    <section>
      <details className="group bg-white rounded-xl border border-bisque-100 shadow-sm overflow-hidden">
        <summary className="flex items-center justify-between px-6 py-4 cursor-pointer select-none hover:bg-bisque-50 transition-colors list-none">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-bisque-800">Eloso Fit Score</h2>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold tabular-nums ${badgeCls}`}
            >
              {score}<span className="font-normal text-xs opacity-70">/100</span>
            </span>
            <span className={`text-xs font-medium ${score >= 70 ? "text-green-600" : score >= 40 ? "text-yellow-600" : "text-red-500"}`}>
              {label}
            </span>
          </div>
          <span className="text-bisque-400 text-sm group-open:rotate-180 transition-transform duration-200">
            ▼
          </span>
        </summary>

        {/* Expandable breakdown */}
        <div className="px-6 pb-5 pt-1 border-t border-bisque-50">
          <p className="text-xs text-bisque-500 mb-4 mt-2 italic">
            Why this score? Each factor is scored 0–1, then weighted by importance to Eloso&apos;s ICP.
          </p>

          <div className="space-y-3">
            {factors.map(([key, factor]) => {
              const pct = Math.round(factor.raw * 100);
              const weightPct = Math.round(factor.weight * 100);
              const contribution = Math.round(factor.weighted * 100);
              let barColor: string;
              if (pct >= 70) barColor = "bg-green-400";
              else if (pct >= 40) barColor = "bg-yellow-400";
              else barColor = "bg-bisque-300";

              return (
                <div key={key} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-bisque-700 font-medium">{factor.label}</span>
                    <div className="flex items-center gap-2 text-xs text-bisque-500">
                      <span title="Weight in overall score">{weightPct}% weight</span>
                      <span className="text-bisque-300">·</span>
                      <span title="Points contributed to total score" className="font-semibold text-bisque-700">
                        +{contribution} pts
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-bisque-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-bisque-500 w-9 text-right tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Score total */}
          <div className="mt-4 pt-4 border-t border-bisque-50 flex items-center justify-between text-sm">
            <span className="text-bisque-500 text-xs">
              Score reflects title relevance, seniority, org type, interaction recency, network proximity, and record completeness.
            </span>
            <span className={`font-bold text-lg tabular-nums ${score >= 70 ? "text-green-600" : score >= 40 ? "text-yellow-600" : "text-red-500"}`}>
              {score}
            </span>
          </div>
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// ICPScoreSection — ICP score breakdown for prospect orgs
// ---------------------------------------------------------------------------

function ICPScoreSection({ result }: { result: ProspectScoreResult }) {
  const { icp_score, breakdown } = result;

  let badgeCls: string;
  let label: string;
  if (icp_score >= 70) {
    badgeCls = "bg-green-100 text-green-700 border border-green-200";
    label = "Strong ICP match";
  } else if (icp_score >= 40) {
    badgeCls = "bg-yellow-100 text-yellow-700 border border-yellow-200";
    label = "Moderate ICP match";
  } else {
    badgeCls = "bg-red-100 text-red-600 border border-red-200";
    label = "Weak ICP match";
  }

  const factors = Object.entries(breakdown).sort((a, b) => b[1].weighted - a[1].weighted);

  return (
    <section>
      <details className="group bg-white rounded-xl border border-bisque-100 shadow-sm overflow-hidden">
        <summary className="flex items-center justify-between px-6 py-4 cursor-pointer select-none hover:bg-bisque-50 transition-colors list-none">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-bisque-800">ICP Score</h2>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold tabular-nums ${badgeCls}`}
            >
              {icp_score}<span className="font-normal text-xs opacity-70">/100</span>
            </span>
            <span className={`text-xs font-medium ${icp_score >= 70 ? "text-green-600" : icp_score >= 40 ? "text-yellow-600" : "text-red-500"}`}>
              {label}
            </span>
          </div>
          <span className="text-bisque-400 text-sm group-open:rotate-180 transition-transform duration-200">
            ▼
          </span>
        </summary>

        {/* Expandable breakdown */}
        <div className="px-6 pb-5 pt-1 border-t border-bisque-50">
          <p className="text-xs text-bisque-500 mb-4 mt-2 italic">
            Measures alignment with Eloso&apos;s ideal customer profile: large North American manufacturers ($100M–$5B), aerospace/defense/heavy equipment, CSCO buyer.
          </p>

          <div className="space-y-3">
            {factors.map(([key, factor]) => {
              const pct = Math.round(factor.raw * 100);
              const weightPct = Math.round(factor.weight * 100);
              const contribution = Math.round(factor.weighted * 100);
              let barColor: string;
              if (pct >= 70) barColor = "bg-green-400";
              else if (pct >= 40) barColor = "bg-yellow-400";
              else barColor = "bg-bisque-300";

              return (
                <div key={key} className="text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-bisque-700 font-medium">{factor.label}</span>
                    <div className="flex items-center gap-2 text-xs text-bisque-500">
                      <span title="Weight in overall score">{weightPct}% weight</span>
                      <span className="text-bisque-300">·</span>
                      <span title="Points contributed to total score" className="font-semibold text-bisque-700">
                        +{contribution} pts
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-bisque-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-bisque-500 w-9 text-right tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Score total */}
          <div className="mt-4 pt-4 border-t border-bisque-50 flex items-center justify-between text-sm">
            <span className="text-bisque-500 text-xs">
              Factors: vertical fit, size fit, supply chain complexity, buyer accessibility, warm intro path.
            </span>
            <span className={`font-bold text-lg tabular-nums ${icp_score >= 70 ? "text-green-600" : icp_score >= 40 ? "text-yellow-600" : "text-red-500"}`}>
              {icp_score}
            </span>
          </div>
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// OrgCard — shown on a person's page under "Organisation"
// ---------------------------------------------------------------------------

function OrgCard({
  edge,
  personTitle,
  personCompany,
}: {
  edge: ResolvedEdge;
  personTitle?: string;
  personCompany?: string;
}) {
  // Role: prefer meta title, else parse from edge notes
  const roleFromNotes = (() => {
    if (edge.notes) {
      const atIdx = edge.notes.lastIndexOf(" at ");
      if (atIdx > 0) return edge.notes.slice(0, atIdx);
      return edge.notes;
    }
    return "";
  })();
  const role = personTitle || roleFromNotes;

  return (
    <Link
      href={`/contacts/${encodeURIComponent(edge.target)}`}
      className="block bg-white rounded-xl border border-bisque-100 shadow-sm p-4 hover:border-bisque-300 hover:shadow transition-all"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-bisque-800 text-base leading-tight">
            {edge.targetName}
          </p>
          {role && (
            <p className="text-bisque-500 text-sm mt-0.5">{role}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-bisque-400 capitalize">
            {edge.relation.replace(/_/g, " ")}
          </span>
          {edge.strength > 0 && <StrengthPip strength={edge.strength} />}
          <span className="text-bisque-300 text-sm">→</span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// PersonRow — shown on an org's page under "People"
// ---------------------------------------------------------------------------

function PersonRow({ person }: { person: PersonAtOrg }) {
  return (
    <Link
      href={`/contacts/${encodeURIComponent(person.id)}`}
      className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-bisque-50 transition-colors"
    >
      <div className="min-w-0">
        <p className="font-medium text-bisque-800 text-sm">{person.name}</p>
        {person.role && (
          <p className="text-xs text-bisque-500 mt-0.5">{person.role}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {person.strength > 0 && <StrengthPip strength={person.strength} />}
        <span className="text-bisque-300 text-sm">→</span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Generic edge row (for non-works_at connections)
// ---------------------------------------------------------------------------

function EdgeRow({ edge }: { edge: ResolvedEdge }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Link
          href={`/contacts/${encodeURIComponent(edge.target)}`}
          className="font-medium text-bisque-800 hover:text-bisque-600 hover:underline text-sm truncate block"
        >
          {edge.targetName}
        </Link>
        <p className="text-xs text-bisque-400 capitalize mt-0.5">
          {edge.relation.replace(/_/g, " ")}
          {edge.notes ? ` — ${edge.notes}` : ""}
        </p>
      </div>
      {edge.strength > 0 && (
        <div className="shrink-0">
          <StrengthPip strength={edge.strength} />
        </div>
      )}
    </div>
  );
}

function StrengthPip({ strength }: { strength: number }) {
  const pct = Math.min(Math.max(Math.round(strength * 100), 0), 100);
  return (
    <div
      title={`Strength: ${pct}%`}
      className="w-16 h-1.5 bg-bisque-100 rounded-full overflow-hidden"
    >
      <div
        className="h-full bg-bisque-500 rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
