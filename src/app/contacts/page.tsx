import Link from "next/link";
import { fetchContactsPage } from "@/lib/kissinger";
import type { EntitySummary } from "@/lib/kissinger";

interface ContactsPageProps {
  searchParams: { after?: string; kind?: string; q?: string };
}

export default async function ContactsPage({ searchParams }: ContactsPageProps) {
  const kind = (searchParams.kind === "org" ? "org" : "person") as
    | "person"
    | "org";
  const after = searchParams.after;
  const PAGE_SIZE = 50;

  const result = await fetchContactsPage(kind, PAGE_SIZE, after);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-bisque-900">Contacts</h1>
        <span className="text-sm text-bisque-600">
          {result ? `${result.contacts.length} shown` : "Offline"}
        </span>
      </div>

      {/* Kind toggle */}
      <div className="flex gap-2">
        <Link
          href="/contacts?kind=person"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            kind === "person"
              ? "bg-bisque-700 text-bisque-50"
              : "bg-bisque-100 text-bisque-800 hover:bg-bisque-200"
          }`}
        >
          People
        </Link>
        <Link
          href="/contacts?kind=org"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            kind === "org"
              ? "bg-bisque-700 text-bisque-50"
              : "bg-bisque-100 text-bisque-800 hover:bg-bisque-200"
          }`}
        >
          Organisations
        </Link>
      </div>

      {result === null ? (
        <div className="bg-white rounded-xl border border-bisque-100 p-8 text-center text-bisque-600 italic">
          Kissinger is offline or unreachable — contacts unavailable.
        </div>
      ) : result.contacts.length === 0 ? (
        <div className="bg-white rounded-xl border border-bisque-100 p-8 text-center text-bisque-600 italic">
          No contacts found.
        </div>
      ) : (
        <>
          <ContactsTable contacts={result.contacts} />

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2">
            <div>
              {result.hasPreviousPage && after && (
                <Link
                  href={`/contacts?kind=${kind}`}
                  className="px-4 py-2 bg-bisque-100 text-bisque-800 rounded-lg text-sm font-medium hover:bg-bisque-200 transition-colors"
                >
                  &larr; First page
                </Link>
              )}
            </div>
            <div>
              {result.hasNextPage && result.endCursor && (
                <Link
                  href={`/contacts?kind=${kind}&after=${encodeURIComponent(result.endCursor)}`}
                  className="px-4 py-2 bg-bisque-700 text-bisque-50 rounded-lg text-sm font-medium hover:bg-bisque-600 transition-colors"
                >
                  Next {PAGE_SIZE} &rarr;
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ContactsTable({ contacts }: { contacts: EntitySummary[] }) {
  return (
    <div className="bg-white rounded-xl border border-bisque-100 overflow-hidden shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bisque-50 border-b border-bisque-100">
            <th className="text-left px-4 py-3 font-semibold text-bisque-800">
              Name
            </th>
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
              <td className="px-4 py-3 hidden sm:table-cell">
                <div className="flex flex-wrap gap-1">
                  {contact.tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-bisque-100 text-bisque-700 rounded-full text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                  {contact.tags.length > 4 && (
                    <span className="text-bisque-400 text-xs">
                      +{contact.tags.length - 4}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-bisque-500 hidden md:table-cell">
                {formatDate(contact.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
