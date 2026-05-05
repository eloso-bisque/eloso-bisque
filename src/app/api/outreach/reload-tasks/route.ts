/**
 * POST /api/outreach/reload-tasks
 *
 * Reloads the "Personalized LinkedIn outreach tasks" list by:
 *   1. Fetching all current prospect-contact-tagged persons
 *   2. Removing "prospect-contact" from those that no longer match criteria
 *   3. Adding "prospect-contact" to eligible candidates up to FILL_TARGET,
 *      prioritising by provenance tier (Tier 1 first, then Tier 2)
 *
 * Eligibility criteria (provenance tiers):
 *   Tier 1 — Tagged "source:human" or "source:csv" (manually added / CSV CRM
 *             imports; personally known contacts — highest trust, surfaces first)
 *   Tier 2 — Tagged "pipeline-contact" (Apollo enrichment + org chart contacts
 *             at curated prospect companies — discovered, not personally known)
 *   AND: US-based (location field resolves to United States via isUSContact)
 *   AND: not tagged "prospect-skipped"
 *
 * Tier 1 contacts are always queued before Tier 2 contacts.
 *
 * The outreach list is not stored separately — it is computed dynamically
 * from the "prospect-contact" tag in Kissinger on every page load.
 *
 * Returns JSON:
 * {
 *   removed: number,       // contacts removed from outreach list
 *   added: number,         // new contacts added
 *   kept: number,          // existing contacts that still qualify
 *   totalAfter: number,    // total prospect-contact count after reload
 * }
 */

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { readFile } from "fs/promises";
import path from "path";
import { fetchAllEntities, isUSContact, type OutreachStage } from "@/lib/kissinger";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

/** Target number of outreach tasks after reload. */
const FILL_TARGET = 100;

/** Prospect criteria file path (written by daily refinement job). */
const CRITERIA_FILE = path.join(
  process.env.HOME ?? "/home/lobster",
  "lobster-workspace/data/prospect-criteria.json"
);

/** Prospect criteria from the daily refinement job. */
interface ProspectCriteria {
  preferred_titles?: string[];
  excluded_titles?: string[];
  preferred_sectors?: string[];
  excluded_sectors?: string[];
  preferred_company_size?: string;
  notes?: string;
}

/** Load prospect criteria from disk. Returns null if file doesn't exist or is malformed. */
async function loadProspectCriteria(): Promise<ProspectCriteria | null> {
  try {
    const raw = await readFile(CRITERIA_FILE, "utf-8");
    return JSON.parse(raw) as ProspectCriteria;
  } catch {
    // File doesn't exist yet or is malformed — ignore
    return null;
  }
}

/** Check if a title matches any of the given keywords (case-insensitive substring). */
function titleMatches(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/** Minimal gql helper (no cache — mutations must bypass Next.js cache). */
async function gqlMutate<T = unknown>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (KISSINGER_API_TOKEN) {
    headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
  }

  const res = await fetch(KISSINGER_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Kissinger request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Kissinger errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

const UPDATE_TAGS_MUTATION = `
  mutation UpdateEntityTags($id: String!, $input: UpdateEntityInput!) {
    updateEntity(id: $id, input: $input) {
      id
      tags
    }
  }
`;

const ENTITY_META_QUERY = `
  query EntityMeta($id: String!) {
    entity(id: $id) {
      id
      meta { key value }
    }
  }
`;

/** Fetch meta for a single entity. Returns empty array on failure. */
async function fetchEntityMeta(id: string): Promise<{ key: string; value: string }[]> {
  try {
    const data = await gqlMutate<{ entity: { id: string; meta: { key: string; value: string }[] } }>(
      ENTITY_META_QUERY,
      { id }
    );
    return data.entity?.meta ?? [];
  } catch {
    return [];
  }
}

/** Patterns matching COO / Chief Operating Officer titles — mirrored from kissinger.ts EXCLUDED_TITLE_PATTERNS. */
const COO_TITLE_PATTERNS = [/\bcoo\b/i, /chief operating officer/i, /chief operations officer/i];

function isCOOTitle(title: string | undefined): boolean {
  if (!title) return false;
  return COO_TITLE_PATTERNS.some((p) => p.test(title));
}

/** Valid outreach stages that indicate the contact has been touched (not cold). */
const NON_COLD_STAGES: OutreachStage[] = ["touched_1", "touched_2", "touched_3", "responded"];

/** Update a person's tags in Kissinger. Replaces the full tags array. */
async function updateEntityTags(id: string, newTags: string[]): Promise<boolean> {
  try {
    await gqlMutate(UPDATE_TAGS_MUTATION, {
      id,
      input: { tags: newTags },
    });
    return true;
  } catch (err) {
    console.error(`[reload-tasks] Failed to update tags for ${id}:`, err);
    return false;
  }
}

const COOKIE_NAME = "eloso_session";

export async function POST(request: Request) {
  // Allow access if EITHER:
  //   1. The request has a valid X-Internal-Secret header (scheduled jobs / Lobster)
  //   2. The request has a browser session cookie (middleware already verified the JWT)
  const internalSecret = process.env.LOBSTER_INTERNAL_SECRET;
  const providedSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall =
    internalSecret && providedSecret && providedSecret === internalSecret;

  // The middleware validates the JWT and only lets requests through if authenticated.
  // We just need to confirm the session cookie is present — its validity is guaranteed
  // by the time any request reaches this handler.
  const cookieHeader = request.headers.get("cookie") ?? "";
  const hasSessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith(`${COOKIE_NAME}=`));

  if (!isInternalCall && !hasSessionCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Load prospect criteria (written by daily refinement job, optional)
    const criteria = await loadProspectCriteria();

    // Fetch all person entities (includes location field for US detection).
    // This is cached at TTL=120s in fetchAllEntities — fine for reads.
    // We pass cache: no-store on mutations only.
    const allPeople = await fetchAllEntities("person");

    // Partition into current outreach contacts and candidates
    const currentOutreach = allPeople.filter((p) => p.tags.includes("prospect-contact"));
    const nonOutreach = allPeople.filter((p) => !p.tags.includes("prospect-contact"));

    // Fetch entity meta for all current outreach contacts so we can check
    // outreach_stage and title. This lets us free up slots occupied by:
    //   (a) contacts already touched/responded (non-cold stage) — these will
    //       never appear in the Active queue anyway, so they waste slots
    //   (b) COO-titled contacts — fetchProspectContacts always excludes them
    //       via isTitleExcluded(), so they permanently waste outreach slots
    const outreachMetaList = await Promise.all(
      currentOutreach.map(async (p) => ({ person: p, meta: await fetchEntityMeta(p.id) }))
    );

    // Helper: returns true if a person qualifies by provenance tier.
    //   Tier 1 — source:human or source:csv
    //   Tier 2 — pipeline-contact
    // AND: US-based AND not tagged prospect-skipped
    const isProvenanceEligible = (person: (typeof allPeople)[number]): boolean => {
      const isTier1 = person.tags.includes("source:human") || person.tags.includes("source:csv");
      const isTier2 = person.tags.includes("pipeline-contact");
      return (isTier1 || isTier2) && isUSContact(person) && !person.tags.includes("prospect-skipped");
    };

    // Determine which current outreach contacts still qualify for the Active queue:
    //   - Provenance eligible (source:human / source:csv / pipeline-contact) AND US-based
    //   - Has outreach_stage == "cold" or not set (not yet touched)
    //   - Does NOT have a COO title (isTitleExcluded would drop them from the page anyway)
    const stillQualify = outreachMetaList
      .filter(({ person, meta }) => {
        if (!isProvenanceEligible(person)) return false;
        const stageMeta = meta.find((m) => m.key === "outreach_stage")?.value ?? "cold";
        const isTouched = (NON_COLD_STAGES as string[]).includes(stageMeta);
        if (isTouched) return false;
        const title = meta.find((m) => m.key === "title")?.value ?? "";
        if (isCOOTitle(title)) return false;
        return true;
      })
      .map(({ person }) => person);

    const noLongerQualify = outreachMetaList
      .filter(({ person, meta }) => {
        if (!isProvenanceEligible(person)) return true;
        const stageMeta = meta.find((m) => m.key === "outreach_stage")?.value ?? "cold";
        if ((NON_COLD_STAGES as string[]).includes(stageMeta)) return true;
        const title = meta.find((m) => m.key === "title")?.value ?? "";
        if (isCOOTitle(title)) return true;
        return false;
      })
      .map(({ person }) => person);

    // Determine eligible candidates to add:
    //   - Provenance eligible: source:human / source:csv (Tier 1) or pipeline-contact (Tier 2)
    //   - US-based AND not tagged prospect-skipped
    //   - Not already in the outreach queue
    let candidates = nonOutreach.filter(isProvenanceEligible);

    // Sort by provenance tier first: Tier 1 (source:human / source:csv) before Tier 2 (pipeline-contact).
    // Within the same tier, order is stable (insertion order from Kissinger).
    candidates.sort((a, b) => {
      const aTier1 = a.tags.includes("source:human") || a.tags.includes("source:csv") ? 0 : 1;
      const bTier1 = b.tags.includes("source:human") || b.tags.includes("source:csv") ? 0 : 1;
      return aTier1 - bTier1;
    });

    // Apply prospect criteria filtering/prioritization if available
    if (criteria) {
      const excludedTitles = criteria.excluded_titles ?? [];
      const preferredTitles = criteria.preferred_titles ?? [];
      const excludedSectors = criteria.excluded_sectors ?? [];
      const preferredSectors = criteria.preferred_sectors ?? [];

      // Filter: skip excluded titles
      if (excludedTitles.length > 0) {
        candidates = candidates.filter((p) => {
          const title = p.meta?.find((m) => m.key === "title")?.value ?? "";
          return !titleMatches(title, excludedTitles);
        });
      }

      // Filter: skip excluded sectors (via person tags)
      if (excludedSectors.length > 0) {
        candidates = candidates.filter((p) => {
          const personTags = p.tags.map((t) => t.toLowerCase());
          return !excludedSectors.some((s) =>
            personTags.includes(s.toLowerCase())
          );
        });
      }

      // Prioritize: preferred titles and sectors go first
      if (preferredTitles.length > 0 || preferredSectors.length > 0) {
        candidates.sort((a, b) => {
          const aTitle = a.meta?.find((m) => m.key === "title")?.value ?? "";
          const bTitle = b.meta?.find((m) => m.key === "title")?.value ?? "";
          const aTags = a.tags.map((t) => t.toLowerCase());
          const bTags = b.tags.map((t) => t.toLowerCase());

          const aPreferred =
            (preferredTitles.length > 0 && titleMatches(aTitle, preferredTitles)) ||
            (preferredSectors.length > 0 &&
              preferredSectors.some((s) => aTags.includes(s.toLowerCase())));
          const bPreferred =
            (preferredTitles.length > 0 && titleMatches(bTitle, preferredTitles)) ||
            (preferredSectors.length > 0 &&
              preferredSectors.some((s) => bTags.includes(s.toLowerCase())));

          if (aPreferred && !bPreferred) return -1;
          if (!aPreferred && bPreferred) return 1;
          return 0;
        });
      }
    }

    // How many slots to fill
    const currentKept = stillQualify.length;
    const slotsToFill = Math.max(0, FILL_TARGET - currentKept);
    const toAdd = candidates.slice(0, slotsToFill);

    // --- Remove prospect-contact from those that no longer qualify ---
    const removeResults = await Promise.allSettled(
      noLongerQualify.map((p) => {
        const newTags = p.tags.filter((t) => t !== "prospect-contact");
        return updateEntityTags(p.id, newTags);
      })
    );
    const removedCount = removeResults.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;

    // --- Add prospect-contact to eligible candidates ---
    const addResults = await Promise.allSettled(
      toAdd.map((p) => {
        const newTags = [...p.tags, "prospect-contact"];
        return updateEntityTags(p.id, newTags);
      })
    );
    const addedCount = addResults.filter(
      (r) => r.status === "fulfilled" && r.value === true
    ).length;

    // Bust the contacts cache so the outreach page reloads fresh data
    revalidateTag("contacts");

    return NextResponse.json({
      removed: removedCount,
      added: addedCount,
      kept: currentKept,
      totalAfter: currentKept + addedCount,
    });
  } catch (err) {
    console.error("[reload-tasks] Error:", err);
    return NextResponse.json(
      { error: "Failed to reload outreach tasks. Check server logs." },
      { status: 500 }
    );
  }
}
