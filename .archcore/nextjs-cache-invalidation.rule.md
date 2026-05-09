---
title: Use Next.js Cache Tags for Kissinger Data Invalidation
status: accepted
tags:
  - caching
  - kissinger
  - data-fetching
---

All Kissinger data fetches must use Next.js `unstable_cache` with explicit cache tags. After any mutation (create, update, delete), the relevant cache tags must be revalidated.

## Cache Tag Taxonomy

| Tag | Scope | Revalidate When |
|---|---|---|
| `contacts` | All person/org entities | Any entity is created, updated, archived, or has meta changed |
| `funnel` | Funnel kanban stage data | A contact's `funnel_stage` meta is updated |

## Standard TTLs

- **60 seconds** — contacts lists, signal contacts, sent contacts
- **120 seconds** — full entity scans (all people, all orgs, funnel kanban)

## Required Pattern

All server-fetching functions that read Kissinger entities must be wrapped with `unstable_cache`:

```typescript
export const fetchSomeData = unstable_cache(
  _fetchSomeData,
  ["cache-key"],
  { revalidate: 60, tags: ["contacts"] }
);
```

Exception: `fetchProspectContacts` intentionally skips `unstable_cache` to avoid race conditions after "New Batch" mutations. The per-request `next: { tags }` cache in `gql()` is sufficient.

## After Mutations

API routes that mutate entities must call `revalidateTag` from `next/cache`:

```typescript
import { revalidateTag } from "next/cache";
revalidateTag("contacts");
```

## Fetch-Level Caching in `gql()`

The core `gql()` function in `@src/lib/kissinger.ts` accepts `cacheOptions`:

- `{ tags: ["contacts"] }` — Next.js fetch cache tagged
- `{ revalidate: 60 }` — revalidate every N seconds
- `{ noStore: true }` — bypass cache (use for mutations and fresh meta reads)
