import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchContactDetail } from "@/lib/kissinger";
import type { ResolvedEdge, ContactDetail } from "@/lib/kissinger";

interface ContactDetailPageProps {
  params: { id: string };
}

export default async function ContactDetailPage({
  params,
}: ContactDetailPageProps) {
  const id = decodeURIComponent(params.id);
  const result = await fetchContactDetail(id);

  if (!result) notFound();

  const { contact, edges } = result;

  const worksAtEdges = edges.filter((e) => e.relation === "works_at");
  const otherEdges = edges.filter((e) => e.relation !== "works_at");

  // Get job title from meta
  const title = contact.meta.find((m) => m.key === "title")?.value;
  const email = contact.meta.find((m) => m.key === "email")?.value;
  const connectedOn = contact.meta.find((m) => m.key === "connected_on")?.value;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-bisque-500">
        <Link href="/contacts" className="hover:text-bisque-700 hover:underline">
          Contacts
        </Link>
        <span className="mx-2">/</span>
        <span className="text-bisque-800">{contact.name}</span>
      </nav>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-bisque-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-bisque-900 leading-tight">
              {contact.name}
            </h1>
            {title && (
              <p className="text-bisque-600 mt-1 text-sm">{title}</p>
            )}
            {worksAtEdges.length > 0 && (
              <p className="text-bisque-500 text-sm mt-0.5">
                {worksAtEdges
                  .map((e) => e.targetName)
                  .join(", ")}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="px-2 py-0.5 bg-bisque-100 text-bisque-700 rounded-full text-xs font-medium capitalize">
                {contact.kind}
              </span>
              {contact.archived && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">
                  Archived
                </span>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-bisque-400 shrink-0">
            <p>Updated {formatDate(contact.updatedAt)}</p>
            <p className="mt-0.5">Added {formatDate(contact.createdAt)}</p>
          </div>
        </div>

        {/* Contact details */}
        {(email || connectedOn) && (
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

        {/* Notes */}
        {contact.notes && (
          <div className="mt-4 pt-4 border-t border-bisque-50">
            <h3 className="text-xs font-semibold text-bisque-500 uppercase tracking-wide mb-2">
              Notes
            </h3>
            <p className="text-bisque-800 text-sm whitespace-pre-wrap">
              {contact.notes}
            </p>
          </div>
        )}
      </div>

      {/* Organisation connections */}
      {worksAtEdges.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-bisque-800 mb-3">
            Organisation
          </h2>
          <div className="bg-white rounded-xl border border-bisque-100 shadow-sm divide-y divide-bisque-50">
            {worksAtEdges.map((edge, i) => (
              <EdgeRow key={i} edge={edge} />
            ))}
          </div>
        </section>
      )}

      {/* Other connections */}
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

      {edges.length === 0 && (
        <div className="bg-white rounded-xl border border-bisque-100 p-6 text-center text-bisque-500 italic text-sm">
          No connections recorded.
        </div>
      )}
    </div>
  );
}

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
