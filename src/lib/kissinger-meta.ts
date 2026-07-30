/**
 * Pure helpers for resolving a Kissinger person entity's title/company from
 * its `meta { key value }` list.
 *
 * Single source of truth shared by two independent Kissinger clients:
 *  - src/lib/kissinger.ts (`_fetchProspectContacts`) — the app's live,
 *    Next.js-cached GraphQL read path.
 *  - scripts/backfill/build-plan.ts (`buildContactPlan`) — the one-time (but
 *    re-runnable) Kissinger -> Postgres backfill's pure plan builder.
 *
 * Both need the exact same fallback chain. Before this module existed, the
 * backfill's version only checked the bare `meta.title`/`meta.company`
 * keys — missing the nested-blob and `headline` fallbacks below — which
 * under-counted real title/company signal that the live app already
 * resolves correctly. Extracting the chain here means the two call sites
 * can no longer drift apart.
 */

export type MetaRecord = Record<string, string>;

/**
 * Apollo-re-enriched contacts store title/org inside a JSON blob at meta key
 * `"meta"` rather than as direct top-level meta keys. Parses that blob, or
 * returns `{}` if the key is absent or not valid JSON.
 */
export function parseNestedMeta(meta: MetaRecord): MetaRecord {
  if (!meta["meta"]) return {};
  try {
    return JSON.parse(meta["meta"]) as MetaRecord;
  } catch {
    // not JSON — ignore
    return {};
  }
}

/**
 * Title resolution: direct meta first, then the nested JSON blob.
 * "headline" is used by some LinkedIn-sourced contacts in lieu of "title".
 * Returns "" (never null/undefined) when no signal exists anywhere in the
 * chain — callers that want `null` for "no title" should do
 * `resolveTitleFromMeta(...) || null`.
 */
export function resolveTitleFromMeta(meta: MetaRecord, nestedMeta: MetaRecord): string {
  return meta["title"] ?? nestedMeta["title"] ?? meta["headline"] ?? nestedMeta["headline"] ?? "";
}

/**
 * Company/org resolution from meta alone (before any works_at-edge or org-
 * entity-name fallback, which callers layer on separately). Returns ""
 * (never null/undefined) when no signal exists anywhere in the chain.
 */
export function resolveCompanyFromMeta(meta: MetaRecord, nestedMeta: MetaRecord): string {
  return meta["company"] ?? meta["org"] ?? nestedMeta["org"] ?? nestedMeta["company"] ?? "";
}
