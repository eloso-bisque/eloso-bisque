# eloso-bisque: Decisions & Context Log

*Last updated: 2026-07-22*

## Purpose

This is a synthesized, dated record of the significant product/architecture decisions,
pivots, and reversals in eloso-bisque's history, and the context behind them. It exists
so that anyone (human or agent) picking up work on this repo can understand *why* the
current architecture looks the way it does without re-deriving it from scattered chat
history, commit messages, and GitHub threads.

**Sources used:** GitHub issues/PRs (`gh` CLI), full git commit history and in-repo docs
(`feature-spec.md`, `prisma-schema-design.md`, `AUTH_PLAN.md`, `SIGNAL_TASK_QUEUE_DESIGN.md`,
`DEPLOYMENT.md`, `gojiberry-analysis.md`), Telegram/Slack conversation history, and
Lobster's canonical project memory (`memory/canonical/projects/eloso-bisque.md` and
session notes 2026-04-01 through 2026-07-22).

**Source explicitly NOT available:** the Obsidian vault (PRD notes, feature briefs,
research docs under `Eloso/`). Two retrieval attempts (2026-07-22, ~20:17 UTC and again
during composition of this doc) both timed out after 1800s with no response — the
Obsidian Local REST API plugin/app appears to be unreachable from this environment
(a known recurring issue, tracked separately as GH issue #2119). Nothing below is
sourced from Obsidian; if the vault becomes reachable, it should be swept and this doc
revised, particularly around PRD rationale and the semantic-ERP research briefs referenced
in commit messages.

## What this repo is (and isn't)

eloso-bisque is Eloso's **internal sales CRM** — used by Drew, Ben, and Jake to run their
own outbound prospecting pipeline (contacts, outreach queue, funnel tracking, investor
pipeline). It is a tool *for* the business, not the business's product. Eloso's actual
outward-facing product — the thing sold to customers like Trinity Rail and CDK Global —
is a "trust harness" / "control harness for enterprise AI agents," which solidified as
the company's positioning through May–July 2026 (see Positioning Context below). The two
threads intertwine in the history (e.g. outreach messaging in this CRM pitches the trust
harness product) but are distinct systems.

---

## Chronological decision log

**2026-03-26** — Drew hands over a manual funnel-calculator spec (ARR target, ACV,
conversion rates → outreach volume needed), to be built as a page in eloso-bisque wired
to Kissinger. Earliest attested request for this repo.

**2026-04-01** — First working state: password auth, segmented contact list (People/VC
Firms/Prospects/Other Orgs), contact detail pages shipped (3 of 23 PRD slices). PRD audit
produces 29 GitHub issues across 7 epics (Auth, Contacts & Relationships, Deal Pipeline &
Revenue, Funnel Calculator, Daily Rhythm/Slack, Integrations, AI Layer). Deployment
canonicalized on Vercel (`eloso-bisque.vercel.app`); PM2-hosted frontend retired. No
database/ORM layer exists yet — everything reads/writes through Kissinger (Rust CLI +
CozoDB graph store, GraphQL API on localhost:8080) plus ad hoc Vercel KV. Deploy rule set:
always `vercel --prod`, never bare `vercel`.

**2026-04-09** — Pipeline Funnel Kanban shipped: 7-stage board (Identified → Researched →
Contacted → Engaged → MeetingBooked → ProposalSent → ClosedNurture), stage stored as a
`funnel_stage` meta key directly on Kissinger Person entities — no schema migration, the
pattern that later becomes the core motivation for moving to Postgres.

**2026-04-17–20** — Paperclip → Bisque rebrand: UI rebrand across 30+ files, URL path
changed `/paperclip/` → `/bisque/`.

**2026-04-24 – 04-28** — Outreach-generation pipeline rewrite: two-pass Haiku+Opus
architecture tried, then reverted to Opus-only within about a day (PRs #30–33). First of
several build→revert→rebuild cycles in the outreach subsystem.

**2026-04-28 – 05-08** — Outreach queue moved from a single global queue to **per-user
queues** (`queue:drew`/`queue:ben`/`queue:jake` tags), rebuilt May 8 with a "New Batch"
button replacing "Reload Tasks" (PRs #36–38). *Dating note: GitHub PR timestamps place
this Apr 28–May 8; a git commit on the same feature is dated May 11 — the two sources
disagree by several days on exact completion, likely reflecting iteration rather than a
single event.*

**2026-05-01** — Auth overhaul deployed: email+password, bcryptjs, JWT, Vercel KV session
storage. `AUTH_PLAN.md`'s original storage decision was Vercel KV — this held, but the
plan's assumptions about session persistence were superseded in practice by later fixes
(JWT `startsWith` bugs across 5 routes fixed 05-04/05-05).

**2026-05-02** — Signal-handling design: `SIGNAL_TASK_QUEUE_DESIGN.md` explicitly
**rejects** a dedicated Signal database table in favor of a UI-only fix over existing
Kissinger tags. This decision is later **reversed** by the Prisma migration, which adds a
dedicated `Signal` model (see 2026-05-26 and 2026-07-22 entries).

**2026-05-11** — Vercel definitively ruled out as a host for the Kissinger backend itself
(CozoDB/SQLite-on-serverless is "a hard incompatibility — not a risk to manage, a
guarantee to fail"). Separately, a sibling product `bisque-booking` is deliberately
**rejected from this repo** and spun out to `Bisque-Labs/bisque-booking` (issue #39, PR
#40, closed not merged) — built in Python/FastAPI rather than Next.js (PRD explicitly
called for "no build step, small Docker image, HTMX+Jinja2 SSR").

**2026-05-26** — **Turning point.** Deep investigation into CRM slowness roots the
problem in Kissinger's data model itself: no native Investor/Prospect/VcFirm entity
kinds (classification is entirely tag/meta string-driven), no index on the tags column
(full table scan per filter), no server-side tag-filtering query in the GraphQL API —
"CozoDB is dogshit for any real app" (Drew). Confirmed: eloso-bisque has no CRM database
of its own at all — only Vercel KV (users/counters) and SQLite (bookings); the "Outreach
Queue" is not a table, just a computed view over Kissinger tags. Drew directs a Prisma
schema **design doc** be written; delivered same day: a 16-model schema
(`prisma-schema-design.md`) — `User, Organization, Contact, OutreachQueueEntry,
OutreachTouch, OutreachResponse, GeneratedMessage, Signal, ContactEvent, ActivityLog,
Booking, ...` — the first explicit decision to move off the tag/meta graph model toward
typed relational storage. Drew approves implementing Postgres/Prisma **in parallel with
Kissinger** during a dual-write transition — not a hard cutover.

**2026-06-09** — **Prisma Phase 1 complete** (commit `a6c960d`): `prisma@7.8.0` installed,
16-model `schema.prisma` committed and validated, `prisma.config.ts` +
`src/lib/prisma.ts` singleton client created. Zero tables exist yet and zero application
code touches Prisma — **blocked on a Postgres instance / `DATABASE_URL`**, which Drew
needs to supply. *Gap: the task that produced this had itself silently died once already
between the May 26 kickoff and a June 9 status check — it was respawned rather than
resumed, which is why Phase 1 landed five weeks after the design doc rather than
immediately.*

**2026-06-10** — Markdown vault/docs editor shipped (`/docs` route): CodeMirror 6 + Yjs
CRDT real-time collaboration, VPS-hosted `vault-api`/`vault-ws` services (ports
8082/8083), nginx-proxied. Decision: build directly rather than embed "Glyphdown" (rejected
as a full platform, not embeddable).

**2026-06-11** — PRD synthesis from ~170 Ben/Jake messages (Apr–Jun) identifies the
**#1 recurring issue**: outreach-queue integrity (sent/skipped contacts reappearing,
reported 4+ times over two months), rooted in unreliable Kissinger tag-write persistence.
This becomes the recurring justification for treating the Postgres migration as
architectural, not another symptomatic patch.

**2026-07-02** — As of this date `DATABASE_URL` still has not been provisioned, over a
month after Phase 1 shipped — confirmed via a side-discussion about an `/events` calendar
page, where the Postgres-backed option is explicitly described as "blocked on Prisma
Phase 2 (currently blocked on DATABASE_URL from Drew)," and the Google-Calendar-embed
option recommended instead specifically to sidestep the dependency. **This `DATABASE_URL`
blocker persisted for roughly six weeks (2026-06-09 to 2026-07-21) with no recorded
reason for the delay** beyond "awaiting Drew's provider choice."

**2026-07-21, 03:42 UTC** — Drew directs a full research→plan pass (Sonnet research,
Opus synthesis, Fable plan) to finish the stalled migration, mining message logs, git
history, docs, and (intended, but unreachable) Obsidian PRDs. Plan delivered 06:58 UTC:
recommends skipping dual-write scaffolding in favor of a maintenance-window cutover
(small team, ~8k contacts) — **this recommendation is overridden the next day** in favor
of dual-write (see 07-22). Two side-decisions flagged as still open: the `/events` page
approach (Google Calendar API + iframe vs. a new Prisma `Event` model) and the
Contacts-search replacement (Postgres `tsvector` vs. Algolia/Typesense vs. keeping
Kissinger read-only for search).

**2026-07-21, 19:38 UTC** — Drew picks a provider: "Neon. Use fable." Neon Postgres
provisioned via the Vercel marketplace integration within the hour; **Prisma Phase 2
migration (19 tables) applied and verified live in production**, resolving the six-week
blocker.

**2026-07-21, ~19:50 UTC** — **Infra correction discovered:** the Vercel CLI's default
team scope had been wrong since day one. The project actually lives under the
**"fully-parsed" Vercel team**, and the real production URL is
**`https://eloso-bisque-virid.vercel.app`** — not `eloso-bisque.vercel.app`, which had
been recorded as canonical in every piece of memory/documentation since 2026-04-01. The
`vercel --prod` deploy rule itself was always correct; only the *scope* it ran under was
wrong.

**2026-07-22 — full Kissinger→Postgres migration executed in one day** (GH issues
#41–46, PRs #47–53), following Drew's 09:31 UTC directive to complete it end to end:

- **PR #47** (issue #42) — Dual-write infra + Activity Dashboard read migration (Phase 3.1)
- **PR #48** (issue #43) — Outreach queue dual-write + read migration (Phase 3.2). Explicit
  decision to **defer the read-cutover** for this subsystem: only ~25% of active queue
  rows had a resolvable Organization and ~62% a title in Postgres at that point — cutting
  over would have blanked fields on the team's daily tool. Also fixed a real,
  previously-silent production bug in the same PR: `recordOutreachResponse` was sending
  wrong-case enum values to Kissinger's GraphQL API, so every real "Log Response" click
  had been silently failing before this fix.
- **PR #50** (issue #44) — Contacts listing + Sectors heatmap read migration (Phase
  3.3/3.4); review caught and fixed an ICP-percentage display bug and an archived-org
  filter gap.
- **PR #51** (issue #45) — Investors section read migration (Phase 3.5); review caught a
  classification bug that had silently misclassified/dropped 49% of investor contacts.
- **PR #52** (issue #46) — Contact detail / Funnel Kanban read migration (Phase 3.6, final).

Each PR was independently reviewed by a second pass before merge; all six were merged and
deployed live by 16:27 UTC. Issues #41–46 closed (two of them, #41 and #43, manually,
since their merging PRs never used a `Closes #` keyword).

**2026-07-22, 17:22 UTC** — Drew's explicit follow-up directive: "Do not remove kissinger,
but remove the dual write so it is disconnected from the actual lived performance of the
frontend... use the system as though that interface is built entirely on postgres. We'll
worry about graph operations later."

**2026-07-22, 18:08–18:14 UTC — PR #53** (Kissinger dual-write removal) merged and
deployed: disconnects the live frontend from Kissinger wherever a working Postgres path
already exists (contacts CRUD, notes/funnel/investor-pipeline mutations, contact events
tab, score API, homepage stat cards, booking sync). The contact-events route was
deliberately split so externally-written Trigify signals (a daily cron job that writes
straight into Kissinger) stay sourced from Kissinger rather than being silently zeroed
out. **Three things were intentionally left on Kissinger, flagged explicitly for Drew's
own decision rather than silently handled:**
1. `/api/contacts/[id]/intro-path` (contact intro-path graph traversal) — Drew's own named
   exception.
2. The entire Outreach subsystem (queue/signals/message-gen) — blocked by the same
   data-completeness gap noted in PR #48 (~25% Organization resolution, ~62% title
   resolution), not a graph limitation.
3. Contacts "All" tab + search box — needs Kissinger's ranked cross-entity search; no
   Postgres equivalent has been built.

Per the original migration plan, **Kissinger itself should not be decommissioned until a
2+ week stable dual-write observation window has passed** — this decommissioning timeline
is still open and unscheduled as of this writing.

---

## Positioning context (background, not eloso-bisque-specific)

Running in parallel to the above, Eloso's outward product identity solidified through
2026: from a "demand-planning-accuracy company" (pivot noted 2026-06-04) to a "trust
harness" / "control harness for enterprise AI agents," targeting CSCOs/demand-planning
leaders at large manufacturers, with Trinity Rail as the representative customer
(InforLX → Databricks → Palantir Foundry stack; ~70% baseline demand-forecast accuracy,
~65% BOM accuracy at 6 months, $50–70M unallocated inventory) and CDK Global as a second
prospect. A "semantic ERP" offering thesis was proposed 2026-07-16 as a potential core
product line (reusable beyond Trinity), with a referenced Series A timeline of early
2027. This context matters for eloso-bisque only insofar as outreach-message content and
positioning inside the CRM reference it directly.

---

## Open questions & known gaps

These are unresolved as of 2026-07-22 and should be settled (or explicitly re-flagged)
before further architectural work proceeds:

1. **`/events` calendar page approach** — Option A (Google Calendar API + iframe, no
   schema change) vs. Option B (dedicated Prisma `Event` model). Raised 2026-07-02,
   re-flagged open 2026-07-21 and again 2026-07-22. Not decided.
2. **Contacts-search replacement** — no Postgres equivalent exists to Kissinger's ranked
   cross-entity search. Candidates floated: Postgres `tsvector`, Algolia/Typesense, or
   keeping Kissinger read-only for search only. Not decided; this is why the Contacts
   "All" tab + search box is one of the three things still reading from Kissinger.
3. **Kissinger decommissioning timeline** — no date has been scheduled. The original
   migration plan calls for a 2+ week stable dual-write observation window first; that
   window's start date is not recorded anywhere found in this research.
4. **Outreach subsystem data-completeness gap** — flagged in PR #48: only ~25% of active
   queue rows resolve an Organization and ~62% a title in Postgres. No remediation plan
   (backfill job, manual cleanup, etc.) was found; this gap is what's currently blocking
   the Outreach subsystem's read-cutover.
5. **Audit-trail gap on the production backfill** — PR #48 fixed a live, previously
   silent bug (`recordOutreachResponse` sending wrong-case enums to Kissinger), which
   means an unknown number of past "Log Response" actions were lost before the fix. No
   audit or backfill of the lost responses was found to have been performed or planned.
6. **Dating discrepancy** — the per-user outreach queue conversion is dated Apr 28–May 8
   in GitHub PR history but May 11 in a related git commit; not material to current
   architecture, but noted in case exact sequencing ever matters.
7. **Obsidian PRD content** — entirely absent from this doc (see Sources note above).
   Anything the PRD or research briefs say about *why* specific features were prioritized
   is not reflected here.

---

## Where to look for more detail

- `docs/feature-spec.md`, `docs/prisma-schema-design.md` — in-repo design docs referenced
  throughout the 2026-05-26 migration decision.
- `AUTH_PLAN.md`, `SIGNAL_TASK_QUEUE_DESIGN.md`, `DEPLOYMENT.md`, `gojiberry-analysis.md` —
  repo-root docs covering auth, signals, deployment, and a named audit respectively.
- GitHub issues/PRs #41–53 for the full migration, each with its own review history.
- `Eloso_CRM_PRD.docx` (binary, not machine-read for this doc).
