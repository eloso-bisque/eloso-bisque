---
title: Fetch All Entities with Full Pagination for Tag-Filtered Views
status: accepted
tags:
  - kissinger
  - data-fetching
  - performance
---

## Problem

Kissinger has no server-side tag filtering. When a view needs to show entities with a specific tag (e.g., `prospect`, `vc`), Kissinger returns them in cursor order — entities can appear anywhere across pages. A limited page fetch (e.g., first 200) will silently miss tagged entities that appear later in the cursor sequence.

## Decision

Use `fetchAllEntities(kind)` for any view that requires tag-based filtering across the full dataset. This function paginates through all entities (up to 10,000 with PAGE=500 and safety=20) and returns them all.

## When to Use Full Scan vs. Paginated

| Use Case | Function | Rationale |
|---|---|---|
| Contacts list (paginated UI, no tag filter) | `fetchContactsPage(kind, first, after)` | Server-side cursor pagination is efficient |
| Prospects tab (tag=prospect), VC tab (tag=vc) | `fetchAllEntities("org")` then filter | Must scan full dataset for tag |
| Investor firms/people | `fetchAllEntities("org"|"person")` then filter | Same reason |
| Outreach queue (queue:assignee tag) | Custom full scan in `_fetchProspectContacts` | Same reason |

## Performance Notes

- `fetchAllEntities` is cached via `unstable_cache` with a 120s TTL and `contacts` tag
- For outreach/signal tabs, batch detail fetches in chunks of 10 (`chunkArray`) to avoid overwhelming Kissinger with 500+ concurrent requests
- Signal contacts are capped at `SIGNAL_DISPLAY_LIMIT=50` before detail fetching

## Safety Loop

All paginated loops must include a safety counter to prevent infinite loops if Kissinger pagination has a bug:

```typescript
let safety = 0;
while (safety < 20) {  // or 30 for larger scans
  safety++;
  // ... fetch page ...
  if (!raw.pageInfo.hasNextPage || !raw.pageInfo.endCursor) break;
}
```
