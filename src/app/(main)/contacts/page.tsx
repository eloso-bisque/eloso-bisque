import Link from "next/link";
import { fetchSegmentedContacts, searchKissinger } from "@/lib/kissinger";
import type { EntitySummary, SearchHit, ContactSegment, ContactDetail } from "@/lib/kissinger";

interface ContactsPageProps {
  searchParams: Promise<{ segment?: string; q?: string }>;
}

// Stage / check-size tags surfaced in the VC CRM view
const VC_STAGE_TAGS = new Set([
  "seed", "pre-seed", "series-a", "series-b", "series-c", "growth",
  "late-stage", "venture", "corporate-vc", "family-office", "accelerator",
  "company-builder",
]);
const VC_PRIORITY_TAGS = new Set(["priority", "tier-1", "tier-2"]);

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

  // -------------------------------------------------------------------------
  // Fetch data
  // -------------------------------------------------------------------------
  let people: EntitySummary[] = [];
  let vc: EntitySummary[] = [];
  let prospects: EntitySummary[] = [];
  let otherOrgs: EntitySummary[] = [];
  let prospectDetails: Map<string, ContactDetail> = new Map();
  let offline = false;
  let searchHits: SearchHit[] = [];

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
    people = mapped.filter((e) => e.kind === "person");
    const allOrgs = mapped.filter((e) => e.kind === "org");
    for (const org of allOrgs) {
      const seg = org.tags.some((t) => ["vc", "investor"].includes(t))
        ? "vc"
        : org.tags.includes("prospect")
        ? "prospect"
        : "other";
      if (seg === "vc") vc.push(org);
      else if (seg === "prospect") prospects.push(org);
      else otherOrgs.push(org);
    }
    void searchHits; // used for total count below
  } else {
    const result = await fetchSegmentedContacts();
    if (!result) {
      offline = true;
    } else {
      people = result.people;
      vc = result.vc;
      prospects = result.prospects;
      otherOrgs = result.otherOrgs;
      prospectDetails = result.prospectDetails;
    }
  }

  // -------------------------------------------------------------------------
  // Pick active list
  // -------------------------------------------------------------------------
  const segmentData: Record<ContactSegment, EntitySummary[]> = {
    all: [...people, ...vc, ...prospects, ...otherOrgs],
    people,
    vc,
    prospects,
    "other-orgs": otherOrgs,
  };
  const activeContacts = segmentData[segment];

  const tabs: { key: ContactSegment; label: string; count: number }[] = [
    { key: "people", label: "People", count: people.length },
    { key: "vc", label: "VC Firms", count: vc.length },
    { key: "prospects", label: "Prospects", count: prospects.length },
    { key: "other-orgs", label: "Other Orgs", count: otherOrgs.length },
    {
      key: "all",
      label: "All",
      count: people.length + vc.length + prospects.length + otherOrgs.length,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-bisque-900">Contacts</h1>
        <span className="text-sm text-bisque-600">
          {offline
            ? "Offline"
            : isSearch
            ? `${activeContacts.length} result${activeContacts.length !== 1 ? "s" : ""}`
            : `${activeContacts.length} shown`}
        </span>
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
            {!offline && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  segment === tab.key
                    ? "bg-bisque-600 text-bisque-100"
                    : "bg-bisque-200 text-bisque-600"
                }`}
              >
                {tab.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* Content */}
      {offline ? (
        <div className="bg-white rounded-xl border border-bisque-100 p-8 text-center text-bisque-600 italic">
          Kissinger is offline or unreachable — contacts unavailable.
        </div>
      ) : activeContacts.length === 0 ? (
        <div className="bg-white rounded-xl border border-bisque-100 p-8 text-center text-bisque-600 italic">
          {isSearch ? `No results for "${q}".` : "No contacts found."}
        </div>
      ) : segment === "vc" ? (
        <VCTable contacts={activeContacts} />
      ) : segment === "prospects" ? (
        <ProspectsTable contacts={activeContacts} details={prospectDetails} />
      ) : (
        <ContactsTable contacts={activeContacts} showKind={segment === "all"} />
      )}
    </div>
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
              Tags
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden md:table-cell">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((contact, i) => (
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
              </td>
              {showKind && (
                <td className="px-4 py-3 hidden sm:table-cell">
                  <KindBadge kind={contact.kind} tags={contact.tags} />
                </td>
              )}
              <td className="px-4 py-3 hidden sm:table-cell">
                <TagList tags={contact.tags} limit={4} />
              </td>
              <td className="px-4 py-3 text-bisque-500 hidden md:table-cell">
                {contact.updatedAt ? formatDate(contact.updatedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VC Firms table — investor CRM view
// ---------------------------------------------------------------------------

function VCTable({ contacts }: { contacts: EntitySummary[] }) {
  // Sort: priority first, then alphabetical
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
            <th className="text-left px-4 py-3 font-semibold text-bisque-800">
              Firm
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden sm:table-cell">
              Stage / Type
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden md:table-cell">
              Focus
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden lg:table-cell">
              Priority
            </th>
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

function ProspectsTable({
  contacts,
  details,
}: {
  contacts: EntitySummary[];
  details?: Map<string, ContactDetail>;
}) {
  // Sort: fit-high first
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
            <th className="text-left px-4 py-3 font-semibold text-bisque-800">
              Company
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden sm:table-cell">
              Fit
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden md:table-cell">
              Sector
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden lg:table-cell">
              HQ
            </th>
            <th className="text-left px-4 py-3 font-semibold text-bisque-800 hidden xl:table-cell">
              Revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((company, i) => {
            const fitTag = company.tags.find((t) => t.startsWith("fit-"));
            const sectorTags = company.tags.filter(
              (t) =>
                !["prospect", "eloso"].includes(t) &&
                !t.startsWith("fit-")
            );
            const detail = details?.get(company.id);
            const hq = detail?.meta.find((m) => m.key === "hq")?.value;
            const revenue = detail?.meta.find((m) => m.key === "revenue")?.value;
            const employees = detail?.meta.find((m) => m.key === "employees")?.value;
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
                <td className="px-4 py-3 hidden md:table-cell">
                  <TagList tags={sectorTags} limit={3} />
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-bisque-600">
                  {hq ?? "—"}
                </td>
                <td className="px-4 py-3 hidden xl:table-cell text-bisque-600">
                  {revenue ?? "—"}
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
