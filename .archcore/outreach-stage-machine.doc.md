---
title: Outreach Cadence Stage Machine
status: accepted
tags:
  - outreach
  - crm
  - data-model
---

The outreach system tracks a contact's progress through a linear cadence using the `outreach_stage` meta field on person entities.

## Stage Values

```
cold → touched_1 → touched_2 → touched_3 → responded
```

| Stage | Meaning |
|---|---|
| `cold` | Not yet contacted |
| `touched_1` | First touch sent |
| `touched_2` | Second touch sent |
| `touched_3` | Third touch sent |
| `responded` | Contact replied |

## Mutations

Stage transitions are written via Kissinger GraphQL mutations — do not update `outreach_stage` directly via `mergeEntityMeta`.

- **Touch**: `recordOutreachTouch(personId, touchNumber, notes?)` — advances stage. `touchNumber` must match current stage (1 for cold, 2 for touched_1, 3 for touched_2).
- **Response**: `recordOutreachResponse(personId, responseType, notes?)` — moves to `responded`. ResponseType: `Interested | NotNow | WrongPerson | NoReply | Bounced`

## Tag Transitions

When a touch is recorded, the person's `prospect-contact` tag is eventually replaced by `outreach-sent`. This happens server-side in Kissinger.

## Sent Tab Logic

The "Sent" tab in Outreach shows:
1. Persons tagged `outreach-sent` (canonical sent)
2. Persons tagged `prospect-contact` with stage `touched_1`, `touched_2`, `touched_3`, or `responded` (T2+ contacts whose tags haven't been migrated yet)

## Meta Field Protection

`mergeEntityMeta()` in `@src/lib/kissinger.ts` fetches current meta before writing. Call sites must only pass the specific keys being updated. Never pass `outreach_stage`, `outreach_sent_at`, or `outreach_sent_by` through `mergeEntityMeta` — those are exclusively managed by the touch/response mutations.

## Outreach Message Storage

Generated outreach messages are stored as meta on the person entity:
- `outreach_message` — the message text
- `outreach_message_generated_at` — ISO timestamp
- `outreach_message_sender` — sender variant (e.g., "drew", "ben")

These are written via `/api/outreach/generate-message` and `/api/outreach/bulk-generate`.
