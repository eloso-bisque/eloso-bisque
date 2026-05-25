/**
 * POST /api/outreach/new-batch
 *
 * User-scoped prospect queue refill.
 *
 * Picks up to BATCH_SIZE cold prospects from the global pool (entities tagged
 * "prospect-contact" is NOT required — these are untagged cold candidates) and
 * assigns them to the requesting user's queue.
 *
 * Algorithm:
 *   1. Verify auth (session cookie or internal secret)
 *   2. Determine assignee from the session cookie (drew/ben/jake)
 *   3. Fetch ALL cold person entities NOT tagged "queue:*" (the global pool)
 *   4. Filter out: prospect-skipped, outreach-sent, COO titles, non-US (for Tier 2),
 *      and for Ben: contacts without "supply" or "procurement" in their title
 *   5. Score by sector affinity (contacts matching this user's SECTOR_PREFERENCE go first)
 *   6. Pick top BATCH_SIZE candidates
 *   7. Add "prospect-contact" + "queue:<assignee>" tags via Kissinger mutation
 *   8. Fire-and-forget: call /api/outreach/bulk-generate for the new IDs
 *   9. Bust "contacts" cache
 *  10. Return { added, entityIds }
 *
 * Returns JSON:
 * {
 *   added: number,        // contacts added to the user's queue
 *   entityIds: string[],  // Kissinger entity IDs added
 * }
 */

import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { readFile } from "fs/promises";
import path from "path";
import {
  fetchAllEntities,
  isUSContact,
  type EntitySummary,
} from "@/lib/kissinger";
import { verifyToken } from "@/lib/auth";

const KISSINGER_API_URL =
  process.env.KISSINGER_API_URL ?? "http://localhost:8080/graphql";
const KISSINGER_API_TOKEN = process.env.KISSINGER_API_TOKEN ?? "";

/** How many new contacts to add per "New Batch" press. */
const BATCH_SIZE = 12;

const COOKIE_NAME = "eloso_session";

/** Map from login email to lowercase team member name. */
const EMAIL_TO_ASSIGNEE: Record<string, string> = {
  "drew@eloso.ai": "drew",
  "ben@eloso.ai": "ben",
  "jake@eloso.ai": "jake",
};

/** Prospect criteria file written by the daily refinement job. */
const CRITERIA_FILE = path.join(
  process.env.HOME ?? "/home/lobster",
  "lobster-workspace/data/prospect-criteria.json"
);

interface ProspectCriteria {
  preferred_titles?: string[];
  excluded_titles?: string[];
  preferred_sectors?: string[];
  excluded_sectors?: string[];
  preferred_company_size?: string;
  notes?: string;
}

async function loadProspectCriteria(): Promise<ProspectCriteria | null> {
  try {
    const raw = await readFile(CRITERIA_FILE, "utf-8");
    return JSON.parse(raw) as ProspectCriteria;
  } catch {
    return null;
  }
}

/** Mirror of SECTOR_PREFERENCE from outreach.ts */
const SECTOR_PREFERENCE: Record<string, string> = {
  // Ben
  "defense": "ben",
  "defense-aerospace": "ben",
  "evtol": "ben",
  "advanced-air-mobility": "ben",
  // Drew
  "machine-vision": "drew",
  "enterprise-tech": "drew",
  "robotics": "drew",
  "ev-battery": "drew",
  "software-manufacturing": "drew",
  "semiconductor": "drew",
  "medtech": "drew",
  // Jake
  "rail-transportation-equipment": "jake",
  "building-products-construction": "jake",
  "industrial-specialty-manufacturing": "jake",
  "fluid-control-water-tech": "jake",
  "specialty-chemicals-materials": "jake",
  "heavy-equipment": "jake",
  "capital-goods": "jake",
  "contract-manufacturing": "jake",
  "aerospace-commercial": "jake",
};

/** Sector tags that belong to a specific user. Returns true if any tag maps to assignee. */
function hasSectorAffinity(tags: string[], assignee: string): boolean {
  return tags.some((t) => SECTOR_PREFERENCE[t] === assignee);
}

const COO_TITLE_PATTERNS = [
  /\bcoo\b/i,
  /chief operating officer/i,
  /chief operations officer/i,
];

function isCOOTitle(title: string | undefined): boolean {
  if (!title) return false;
  return COO_TITLE_PATTERNS.some((p) => p.test(title));
}

// Ben's hard queue filter: only supply/procurement contacts enter queue:ben.
// Applied at queue-add time so no non-supply contacts ever land in his queue.
const SUPPLY_PROCUREMENT_PATTERNS = [/\bsupply\b/i, /\bprocurement\b/i];

function hasSupplyOrProcurementTitle(title: string | undefined): boolean {
  if (!title) return false;
  return SUPPLY_PROCUREMENT_PATTERNS.some((p) => p.test(title));
}

function titleMatches(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

const ENTITY_META_QUERY = `
  query EntityMeta($id: String!) {
    entity(id: $id) {
      id
      meta { key value }
    }
  }
`;

/** Fetch meta fields for a single entity. Returns empty array on failure. */
async function fetchEntityMeta(id: string): Promise<{ key: string; value: string }[]> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (KISSINGER_API_TOKEN) {
      headers["Authorization"] = `Bearer ${KISSINGER_API_TOKEN}`;
    }
    const res = await fetch(KISSINGER_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: ENTITY_META_QUERY, variables: { id } }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { entity: { id: string; meta: { key: string; value: string }[] } };
      errors?: unknown[];
    };
    return json.data?.entity?.meta ?? [];
  } catch {
    return [];
  }
}

/** Minimal GraphQL mutate helper. */
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

/** Add tags to an entity (merges with existing tags). */
async function addTagsToEntity(
  id: string,
  currentTags: string[],
  newTags: string[]
): Promise<boolean> {
  try {
    const merged = Array.from(new Set([...currentTags, ...newTags]));
    await gqlMutate(UPDATE_TAGS_MUTATION, {
      id,
      input: { tags: merged },
    });
    return true;
  } catch (err) {
    console.error(`[new-batch] Failed to update tags for ${id}:`, err);
    return false;
  }
}

export async function POST(request: Request) {
  // Auth: session cookie or internal secret
  const internalSecret = process.env.LOBSTER_INTERNAL_SECRET;
  const providedSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall =
    internalSecret && providedSecret && providedSecret === internalSecret;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieParts = cookieHeader.split(";").map((c) => c.trim());
  const sessionCookieValue = cookieParts
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!isInternalCall && !sessionCookieValue) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Determine the assignee
  let assignee: string;
  if (isInternalCall) {
    // For internal calls, allow passing assignee in body
    try {
      const body = await request.json() as { assignee?: string };
      assignee = (body.assignee ?? "ben").toLowerCase();
    } catch {
      assignee = "ben";
    }
  } else {
    // Decode from JWT session
    if (!sessionCookieValue) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const payload = await verifyToken(sessionCookieValue);
    const email = payload?.email?.toLowerCase() ?? "";
    const mapped = EMAIL_TO_ASSIGNEE[email];
    if (!mapped) {
      return NextResponse.json({ error: "Unknown team member" }, { status: 403 });
    }
    assignee = mapped;
  }

  try {
    const criteria = await loadProspectCriteria();

    // Fetch all person entities
    const allPeople = await fetchAllEntities("person");

    // Global pool: cold entities NOT tagged "queue:*" (not yet assigned to anyone)
    // Also exclude already-tagged "prospect-contact" ones — they're already in someone's queue.
    const globalPool = allPeople.filter((p) => {
      // Must not be in any queue already
      if (p.tags.some((t) => t.startsWith("queue:"))) return false;
      // Must not already be a prospect-contact
      if (p.tags.includes("prospect-contact")) return false;
      // Must not be skipped or already sent
      if (p.tags.includes("prospect-skipped")) return false;
      if (p.tags.includes("outreach-sent")) return false;
      // Must have a valid provenance tier
      const isLinkedIn = p.tags.includes("linkedin");
      const isHumanSource = p.tags.includes("source:human") || isLinkedIn;
      const isTier1 = isHumanSource || p.tags.includes("source:csv");
      const isTier2 = p.tags.includes("pipeline-contact");
      if (!isTier1 && !isTier2) return false;
      // Location filter: Tier 2 must be US; Tier 1 source:human (incl. LinkedIn) bypasses the check
      if (!isHumanSource && !isUSContact(p)) return false;
      return true;
    });

    // Apply excluded sectors from criteria (tag-based — safe to do without meta fetch)
    let candidates = globalPool;
    if (criteria?.excluded_sectors && criteria.excluded_sectors.length > 0) {
      const excludedSectors = criteria.excluded_sectors;
      candidates = candidates.filter((p) => {
        const personTags = p.tags.map((t) => t.toLowerCase());
        return !excludedSectors.some((s) =>
          personTags.includes(s.toLowerCase())
        );
      });
    }

    // Score candidates: sector affinity for this assignee goes first, then Tier 1
    candidates.sort((a, b) => {
      // Primary: sector affinity
      const aAffinity = hasSectorAffinity(a.tags, assignee) ? 0 : 1;
      const bAffinity = hasSectorAffinity(b.tags, assignee) ? 0 : 1;
      if (aAffinity !== bAffinity) return aAffinity - bAffinity;
      // Secondary: Tier 1 (source:human / source:csv) before Tier 2
      const aTier1 =
        a.tags.includes("source:human") || a.tags.includes("source:csv") ? 0 : 1;
      const bTier1 =
        b.tags.includes("source:human") || b.tags.includes("source:csv") ? 0 : 1;
      return aTier1 - bTier1;
    });

    // Fetch meta for a buffer of top candidates so we can apply COO + excluded-title
    // filtering before final selection. The summary query (fetchAllEntities) does NOT
    // include meta fields — p.meta is always undefined there — so we must do a
    // per-entity meta fetch here.
    // For Ben we apply an additional supply/procurement filter, so we need a larger
    // buffer to ensure BATCH_SIZE contacts remain after filtering.
    const FETCH_BUFFER = assignee === "ben" ? BATCH_SIZE * 10 : BATCH_SIZE * 3;
    const candidateBuffer = candidates.slice(0, FETCH_BUFFER);
    const bufferMeta = await Promise.all(
      candidateBuffer.map(async (p) => ({
        person: p,
        meta: await fetchEntityMeta(p.id),
      }))
    );

    const excludedTitles = criteria?.excluded_titles ?? [];
    const filteredCandidates = bufferMeta
      .filter(({ meta }) => {
        const rawTitle = meta.find((m) => m.key === "title")?.value ?? "";
        // Also check nested JSON meta blob (Apollo-enriched contacts store title there)
        let nestedTitle = "";
        const nestedMetaRaw = meta.find((m) => m.key === "meta")?.value;
        if (nestedMetaRaw) {
          try {
            const parsed = JSON.parse(nestedMetaRaw) as Record<string, string>;
            nestedTitle = parsed["title"] ?? parsed["headline"] ?? "";
          } catch {
            // not JSON — ignore
          }
        }
        const title = rawTitle || nestedTitle;
        if (isCOOTitle(title)) return false;
        if (excludedTitles.length > 0 && titleMatches(title, excludedTitles)) return false;
        // Hard filter for Ben: only allow contacts with supply/procurement in their title
        if (assignee === "ben" && !hasSupplyOrProcurementTitle(title)) return false;
        return true;
      })
      .map(({ person }) => person);

    // Pick top BATCH_SIZE
    const toAdd = filteredCandidates.slice(0, BATCH_SIZE);

    if (toAdd.length === 0) {
      return NextResponse.json({
        added: 0,
        entityIds: [],
        note: "No eligible candidates in the global pool.",
      });
    }

    // Tag each candidate: add "prospect-contact" + "queue:<assignee>"
    const queueTag = `queue:${assignee}`;
    const addResults = await Promise.allSettled(
      toAdd.map((p: EntitySummary) =>
        addTagsToEntity(p.id, p.tags, ["prospect-contact", queueTag])
      )
    );

    const addedIds: string[] = [];
    addResults.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value === true) {
        addedIds.push(toAdd[i].id);
      }
    });

    // Bust cache so outreach page reloads fresh data
    revalidateTag("contacts");

    // Fire-and-forget: trigger message generation for the new batch
    // Use the same assignee (capitalised for the bulk-generate API)
    const assigneeCapitalised =
      assignee.charAt(0).toUpperCase() + assignee.slice(1);
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const generateHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      cookie: cookieHeader,
    };
    if (internalSecret) {
      generateHeaders["X-Internal-Secret"] = internalSecret;
    }
    fetch(`${baseUrl}/api/outreach/bulk-generate`, {
      method: "POST",
      headers: generateHeaders,
      body: JSON.stringify({
        entityIds: addedIds,
        assignee: assigneeCapitalised,
      }),
    }).catch((err) => {
      console.warn("[new-batch] bulk-generate fire-and-forget failed:", err);
    });

    return NextResponse.json({
      added: addedIds.length,
      entityIds: addedIds,
    });
  } catch (err) {
    console.error("[new-batch] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch new batch. Check server logs." },
      { status: 500 }
    );
  }
}
