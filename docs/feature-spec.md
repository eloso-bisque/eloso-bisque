# Eloso Bisque — Feature Specification

**Document status:** As-built specification derived from codebase exploration (July 2026)
**Primary datastore:** PostgreSQL (Neon), accessed via Prisma — see `docs/prisma-schema-design.md`
**Secondary datastore (narrow use — search + intro-path only):** Kissinger GraphQL at
`https://eloso-awp.myownlobster.ai/kissinger/graphql`
**Frontend:** Next.js 14 app at `~/lobster-workspace/projects/eloso-bisque/`
**Migration history:** see `docs/decisions-and-context.md` for the full Kissinger→Postgres
story (2026-05-26 decision, 2026-07-21/22 execution) and currently open questions

---

## 1. Overview

Eloso Bisque is a private, team-facing CRM and sales operations tool built for Eloso AI, a startup that sells AI-native supply chain optimization software to large North American manufacturers. The application is not a general-purpose CRM — it is purpose-built for Eloso's specific Ideal Customer Profile (ICP): Chief Supply Chain Officers, VP/Director Supply Chain, and demand planners at $100M–$5B revenue manufacturers in sectors like aerospace, defense, and heavy equipment.

The system serves three people (Ben, Jake, and Drew — the founding team) and covers two distinct sales motions:

1. **Outbound LinkedIn outreach to prospects** — People and companies in target manufacturing verticals that Eloso wants to sell to.
2. **Fundraising pipeline management** — VC firms and investor contacts that Eloso is approaching for investment.

**Data model, post-migration:** as of the 2026-07-22 Kissinger→Postgres migration and
dual-write removal, **Postgres is the primary store** for essentially all CRM data —
contacts, organizations, outreach queue/touches/responses, funnel stage, investor
pipeline, signals, contact events, activity logs, and bookings all live in typed Prisma
models (19 tables; see `docs/prisma-schema-design.md`). The original Kissinger graph
CRM (Rust CLI + CozoDB, GraphQL API) is **not decommissioned** — no date has been
scheduled — but the live frontend only reads from it for two things that Postgres does
not (yet) replace:

- **Contacts "All" tab + search box** — Kissinger's ranked cross-entity full-text search
  has no Postgres equivalent built yet (candidates under discussion: `tsvector`,
  Algolia/Typesense, or keeping Kissinger read-only for search only).
- **Contact detail "Intro Path" tab** — BFS graph traversal for warm-intro discovery.
  A `RelationshipFrom` model exists in Postgres for direct typed relationships, but
  multi-hop path-finding is still served by Kissinger's graph store.

Everything described below should be read with that split in mind: unless a section
says otherwise, assume Postgres is the read/write path.

---

## 2. Authentication and Access

### Who can log in
The app is restricted to the Eloso team: Ben, Jake, and Drew. There is no public
registration. User records (email, bcrypt password hash, name) live in the Postgres
`User` table.

### Login flow
- A standard email/password login form at `/login`.
- On success, a JWT session cookie (`eloso_session`) is set, signed with `JWT_SECRET`
  (HS256 via `jose`), 7-day expiry, carrying user id/email/name.
- Forgot-password flow sends a reset link via email; tokens are stored in the
  `PasswordResetToken` table. The reset page is at `/reset-password`.

### Access control
All application routes under `/(main)/` require a valid session; unauthenticated
requests redirect to `/login` with the original path preserved as `?from=`.
Service-to-service calls (e.g. from the Lobster automation system) bypass session
auth by presenting a matching `X-Internal-Secret` header. There is no role-based
access control — all three team members have equal access, including to `/admin/*`.

### Public routes
`/login`, `/reset-password`, the public booking flow (`/book`, `/cancel/[token]`,
`/reschedule/[token]` and their APIs), `/api/cron/reminders`, and a couple of
prospect-facing landing pages (`/ELO`, `/next-steps`).

---

## 3. Navigation and Layout

Desktop: persistent top nav (Dashboard, Contacts, Investors, Funnel, Outreach,
Sectors, Activity, a "Temporal" link, logout). Mobile: minimal top bar + bottom tab
bar. Tables on the Contacts page collapse to card lists on mobile.

---

## 4. Core Features

### 4.1 Dashboard (`/`)
Landing page with a stat grid (Contacts, Orgs, Entities, Connections counts and 2-week
deltas) computed from Postgres, plus quick-navigation tiles to Contacts, Outreach,
Investors, and the Funnel Calculator.

### 4.2 Contacts (`/contacts`)
Segmented browse/search across five tabs: People, VC Firms, Prospects, Other Orgs,
All. People/VC Firms/Prospects/Other Orgs read from Postgres (`Contact` and
`Organization` models, classified via `ContactTag`/`OrganizationTag`). **The "All" tab
and the search box are the one part of this page still backed by Kissinger** —
searching runs Kissinger's full-text search across all entity types, and results are
filtered client-side to the active segment. Prospects tab adds vertical/stage filters;
sorting by computed Eloso Fit Score is available on all segments. Cursor-based
pagination (50/page) on People; org segments fetch and cache server-side.

### 4.3 Contact Detail (`/contacts/[id]`)
Tabbed layout: **Overview**, **Events**, **Signals**, **Intro Path**.
- Overview, Events, and Signals read/write Postgres (`Contact`, `ContactEvent`,
  `Signal`). Trigify-sourced signal events are a special case: a daily external sync
  job writes them straight into Kissinger, so the contact-events route was
  deliberately split to keep those sourced from Kissinger rather than being silently
  dropped — see `docs/decisions-and-context.md`, 2026-07-22 entry.
- **Intro Path is the other Kissinger-backed tab**: it computes the shortest network
  path from an Eloso team member to the contact via Kissinger's graph traversal.

### 4.4 Adding and Managing Contacts
Single-contact creation and bulk CSV import both write to Postgres, with an AI
enrichment step filling missing fields before save. Notes auto-save on blur.

### 4.5 Investors (`/investors`)
Firms / People / Pipeline tabs over the same Postgres-backed `Contact`/`Organization`
models, filtered to investor-tagged records. Pipeline tab groups firms by
`InvestorPipelineStage` (Research → WarmIntro → FirstMeeting → PartnerMeeting →
TermSheet → Closed → Passed).

### 4.6 Investor Firm / Person Detail
Firm and person detail pages show fit-score breakdowns, thesis/incentive notes,
partners/portfolio (via `RelationshipFrom`), and a pipeline-stage selector that writes
directly to Postgres (no more tag round-tripping through Kissinger).

### 4.7 Funnel (`/funnel`)
**Pipeline tab:** drag-and-drop Kanban (`FunnelStage`: Identified → Researched →
Contacted → Engaged → MeetingBooked → ProposalSent → ClosedNurture), persisted to
Postgres on drop.
**Calculator tab:** client-side-only funnel math (ARR target, deal size, cycle length,
conversion rates → required weekly outreach volume). No datastore involved.

### 4.8 Outreach (`/outreach`)
Daily per-user work queue (Active / Signals / Sent tabs), backed by the
`OutreachQueueEntry`/`OutreachTouch`/`OutreachResponse`/`GeneratedMessage` Postgres
models. Contacts progress `cold → touched_1 → touched_2 → touched_3 → responded`.
Message generation assigns one of three angles (Vision/Technical/Strategic) based on
sender role, and sector-based assignment routes prospects to Ben/Drew/Jake with a
round-robin fallback for unrecognized sectors.

> **Known gap (data completeness, not a Kissinger dependency):** per
> `docs/decisions-and-context.md` (PR #48), only ~25% of active queue rows resolve an
> `Organization` and ~62% a `title` in Postgres. This is why the outreach subsystem
> was flagged separately from the rest of the read-cutover, and it is the reason two
> pre-existing test-suite bugs exist in `assignContact`/`generateMessage` (sector and
> angle assignment mismatches) — confirmed independently pre-existing, not something
> introduced by this doc/deps update, and intentionally not fixed here.

### 4.9 Sectors (`/sectors`)
Industry heat map over Postgres `Sector`/`OrganizationSector` — coverage, ICP fit,
and gap badges per sector, drilling into a sector detail page.

### 4.10 Admin — Activity (`/admin/activity`)
Login/outreach activity per user from the Postgres `ActivityLog` table — no caching,
fetched fresh per page load.

### 4.11 Admin — Availability / Bookings, Public Booking System
Unchanged by the migration: booking configuration, guest-facing booking/cancel/
reschedule flows, and admin booking review are backed by the `Booking`,
`AvailabilityConfig`, and `BlockedDate` Postgres models (previously a standalone
SQLite database local to the Next.js app; now the same Postgres instance as the rest
of the app). A `kissinger-adapter.ts` module still exists for booking-related
Kissinger sync; the extent of that sync was not fully re-verified for this doc.

### 4.12 Temporal Token
The "Temporal" nav link calls `/api/auth/temporal-token` to mint a short-lived token
for the Temporal workflow UI — an internal engineering tool, unrelated to the CRM data
model.

---

## 5. Data Model

See `docs/prisma-schema-design.md` for the full Prisma schema (19 models/tables) and
the rationale for moving off Kissinger's tag/meta system. Highlights:

- **`Contact`** and **`Organization`** are first-class typed rows (replacing Kissinger's
  generic `Person`/`Org` entities with a `meta[]` key-value bag). Classification that
  used to be free-form tags (`vc`, `investor`, `prospect`) is now `ContactTag`/
  `OrganizationTag` join rows.
- **Outreach state is a proper state machine**: `OutreachQueueEntry` (one row per
  contact-user assignment, `OutreachStage` enum) plus `OutreachTouch` and
  `OutreachResponse` rows for history — replacing the old cross-referencing of
  `queue:*` tags, `outreach_stage` meta, and `outreach-sent` tags.
- **`Signal`** and **`ContactEvent`** are dedicated tables (the May 2026 design
  explicitly rejected a dedicated Signal table in favor of Kissinger tags; the Prisma
  migration reversed that decision).
- **`ActivityLog`** replaces Vercel KV counters with queryable rows (real SQL
  aggregation for the Activity Dashboard).
- **`RelationshipFrom`** models direct typed relationships (works_at, knows) for cases
  that don't need full graph traversal. Multi-hop BFS (Intro Path) is intentionally
  left on Kissinger — a recursive CTE was considered acceptable for the current team
  size but has not been built.
- Scores (Eloso Fit, ICP, Investor Fit — see Section 6) are still computed
  client/server-side on read, not persisted as columns.

**What still lives on Kissinger:** the full graph of `Person`/`Org` entities with
`meta[]` and tags, used only as the backing store for cross-entity search and
intro-path traversal. Trigify's daily signal-sync job also still writes directly into
Kissinger (see 4.3).

---

## 6. Scoring

Three related scores, computed on read (not persisted):

- **Eloso Fit Score (0–100), all contacts:** weighted blend of title relevance (30%),
  seniority (25%), org type (20%), interaction recency (10%), network proximity (8%),
  record completeness (7%).
- **ICP Score (0–100), prospect orgs only:** vertical fit, size fit ($100M–$5B revenue,
  200–10,000 employees), supply-chain complexity, buyer accessibility, warm-intro path
  availability.
- **Investor Fit Score (0–100), VC firms/investor contacts:** same 6-factor model,
  reweighted for the fundraising context.

Interpretation is consistent across all three: 70+ strong (green), 40–69 moderate
(yellow), 0–39 weak (red).

---

## 7. Search, Signals, Bulk Operations (brief)

- **Search:** global full-text search on the Contacts page is the one query path still
  served by Kissinger (see Section 4.2). Segment/vertical/stage filters are all
  Postgres-side.
- **Signals (Trigify):** external daily sync job writes LinkedIn-activity signals into
  Kissinger (`createdBy: "trigify-sync"`); the app also maintains Postgres `Signal`
  rows for snooze/dismiss state. Hot = within 3 days, warm = within 14 days.
- **Bulk operations:** CSV bulk-import and the Outreach page's "New Batch" (12 fresh
  prospects) / "Open Next 8 LinkedIn" actions are unchanged in behavior by the
  migration; they now read/write Postgres instead of Kissinger tags.

---

## 8. Open Questions and Known Gaps

Carried over from `docs/decisions-and-context.md` (as of 2026-07-22) — see that doc
for full detail:

1. **Contacts search replacement** — no Postgres equivalent to Kissinger's ranked
   search yet; candidates are `tsvector`, Algolia/Typesense, or keeping Kissinger
   read-only for search.
2. **Kissinger decommissioning timeline** — not scheduled; a 2+ week stable
   dual-write-removed observation window was the original plan.
3. **Outreach data-completeness gap** — ~25% Organization / ~62% title resolution in
   the Postgres-backed outreach queue; no backfill plan found.
4. **`/events` calendar page** — still undecided between a Google Calendar
   iframe/API approach and a dedicated Prisma `Event` model.
5. Two pre-existing, out-of-scope test bugs in `src/lib/__tests__/outreach.test.ts`
   (sector-assignment and message-angle mismatches, see Section 4.8) and a P1a
   meta-fields regression in `src/lib/__tests__/kissinger-pagination.test.ts` remain
   unfixed as of this writing — flagged for whoever owns the outreach/contacts-search
   slices of the migration.

This document intentionally does not attempt to re-verify every route handler in
detail (e.g. exact CSV bulk-import column names, the booking email provider
integration) — see the source under `src/lib/` and `src/app/api/` for ground truth
on any specific endpoint.
