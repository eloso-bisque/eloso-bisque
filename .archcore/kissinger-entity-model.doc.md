---
title: Kissinger Entity and Tag Model
status: accepted
tags:
  - kissinger
  - data-model
  - crm
---

Kissinger is the backend graph CRM. It stores **entities** (nodes) and **edges** (relationships). This document describes the entity kinds, tag conventions, and how eloso-bisque maps them to UI concepts.

## Entity Kinds

Kissinger's entity kinds are a closed Rust enum. Only `person` and `org` exist — do not invent other kinds.

| Kind | Used For |
|---|---|
| `person` | Individual contacts, investors, prospects |
| `org` | Companies, VC firms, organizations |

## Tag Conventions

Tags are how entities are classified. eloso-bisque uses these tags:

### Contact Classification Tags

| Tag | Meaning |
|---|---|
| `vc` or `investor` | Investor firm (org) or investor person — shown on `/investors` only, excluded from `/contacts` |
| `prospect` | Prospect org entity |
| `prospect-contact` | Person being actively outreached |
| `outreach-sent` | Person who has been sent outreach (no longer prospect-contact) |
| `signal:post-engagement` | Person with a recent Trigify LinkedIn signal |

### Outreach Queue Tags

Format: `queue:<assignee>` (e.g., `queue:drew`, `queue:ben`, `queue:jake`)

Contacts in the outreach queue must have exactly one queue tag. Contacts with no `queue:*` tag are unassigned and excluded from all user views.

### Fit Tier Tags (on org entities)

| Tag | Meaning |
|---|---|
| `fit-high` | High ICP fit |
| `fit-medium` | Medium ICP fit |
| `fit-low` | Low ICP fit |

## Edge Relation Types

| Relation | Source → Target | Meaning |
|---|---|---|
| `works_at` | person → org | Person works at an org |
| `knows` | person → person | Warm intro path connection |

## Meta Fields (Key-Value on Entities)

Common meta fields on person entities:

| Key | Type | Description |
|---|---|---|
| `title` | string | Job title |
| `company` | string | Company name (may duplicate works_at edge) |
| `org` | string | Alternate company key |
| `linkedin_url` or `linkedin` | string | LinkedIn profile URL |
| `outreach_stage` | enum | `cold`, `touched_1`, `touched_2`, `touched_3`, `responded` |
| `outreach_message` | string | Last generated outreach message |
| `outreach_message_generated_at` | ISO string | When message was generated |
| `outreach_message_sender` | string | Sender variant used |
| `funnel_stage` | string | CRM funnel stage (see FUNNEL_STAGES) |
| `last_signal_date` | ISO string | Most recent Trigify signal date |
| `last_signal_keyword` | string | Signal keyword |
| `last_signal_url` | string | LinkedIn post URL |
| `signal_dismissed` | "true" or absent | User dismissed this signal |
| `signal_snoozed_until` | ISO string | Snooze expiry |

Common meta fields on org entities:

| Key | Description |
|---|---|
| `pipeline_stage` | Investor pipeline stage (Research, Contacted, etc.) |
| `stage` | Investment stage focus |
| `check_size` | Typical check size |
| `thesis` | Investment thesis |
| `website` | Org website |
| `sector_primary` | Primary sector for aggregates |

## `meta` Nested JSON

Apollo-enriched contacts may store their data in a JSON blob at meta key `"meta"` instead of individual keys. Always check both:

```typescript
const title = meta["title"] ?? nestedMeta["title"] ?? "";
```

## Segment Classification

`@src/lib/kissinger.ts` exports `classifyOrg(tags)` → `"vc" | "prospects" | "other-orgs"`.

- VC orgs: shown on `/investors` only (excluded from `/contacts`)
- Prospect orgs: shown on `/contacts` prospects tab
- Other orgs: shown on `/contacts` other-orgs tab
