import Link from "next/link";
import {
  fetchContactsPage,
  fetchKissingerFunnelData,
  searchKissinger,
  classifyOrg,
  INVESTOR_PERSON_TAGS,
} from "@/lib/kissinger";
import type { EntitySummary, SearchHit, ContactSegment, ContactDetail } from "@/lib/kissinger";
import AddNewButton from "@/components/AddNewButton";
import ContactCard from "@/components/ContactCard";
import { scoreProspect } from "@/lib/score-prospect";
import type { ProspectScoreResult } from "@/lib/score-prospect";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a meta value from an EntitySummary's inline meta array. */
function getMeta(entity: EntitySummary, key: string): string | undefined {
  return entity.meta?.find((m) => m.key === key)?.value;
}

/** Extract a meta value from a ContactDetail map (legacy — kept for search path). */
function getMetaFromMap(
  details: Map<string, ContactDetail> | undefined,
  id: string,
  key: string
): string | undefined {
  return details?.get(id)?.meta.find((m) => m.key === key)?.value;
}

const PAGE_SIZE = 50;

interface ContactsPageProps {
  searchParams: Promise<{
    segment?: string;
    q?: string;
    after?: string;
    sortBy?: string;
    /** Prospect-specific filters */
    vertical?: string;
    stage?: string;
  }>;
}

// ---------------------------------------------------------------------------
// ICP scoring helpers for prospects
// ---------------------------------------------------------------------------

/** Compute an ICP score for a prospect EntitySummary. */
function computeProspectScore(entity: EntitySummary): ProspectScoreResult {
  return scoreProspect({
    id: entity.id,
    name: entity.name,
    kind: entity.kind,
    tags: entity.tags,
    notes: entity.notes ?? "",
    meta: entity.meta ?? [],
    edges: [],
    people: [],
  });
}

/** Compute ICP scores for all prospects, returning a Map<id, ProspectScoreResult>. */
function computeProspectScores(contacts: EntitySummary[]): Map<string, ProspectScoreResult> {
  const map = new Map<string, ProspectScoreResult>();
  for (const c of contacts) {
    map.set(c.id, computeProspectScore(c));
  }
  return map;
}

// Vertical tag groups for the filter dropdown
const VERTICAL_FILTER_OPTIONS: { value: string; label: string; tags: string[] }[] = [
  { value: "aerospace-defense", label: "Aerospace & Defense", tags: ["aerospace", "defense", "aerospace-defense"] },
  { value: "heavy-equipment", label: "Heavy Equipment", tags: ["heavy-equipment", "heavy_equipment"] },
  { value: "contract-manufacturing", label: "Contract Manufacturing", tags: ["contract-manufacturing", "contract_manufacturing"] },
  { value: "capital-goods", label: "Capital Goods", tags: ["capital-goods", "capital_goods"] },
  { value: "rail", label: "Rail", tags: ["rail", "railroad", "railway"] },
  { value: "chemicals", label: "Chemicals", tags: ["chemicals", "chemical"] },
  { value: "manufacturing", label: "General Manufacturing", tags: ["manufacturing"] },
  { value: "industrial", label: "Industrial", tags: ["industrial"] },
];

// Pipeline stage tag options
const STAGE_FILTER_OPTIONS: { value: string; label: string; tag: string }[] = [
  { value: "research", label: "Research", tag: "research" },
  { value: "contacted", label: "Contacted", tag: "contacted" },
  { value: "engaged", label: "Engaged", tag: "engaged" },
  { value: "qualified", label: "Qualified", tag: "qualified" },
];

function isValidSegment(v: string | undefined): v is ContactSegment {
  return ["all", "people", "vc", "prospects", "other-orgs"].includes(v ?? "");
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const params = await searchParams;
  const segment: ContactSegment = isValidSegment(params.segment)
    ? params.segment
    : "people";
  const q = params.q?.trim() ?? "";
  const isSearch = q.length > 0;
  const afterCursor = params.after ?? undefined;
  const sortBy = params.sortBy === "score" ? "score" : "default";
  // Prospect-specific filter params
  const verticalFilter = params.vertical ?? "";
  const stageFilter = params.stage ?? "";

  // -------------------------------------------------------------------------
  // Fetch data — paginated or search
  // -------------------------------------------------------------------------
  let contacts: EntitySummary[] = [];
  let hasNextPage = false;
  let endCursor: string | null = null;
  let hasPreviousPage = false;
  let offline = false;
  let searchHits: SearchHit[] = [];

  // Tab counts from graphStats (fast — 1 request)
  let tabCounts: Record<ContactSegment, number> = {
    people: 0,
    vc: 0,
    prospects: 0,
    "other-orgs": 0,
    all: 0,
  };

  if (isSearch) {
    const hits = await searchKissinger(q, 200);
    searchHits = hits;
    const entityHits = hits.filter((h) => h.__typename === "EntitySearchHitGql");
    const mapped: EntitySummary[] = entityHits.map((h) => ({
      id: h.id,
      kind: h.kind ?? "unknown",
      name: h.name ?? h.id,
      tags: h.tags ?? [],
      updatedAt: "",
      archived: false,
    }));

    // Filter to segment
    const people = mapped.filter(
      (e) => e.kind === "person" && !e.tags.some((t) => INVESTOR_PERSON_TAGS.has(t))
    );
    const allOrgs = mapped.filter((e) => e.kind === "org");
    const vc: EntitySummary[] = [];
    const prospects: EntitySummary[] = [];
    const otherOrgs: EntitySummary[] = [];
    for (const org of allOrgs) {
      const seg = classifyOrg(org.tags);
      if (seg === "vc") vc.push(org);
      else if (seg === "prospects") prospects.push(org);
      else otherOrgs.push(org);
    }

    tabCounts = {
      people: people.length,
      vc: vc.length,
      prospects: prospects.length,
      "other-orgs": otherOrgs.length,
      all: mapped.length,
    };

    const segMap: Record<ContactSegment, EntitySummary[]> = {
      people,
      vc,
      prospects,
      "other-orgs": otherOrgs,
      all: mapped,
    };
    contacts = segMap[segment];
    void searchHits;
  } else {
    // Fetch tab counts from graphStats (1 fast query)
    const funnelData = await fetchKissingerFunnelData();
    if (!funnelData) {
      offline = true;
    } else {
      const personCount = funnelData.stats.entitiesByKind["person"] ?? 0;
      const orgCount = funnelData.stats.entitiesByKind["org"] ?? 0;
      // We don't know exact vc/prospects/other-orgs split without fetching all orgs.
      // Show person count for People tab, org count for sub-tabs (approximation).
      tabCounts = {
        people: personCount,
        vc: 0, // unknown without full fetch
        prospects: 0, // unknown without full fetch
        "other-orgs": orgCount, // approximate: all orgs shown here initially
        all: personCount + orgCount,
      };
    }

    if (!offline) {
      // Determine which kind to fetch
      const kind = segment === "people" ? "person" : "org";

      if (segment === "all") {
        // Fetch both kinds in parallel, interleave results
        const [peoplePage, orgsPage] = await Promise.all([
          fetchContactsPage("person", Math.ceil(PAGE_SIZE / 2), afterCursor),
          fetchContactsPage("org", Math.floor(PAGE_SIZE / 2), afterCursor),
        ]);
        if (!peoplePage && !orgsPage) {
          offline = true;
        } else {
          // Filter investor people out of contacts page
          const filteredPeople = (peoplePage?.contacts ?? []).filter(
            (p) => !p.tags.some((t) => INVESTOR_PERSON_TAGS.has(t))
          );
          contacts = [...filteredPeople, ...(orgsPage?.contacts ?? [])];
          // Sort alphabetically
          contacts.sort((a, b) => a.name.localeCompare(b.name));
          hasNextPage = (peoplePage?.hasNextPage ?? false) || (orgsPage?.hasNextPage ?? false);
          endCursor = peoplePage?.endCursor ?? orgsPage?.endCursor ?? null;
          hasPreviousPage = !!afterCursor;
        }
      } else {
        const page = await fetchContactsPage(kind, PAGE_SIZE, afterCursor);
        if (!page) {
          offline = true;
        } else {
          let raw = page.contacts;

          // Apply segment filter for org sub-segments
          if (segment === "vc") {
            raw = raw.filter((e) => classifyOrg(e.tags) === "vc");
          } else if (segment === "prospects") {
            raw = raw.filter((e) => classifyOrg(e.tags) === "prospects");
          } else if (segment === "other-orgs") {
            raw = raw.filter((e) => classifyOrg(e.tags) === "other-orgs");
          } else if (segment === "people") {
            // Exclude investor-tagged people
            raw = raw.filter((p) => !p.tags.some((t) => INVESTOR_PERSON_TAGS.has(t)));
          }

          contacts = raw;
          hasNextPage = page.hasNextPage;
          endCursor = page.endCursor;
          hasPreviousPage = !!afterCursor;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Prospect-specific: compute ICP scores, apply vertical/stage filters, sort
  // ---------------------------------------------------------------------------
  let prospectScores = new Map<string, ProspectScoreResult>();
  let prospectQuickStats = { total: 0, classified: 0, withSupplyChainData: 0 };

  if (segment === "prospects" && !offline) {
    // Compute ICP scores for all loaded prospects
    prospectScores = computeProspectScores(contacts);

    // Apply vertical filter (client-side on current page)
    if (verticalFilter) {
      const option = VERTICAL_FILTER_OPTIONS.find((o) => o.value === verticalFilter);
      if (option) {
        contacts = contacts.filter((c) =>
          option.tags.some((tag) => c.tags.includes(tag)) ||
          (c.meta ?? []).some((m) => m.key === "industry" && option.tags.some((t) =>
            m.value.toLowerCase().includes(t.replace(/-/g, " "))
          ))
        );
      }
    }

    // Apply stage filter
    if (stageFilter) {
      contacts = contacts.filter((c) => c.tags.includes(stageFilter));
    }

    // Sort by ICP score (descending)
    if (sortBy === "score") {
      contacts = [...contacts].sort((a, b) => {
        const sa = prospectScores.get(a.id)?.icp_score ?? 0;
        const sb = prospectScores.get(b.id)?.icp_score ?? 0;
        return sb - sa;
      });
    }

    // Quick stats (computed before filters to show totals for full page)
    const allLoaded = contacts;
    prospectQuickStats = {
      total: allLoaded.length,
      classified: allLoaded.filter((c) => {
        const industry = (c.meta ?? []).find((m) => m.key === "industry")?.value ?? "";
        const hasTier = VERTICAL_FILTER_OPTIONS.some((opt) =>
          opt.tags.some((t) => c.tags.includes(t)) ||
          (industry && opt.tags.some((tag) => industry.toLowerCase().includes(tag.replace(/-/g, " "))))
        );
        return hasTier;
      }).length,
      withSupplyChainData: allLoaded.filter((c) => {
        const suppliers = parseInt((c.meta ?? []).find((m) => m.key === "known_suppliers")?.value ?? "0", 10);
        const customers = parseInt((c.meta ?? []).find((m) => m.key === "known_customers")?.value ?? "0", 10);
        return suppliers + customers > 0;
      }).length,
    };
  }

  const totalCount = contacts.length;

  const tabs: { key: ContactSegment; label: string; count: number | null }[] = [
    { key: "people", label: "People", count: tabCounts.people || null },
    { key: "vc", label: "VC Firms", count: null },
    { key: "prospects", label: "Prospects", count: null },
    { key: "other-orgs", label: "Other Orgs", count: null },
    { key: "all", label: "All", count: tabCounts.all || null },
  ];

  // Build next/prev cursor URLs
  const nextHref =
    hasNextPage && endCursor
      ? buildCursorUrl(segment, q, endCursor, sortBy, verticalFilter, stageFilter)
      : null;
  const prevHref = hasPreviousPage
    ? buildCursorUrl(segment, q, undefined, sortBy, verticalFilter, stageFilter)
    : null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-bisque-900">Contacts</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-bisque-600">
            {offline
              ? "Offline"
              : isSearch
              ? `${totalCount} result${totalCount !== 1 ? "s" : ""}`
              : `${totalCount} shown`}
          </span>
          {!offline && (
            <Link
              href={buildCursorUrl(
                segment,
                q,
                afterCursor,
                sortBy === "score" ? undefined : "score",
                verticalFilter,
                stageFilter
              )}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sortBy === "score"
                  ? "bg-bisque-700 text-bisque-50"
                  : "bg-bisque-100 text-bisque-700 hover:bg-bisque-200"
              }`}
              title="Sort by ICP / fit score"
            >
              ★ Score
            </Link>
          )}
          <AddNewButton
            defaultKind={
              segment === "vc" ||
              segment === "prospects" ||
              segment === "other-orgs"
                ? "org"
                : "person"
            }
          />
        </div>
      </div>

      {/* Search bar */}
      <form method="GET" action="/contacts" className="flex gap-2">
        <input type="hidden" name="segment" value={segment} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search all contacts…"
          className="flex-1 px-4 py-2 rounded-lg border border-bisque-200 bg-white text-bisque-900 placeholder-bisque-400 text-sm focus:outline-none focus:ring-2 focus:ring-bisque-400"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-bisque-700 text-bisque-50 rounded-lg text-sm font-medium hover:bg-bisque-600 transition-colors"
        >
          Search
        </button>
        {isSearch && (
          <Link
            href={`/contacts?segment=${segment}`}
            className="px-4 py-2 bg-bisque-100 text-bisque-800 rounded-lg text-sm font-medium hover:bg-bisque-200 transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Segment tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/contacts?segment=${tab.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              segment === tab.key
                ? "bg-bisque-700 text-bisque-50"
                : "bg-bisque-100 text-bisque-800 hover:bg-bisque-200"
            }`}
          >
            {tab.label}
            {!offline && tab.count !== null && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  segment === tab.key
                    ? "bg-bisque-600 text-bisque-100"
                    : "bg-bisque-200 text-bisque-600"
                }`}
              >
                {tab.count.toLocaleString()}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Prospect-specific: vertical filter + stage filter + quick stats */}
      {segment === "prospects" && !offline && (
        <>
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Vertical filter */}
            <form method="GET" action="/contacts" className="contents">
              <input type="hidden" name="segment" value="prospects" />
              {q && <input type="hidden" name="q" value={q} />}
              {sortBy === "score" && <input type="hidden" name="sortBy" value="score" />}
              {stageFilter && <input type="hidden" name="stage" value={stageFilter} />}
              <select
                name="vertical"
                defaultValue={verticalFilter}
                onChange={undefined}
                className="px-3 py-1.5 rounded-lg border border-bisque-200 bg-white text-bisque-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-bisque-400"
                aria-label="Filter by vertical"
              >
                <option value="">All Verticals</option>
                {VERTICAL_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {/* Stage filter */}
              <select
                name="stage"
                defaultValue={stageFilter}
                className="px-3 py-1.5 rounded-lg border border-bisque-200 bg-white text-bisque-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-bisque-400"
                aria-label="Filter by pipeline stage"
              >
                <option value="">All Stages</option>
                {STAGE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1.5 bg-bisque-700 text-bisque-50 rounded-lg text-xs font-medium hover:bg-bisque-600 transition-colors"
              >
                Apply
              </button>
              {(verticalFilter || stageFilter) && (
                <Link
                  href={buildCursorUrl("prospects", q, undefined, sortBy)}
                  className="px-3 py-1.5 bg-bisque-100 text-bisque-700 rounded-lg text-xs font-medium hover:bg-bisque-200 transition-colors"
                >
                  Clear filters
                </Link>
              )}
            </form>
          </div>

          {/* Quick stats bar */}
          <div className="flex flex-wrap gap-3 text-sm text-bisque-600 bg-bisque-50 rounded-xl px-4 py-2.5 border border-bisque-100">
            <span className="font-semibold text-bisque-900">{prospectQuickStats.total}</span>
            <span>prospects</span>
            <span className="text-bisque-300">·</span>
            <span className="font-semibold text-bisque-900">{prospectQuickStats.classified}</span>
            <span>classified</span>
            <span className="text-bisque-300">·</span>
            <span className="font-semibold text-bisque-900">{prospectQuickStats.withSupplyChainData}</span>
            <span>with supply chain data</span>
          </div>
        </>
      )}

      {/* Content */}
      {offline ? (
        <div className="bg-white rounded-xl border border-bisque-100 p-8 text-center text-bisque-600 italic">
          Kissinger is offline or unreachable — contacts unavailable.
        </div>
      ) : contacts.length === 0 ? (
        <div className="bg-white rounded-xl border border-bisque-100 p-8 text-center text-bisque-600 italic">
          {isSearch ? `No results for "${q}".` : "No contacts found."}
        </div>
      ) : (
        <>
          {/* Mobile: card list (hidden on md+) */}
          <div className="md:hidden space-y-2">
            <MobileContactList contacts={contacts} />
          </div>

          {/* Desktop: tables (hidden on mobile) */}
          <div className="hidden md:block">
            {segment === "vc" ? (
              <VCTable contacts={contacts} />
            ) : segment === "prospects" ? (
              <ProspectsTable contacts={contacts} />
            ) : (
              <ContactsTable
                contacts={contacts}
                showKind={segment === "all"}
              />
            )}
          </div>
        </>
      )}

      {/* Cursor-based pagination */}
      {!offline && !isSearch && (hasNextPage || hasPreviousPage) && (
        <CursorPagination prevHref={prevHref} nextHref={nextHref} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL builder for cursor-based pagination
// ---------------------------------------------------------------------------

function buildCursorUrl(
  segment: ContactSegment,
  q: string,
  after?: string,
  sortBy?: string,
  vertical?: string,
  stage?: string
): string {
  const p = new URLSearchParams({ segment });
  if (q) p.set("q", q);
  if (after) p.set("after", after);
  if (sortBy === "score") p.set("sortBy", "score");
  if (vertical) p.set("vertical", vertical);
  if (stage) p.set("stage", stage);
  return `/contacts?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// CursorPagination
// ---------------------------------------------------------------------------

function CursorPagination({
  prevHref,
  nextHref,
}: {
  prevHref: string | null;
  nextHref: string | null;
}) {
  const btnBase = "px-4 py-2 rounded-lg text-sm font-medium transition-colors";
  const btnActive = "bg-bisque-100 text-bisque-800 hover:bg-bisque-200";
  const btnDisabled =
    "bg-bisque-50 text-bisque-300 cursor-not-allowed pointer-events-none";

  return (
    <div className="flex items-center justify-center gap-3 py-2">
      {prevHref ? (
        <Link href={prevHref} className={`${btnBase} ${btnActive}`}>
          ← First page
        </Link>
      ) : (
        <span className={`${btnBase} ${btnDisabled}`}>← First page</span>
      )}
      {nextHref ? (
        <Link href={nextHref} className={`${btnBase} ${btnActive}`}>
          Load more →
        </Link>
      ) : (
        <span className={`${btnBase} ${btnDisabled}`}>Load more →</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MobileContactList — card-based list for mobile viewports
// ---------------------------------------------------------------------------

function MobileContactList({ contacts }: { contacts: EntitySummary[] }) {
  return (
    <>
      {contacts.map((contact) => {
        const company = getMeta(contact, "company");
        const title = getMeta(contact, "title");
        const industry = getMeta(contact, "industry");
        const location = getMeta(contact, "location");
        const displayTitle = title ?? (contact.kind === "org" ? industry : undefined);
        const displayOrg = company ?? (contact.kind === "org" ? location : undefined);
        return (
          <ContactCard
            key={contact.id}
            id={contact.id}
            name={contact.name}
            title={displayTitle}
            org={displayOrg}
            kind={contact.kind}
            tags={contact.tags}
            score={undefined}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Generic contacts table (people / other-orgs / all)
// ---------------------------------------------------------------------------

function ContactsTable({
  contacts,
  showKind,
}: {
  contacts: EntitySummary[];
  showKind?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-bisque-100 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bisque-50 border-b border-bisque-100">
            <th className="text-left px-4 py-3 font-semibold text-bisque-800">
              Name
            </th>
            {showKind && (
              <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden sm:table-cell">
                Type
              </th>
            )}
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden sm:table-cell">
              Organization
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden md:table-cell">
              Title
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden lg:table-cell">
              Tags
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden xl:table-cell">
              Updated
            </th>
            <th className="text-right px-4 py-3 font-semibold text-bisque-800">
              Score
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact, i) => {
            const company = getMeta(contact, "company");
            const title = getMeta(contact, "title");
            const displayTags = contact.tags.filter(
              (t) => !["eloso", "prospect-contact"].includes(t)
            );
            return (
              <tr
                key={contact.id}
                className={`border-b border-bisque-50 hover:bg-bisque-50 transition-colors ${
                  i % 2 === 0 ? "" : "bg-bisque-50/30"
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/contacts/${encodeURIComponent(contact.id)}`}
                    className="font-medium text-bisque-800 hover:text-bisque-600 hover:underline"
                  >
                    {contact.name}
                  </Link>
                  {(company || title) && (
                    <div className="sm:hidden text-xs text-bisque-500 mt-0.5">
                      {[title, company].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </td>
                {showKind && (
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <KindBadge kind={contact.kind} tags={contact.tags} />
                  </td>
                )}
                <td className="px-4 py-3 hidden sm:table-cell text-bisque-700">
                  {company ?? "—"}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-bisque-500 text-xs">
                  {title ?? "—"}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <TagList tags={displayTags} limit={3} />
                </td>
                <td className="px-4 py-3 text-bisque-500 hidden xl:table-cell">
                  {contact.updatedAt ? formatDate(contact.updatedAt) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {/* Score is lazy-loaded client-side (see P1b) */}
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-bisque-50 text-bisque-400 border border-bisque-100"
                    title="Score loads on demand"
                  >
                    —
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VC Firms table — investor CRM view
// ---------------------------------------------------------------------------

const VC_STAGE_TAGS = new Set([
  "seed", "pre-seed", "series-a", "series-b", "series-c", "growth",
  "late-stage", "venture", "corporate-vc", "family-office", "accelerator",
  "company-builder",
]);
const VC_PRIORITY_TAGS = new Set(["priority", "tier-1", "tier-2"]);

function VCTable({ contacts }: { contacts: EntitySummary[] }) {
  const sorted = [...contacts].sort((a, b) => {
    const aPriority = a.tags.some((t) => ["priority", "tier-1"].includes(t)) ? 0 : 1;
    const bPriority = b.tags.some((t) => ["priority", "tier-1"].includes(t)) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="bg-white rounded-xl border border-bisque-100 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bisque-50 border-b border-bisque-100">
            <th className="text-left px-4 py-3 font-semibold text-bisque-800">Firm</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden sm:table-cell">Stage / Type</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden md:table-cell">Focus</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden lg:table-cell">Priority</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((firm, i) => {
            const stageTags = firm.tags.filter((t) => VC_STAGE_TAGS.has(t));
            const priorityTags = firm.tags.filter((t) => VC_PRIORITY_TAGS.has(t));
            const focusTags = firm.tags.filter(
              (t) =>
                !["vc", "investor"].includes(t) &&
                !VC_STAGE_TAGS.has(t) &&
                !VC_PRIORITY_TAGS.has(t)
            );
            return (
              <tr
                key={firm.id}
                className={`border-b border-bisque-50 hover:bg-bisque-50 transition-colors ${
                  i % 2 === 0 ? "" : "bg-bisque-50/30"
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/contacts/${encodeURIComponent(firm.id)}`}
                    className="font-medium text-bisque-800 hover:text-bisque-600 hover:underline"
                  >
                    {firm.name}
                  </Link>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <TagList tags={stageTags} limit={3} color="blue" />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <TagList tags={focusTags} limit={4} />
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <TagList tags={priorityTags} limit={2} color="amber" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prospects table — sales pipeline view
// ---------------------------------------------------------------------------

const FIT_COLORS: Record<string, string> = {
  "fit-high": "bg-green-100 text-green-700",
  "fit-medium": "bg-yellow-100 text-yellow-700",
  "fit-low": "bg-bisque-100 text-bisque-600",
};

function ProspectsTable({ contacts }: { contacts: EntitySummary[] }) {
  const fitOrder = ["fit-high", "fit-medium", "fit-low"];
  const sorted = [...contacts].sort((a, b) => {
    const aFit = fitOrder.findIndex((f) => a.tags.includes(f));
    const bFit = fitOrder.findIndex((f) => b.tags.includes(f));
    const aIdx = aFit === -1 ? 99 : aFit;
    const bIdx = bFit === -1 ? 99 : bFit;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="bg-white rounded-xl border border-bisque-100 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bisque-50 border-b border-bisque-100">
            <th className="text-left px-4 py-3 font-semibold text-bisque-800">Company</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden sm:table-cell">Fit</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden md:table-cell">Industry</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden lg:table-cell">Key Challenge</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden xl:table-cell">Economic Buyer</th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden 2xl:table-cell">HQ</th>
            <th className="text-right px-4 py-3 font-semibold text-bisque-800">Score</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((company, i) => {
            const fitTag = company.tags.find((t) => t.startsWith("fit-"));
            const industry = getMeta(company, "industry");
            const location = getMeta(company, "location");
            const revenue = getMeta(company, "revenue");
            const employees = getMeta(company, "employees");
            const buyerPersona = getMeta(company, "buyer_persona");
            const challengeMatch = company.notes?.match(/Challenge:\s*(.+?)(?:\n|$)/);
            const challenge = challengeMatch?.[1]?.trim();
            return (
              <tr
                key={company.id}
                className={`border-b border-bisque-50 hover:bg-bisque-50 transition-colors ${
                  i % 2 === 0 ? "" : "bg-bisque-50/30"
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/contacts/${encodeURIComponent(company.id)}`}
                    className="font-medium text-bisque-800 hover:text-bisque-600 hover:underline"
                  >
                    {company.name}
                  </Link>
                  {employees && (
                    <div className="text-xs text-bisque-400 mt-0.5">{employees} employees</div>
                  )}
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  {fitTag && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        FIT_COLORS[fitTag] ?? "bg-bisque-100 text-bisque-600"
                      }`}
                    >
                      {fitTag.replace("fit-", "")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-bisque-700 text-xs">
                  {industry ?? "—"}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-bisque-600 text-xs max-w-xs">
                  {challenge ? (
                    <span title={challenge}>
                      {challenge.length > 80 ? challenge.slice(0, 80) + "…" : challenge}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 hidden xl:table-cell text-bisque-500 text-xs">
                  {buyerPersona ?? (revenue ?? "—")}
                </td>
                <td className="px-4 py-3 hidden 2xl:table-cell text-bisque-600 text-xs">
                  {location ?? "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {/* Score is lazy-loaded (P1b) */}
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums bg-bisque-50 text-bisque-400 border border-bisque-100"
                    title="Score loads on demand"
                  >
                    —
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function KindBadge({ kind, tags }: { kind: string; tags: string[] }) {
  let label = kind;
  let cls = "bg-bisque-100 text-bisque-700";
  if (kind === "person") {
    cls = "bg-sky-100 text-sky-700";
    label = "Person";
  } else if (tags.some((t) => ["vc", "investor"].includes(t))) {
    cls = "bg-violet-100 text-violet-700";
    label = "VC";
  } else if (tags.includes("prospect")) {
    cls = "bg-emerald-100 text-emerald-700";
    label = "Prospect";
  } else {
    label = "Org";
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

const TAG_COLOR_CLASSES: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  default: "bg-bisque-100 text-bisque-700",
};

function TagList({
  tags,
  limit = 4,
  color = "default",
}: {
  tags: string[];
  limit?: number;
  color?: "default" | "blue" | "amber";
}) {
  const cls = TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES.default;
  const shown = tags.slice(0, limit);
  const rest = tags.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((tag) => (
        <span key={tag} className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>
          {tag}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-bisque-400 text-xs">+{rest}</span>
      )}
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

// Keep for search path compatibility (not used in paginated path)
void getMetaFromMap;
