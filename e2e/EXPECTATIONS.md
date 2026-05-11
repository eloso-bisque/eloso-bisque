# Outreach Page — Living Expectations Specification

This document is the canonical specification for the `/outreach` page.
It is maintained by the `eloso-test-manager` agent.

**Last updated:** 2026-05-11
**Total expectations:** 47
**Tests covering them:** 30 (in `e2e/outreach.spec.ts`)

---

## How to read this document

Each expectation has:
- **ID** — stable identifier (`EXP-NNN`)
- **Category** — logical grouping
- **Expectation** — what the system must do
- **Tests** — which test(s) in `outreach.spec.ts` verify it
- **Coverage** — `covered` / `partial` / `not covered`

When adding new expectations, append to the relevant section with the next available ID.
When adding new tests, update the Tests column for the affected expectation(s).

---

## Section 1: Auth & Access Control

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-001 | Unauthenticated users are redirected away from `/outreach` to `/login` or similar auth page. The redirect happens before any data fetch (cookie check is in the Page component, before Suspense). | `Auth & Queue Scoping > unauthenticated users are redirected` | covered |
| EXP-002 | The session is established via an `eloso_session` JWT cookie. The cookie is signed with `JWT_SECRET`. The page reads the cookie to identify `currentMember` before the Suspense boundary resolves. | (covered by all tests that inject auth cookies via `setJakeAuth`/`setDrewAuth`) | covered |
| EXP-003 | `currentMember` is derived from the JWT payload `email` field, mapped via `EMAIL_TO_MEMBER` (drew@eloso.ai → Drew, ben@eloso.ai → Ben, jake@eloso.ai → Jake). An unrecognized email results in `currentMember = null`. | (implicit in auth fixture tests) | partial |

---

## Section 2: Queue Scoping

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-004 | Each user sees ONLY their own queue contacts in the Active tab. Contacts are tagged `queue:drew`, `queue:ben`, `queue:jake` in Kissinger. `fetchProspectContacts(assignee)` fetches only that user's tag. | `Auth & Queue Scoping > Jake sees his own queue, not Ben's or Drew's contacts` | covered |
| EXP-005 | When authenticated, ALL fetched contacts go directly into that user's bucket. `distributeContacts()` is NOT called for authenticated sessions — it would split ~1/3 of contacts into other users' buckets. The unauthenticated fallback still uses round-robin distribution. | `Regression > BUG-1: All 16 of Jake's contacts appear` | covered |
| EXP-006 | The stat line shows `<N> active` where N equals the number of contacts in the logged-in user's scoped queue (after COO exclusion). | `Auth & Queue Scoping > queue is filtered to contacts tagged queue:jake` | covered |
| EXP-007 | Jake's contacts come from a LinkedIn CSV import (`source:human` + `linkedin` tag). These are legitimate Tier 1 contacts and must NOT be filtered out by the US location heuristic — `source:human` bypasses the location check. | (not directly tested in E2E — server-side Kissinger filter) | not covered |
| EXP-008 | Queue scoping: when Drew is logged in, Drew sees only `queue:drew` contacts. Same for Ben. Multi-user isolation must hold for all three team members. | `Auth & Queue Scoping > Jake sees his own queue, not Ben's or Drew's contacts` (partial — tests Jake/Drew isolation only) | partial |

---

## Section 3: COO / Title Filtering

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-009 | Contacts with "COO" or "Chief Operating Officer" in their title are excluded from the Active tab (server-side filter via `isTitleExcluded`). Marcus Chen (President & COO) and Robert Nguyen (COO) must not appear. | `Batch / Send Flow > "New Batch" contacts exclude COOs` | covered |
| EXP-010 | COO exclusion is server-side (not client-side). The filtered contacts do not appear in any visible Active tab list, even if passed in the raw fixture data. | `Batch / Send Flow > "New Batch" contacts exclude COOs` | covered |

---

## Section 4: Contact Data Display

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-011 | Each contact card shows: full name, company name, job title. All three must be populated — blank company or blank title is a bug. | `Contact Data Display > each contact card shows full name, company name, stage label, and fit tier badge` | covered |
| EXP-012 | For LinkedIn CSV imports (Jake's contacts), company name comes from the linked org entity via the `works_at` edge (`org.name`), not from person meta (which lacks a `company` key). The org fetch must request `{ name tags }` — just `{ tags }` leaves company blank. | `Contact Data Display > LinkedIn CSV contacts show company name resolved from org entity` | covered |
| EXP-013 | Company name is NOT blank for any visible contact card. | `Contact Data Display > company name is not blank for any visible contact card` | covered |
| EXP-014 | Each contact card shows the outreach stage label: `cold`, `touched_1` → "Touch 1 sent", `touched_2`, `touched_3`, `responded` → "Responded". The label is derived from `outreachStage` stored in Kissinger meta. | `Contact Data Display > stage label is shown on each contact card` | partial |
| EXP-015 | Each contact card shows a fit tier badge: `fit-high`, `fit-medium`, or `fit-low`. Fit tier controls sort order — high-fit contacts surface first within the Active list. | `Contact Data Display > each contact card shows full name, company name, stage label, and fit tier badge` | covered |
| EXP-016 | Contacts are sorted within the Active list: fit-high first, then fit-medium, then fit-low. Within the same tier, contacts are sorted alphabetically by company name. | (not directly tested as an ordering assertion) | not covered |
| EXP-017 | Each contact card shows a LinkedIn link (`<a href="...linkedin.com...">`) — either a real profile URL or a search URL fallback. Every visible contact must have a working LinkedIn link. | `Contact Data Display > LinkedIn URL is present on each contact card` | covered |

---

## Section 5: LinkedIn URL Handling

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-018 | LinkedIn URL can be a real profile URL (`linkedin.com/in/...`) OR a search URL (`linkedin.com/search/...`). The code must NOT reject search URLs. Previous bug: `getLinkedinUrl()` was rejecting search URLs, making `totalWithLinkedin === 0`. | `LinkedIn Queue Button > search URLs count toward queue total` | covered |
| EXP-019 | Jake's contacts often have no `linkedin_url` meta field. In this case, the fallback search URL (`https://www.linkedin.com/search/results/people/?keywords=[name]+[company]`) must be used and accepted as valid by `getLinkedinUrl()`. | `LinkedIn Queue Button > search URLs count toward queue total` | covered |
| EXP-020 | `getLinkedinUrl()` returns `null` only when `contact.linkedinUrl` is empty/undefined. It accepts any URL starting with `http`. | (tested indirectly via LinkedIn button and link presence tests) | partial |

---

## Section 6: LinkedIn Queue Button

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-021 | Button label when contacts exist and no profiles opened yet: `"Open Next N LinkedIn ([user]'s queue, M total)"` where N = min(8, remaining) and M = total contacts with any LinkedIn URL. | `LinkedIn Queue Button > button shows correct count of contacts with LinkedIn URLs` | covered |
| EXP-022 | Button label after some profiles opened: `"Open Next N LinkedIn ([user]'s queue, K/M done)"` where K = `batchOffset`. | (not directly tested as a progression test) | not covered |
| EXP-023 | Button is disabled (`disabled` attribute set) and shows `"No contacts in [user]'s queue"` only when `totalWithLinkedin === 0`. | `LinkedIn Queue Button > button is disabled when queue is empty` | covered |
| EXP-024 | Button is enabled when queue count > 0. | `LinkedIn Queue Button > button is enabled when queue count > 0` | covered |
| EXP-025 | Button opens up to 8 contacts per click programmatically (creates `<a>` tags and clicks them). Opens in new tabs. | (not easily testable E2E due to popup blocking) | not covered |
| EXP-026 | After all profiles exhausted (batchOffset >= totalWithLinkedin): button shows "All profiles opened — Reset" and resets offset on next click. | (not directly tested) | not covered |
| EXP-027 | Switching tabs does NOT reset `batchOffset`. The opener works through the full user queue regardless of which tab is visible. | (implicit in `handleTabChange` code, not directly E2E tested) | not covered |
| EXP-028 | LinkedIn opening is completely decoupled from "Mark Sent" — opening a profile has zero backend side effects. | (tested indirectly — mock only intercepts `outreach-touch` API, not LinkedIn URLs) | partial |
| EXP-029 | BUG-3 regression: queue button count must NOT show 0 when Jake has contacts. The `linkedinContacts` calculation must use `queueTasks` (authenticated user's scoped tasks), not a stale/empty list. | `Regression > BUG-3: LinkedIn queue button count equals total Jake contacts` | covered |

---

## Section 7: Active Tab

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-030 | Active tab is selected by default when the page loads. | `Tabs > Active tab is selected by default and shows unsent contacts` | covered |
| EXP-031 | Active tab shows only contacts with `outreachStage === "cold"` (or no stage). Contacts with `touched_1` or later stage are NOT shown in Active. | `Tabs > Active tab shows only unsent (cold) contacts — not sent ones` | covered |
| EXP-032 | The tab bar shows three tabs: Active, Signals, Sent (in that order). | `Page Structure > tab bar shows Active, Signals, and Sent tabs` | covered |
| EXP-033 | Switching from Sent tab back to Active tab restores the task list. | `Tabs > switching to Active tab from Sent tab restores the task list` | covered |

---

## Section 8: Sent Tab

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-034 | Sent tab shows contacts tagged `outreach-sent` in Kissinger that are attributed to the logged-in user (`outreachMessageSender` matches current user, case-insensitive). Unattributed contacts (no sender) are shown to all users. | `Tabs > Sent tab shows sent contacts with clickable name links` | covered |
| EXP-035 | Each sent contact in the Sent tab has a clickable link to their contact page (`/contacts/:id`). | `Tabs > Sent tab shows sent contacts with clickable name links` | covered |
| EXP-036 | Sent tab shows stage labels for each contact: `touched_1` → "Touch 1 sent", `responded` → "Responded". | `Tabs > Sent tab shows stage labels (Touch 1 sent, Responded, etc.)` | covered |
| EXP-037 | Sent tab tab button shows a count badge with the number of sent contacts for the current user. | `Tabs > Sent tab shows contact count badge` | covered |
| EXP-038 | After clicking "Mark Sent" on a contact, it moves to the Sent tab (verified by re-loading with the contact in the sent fixture). | `Batch / Send Flow > after Mark Sent, contact moves to Sent tab` | covered |

---

## Section 9: Mark Sent / Optimistic UI

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-039 | Clicking "Mark Sent (T1)" on a contact card optimistically removes it from the Active tab immediately (client-side `removedIds` set), before the API call completes. | `Batch / Send Flow > clicking "Mark Sent" optimistically removes contact from Active tab` | covered |
| EXP-040 | On API failure for Mark Sent, the contact is restored to the Active tab (optimistic rollback via `handleUnmarkSentOptimistic`). | (not directly tested — error path) | not covered |
| EXP-041 | The Mark Sent API call hits `POST /api/contacts/:id/outreach-touch`, which records the interaction in Kissinger and updates the entity stage to `touched_1`. | (API call tested via network mock; Kissinger side is integration-level) | partial |

---

## Section 10: Signals Tab

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-042 | Signals tab shows contacts with a LinkedIn activity signal within the last 14 days (`lastSignalDate`). Hot signal = within 3 days. | (not directly E2E tested) | not covered |
| EXP-043 | Signal contacts come from two sources: active prospect-contacts that have `lastSignalDate` within 14 days, AND Trigify signal entities fetched separately. De-duplicated by ID. | (not directly E2E tested) | not covered |
| EXP-044 | Signal contacts are sorted by computed signal score: recency (0–100) + fit tier (5/15/30) + intro path bonus (15) + seniority (10). Higher score = more urgent. | (not directly E2E tested) | not covered |
| EXP-045 | Dismissed signals (`signalDismissed === true`) and snoozed signals (current time before `signalSnoozedUntil`) are excluded from the Signals tab. | (not directly E2E tested) | not covered |
| EXP-046 | `lastSignalUrl` — the URL of the specific LinkedIn post that triggered the signal — is shown on signal cards so the user can view the post directly. | (not directly E2E tested) | not covered |

---

## Section 11: Page Structure & New Batch Button

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-047 | Page header shows "Outreach" heading and "Personalized LinkedIn outreach tasks" subtitle. | `Page Structure > outreach page renders the header with correct title` | covered |
| EXP-048 | "New Batch" button is visible and enabled on desktop. Clicking it calls `POST /api/outreach/new-batch` to add fresh prospects to the queue. | `Page Structure > New Batch button is visible and enabled on desktop`, `Batch / Send Flow > "New Batch" button is visible and enabled on desktop` | covered |
| EXP-049 | After "New Batch" returns `{ added: N }` where N > 0, a success banner appears: "N fresh prospects added". | `Page Structure > New Batch button shows success banner when batch returns new contacts` | covered |
| EXP-050 | While "New Batch" is in-flight, the button shows "Loading…" and is disabled. After completion, it returns to "New Batch". | `Page Structure > New Batch button shows correct label when not loading` | partial |

---

## Section 12: Outreach Message Generation

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-051 | Pre-generated outreach message text is stored in Kissinger meta (`outreach_message`, `outreach_message_sender`, `outreach_message_generated_at`). Displayed on each active contact card. | (not directly E2E tested as message content assertion) | not covered |
| EXP-052 | If the message has not yet been generated, the card shows a "Message generating…" skeleton state and polls every 10 seconds. | (not directly E2E tested) | not covered |
| EXP-053 | Messages are generated server-side with role-aware openers (CEO/Founder, CFO, COO, generic) and sector-aware hooks (rail, eVTOL, EV battery, robotics, etc.). The sender angle is: Drew = technical, Ben = vision, Jake = strategic. | (unit-level logic, not E2E tested) | not covered |

---

## Section 13: Intro Path

| ID | Expectation | Tests | Coverage |
|----|-------------|-------|----------|
| EXP-054 | `hasIntroPath` flag is shown on the contact card if a warm intro path is found via BFS graph traversal in Kissinger. | (not directly E2E tested) | not covered |

---

## Coverage Summary

| Status | Count |
|--------|-------|
| covered | 27 |
| partial | 9 |
| not covered | 18 |
| **Total expectations** | **54** |

**Tests in `outreach.spec.ts`:** 30

Note: The original compiled list had 47 items; this document expands some into sub-expectations for precision. Several signals and message-generation behaviors are not yet covered by E2E tests — they are candidates for future test additions.

---

## Test Coverage Map

| Test name | EXP IDs covered |
|-----------|-----------------|
| Auth & Queue Scoping > unauthenticated users are redirected | EXP-001 |
| Auth & Queue Scoping > Jake sees his own queue, not Ben's or Drew's contacts | EXP-004, EXP-008 |
| Auth & Queue Scoping > queue is filtered to contacts tagged queue:jake | EXP-006 |
| Contact Data Display > each contact card shows full name, company name, stage label, and fit tier badge | EXP-011, EXP-015 |
| Contact Data Display > stage label is shown on each contact card | EXP-014 |
| Contact Data Display > LinkedIn URL is present on each contact card | EXP-017 |
| Contact Data Display > LinkedIn CSV contacts show company name resolved from org entity | EXP-012 |
| Contact Data Display > company name is not blank for any visible contact card | EXP-013 |
| LinkedIn Queue Button > button shows correct count of contacts with LinkedIn URLs | EXP-021 |
| LinkedIn Queue Button > button is enabled when queue count > 0 | EXP-024 |
| LinkedIn Queue Button > button is disabled when queue is empty | EXP-023 |
| LinkedIn Queue Button > search URLs count toward queue total | EXP-018, EXP-019 |
| Batch / Send Flow > "New Batch" button is visible and enabled on desktop | EXP-048 |
| Batch / Send Flow > "New Batch" contacts exclude COOs | EXP-009, EXP-010 |
| Batch / Send Flow > clicking "Mark Sent" optimistically removes contact | EXP-039 |
| Batch / Send Flow > after Mark Sent, contact moves to Sent tab | EXP-038 |
| Tabs > Active tab is selected by default and shows unsent contacts | EXP-030 |
| Tabs > Sent tab shows sent contacts with clickable name links | EXP-034, EXP-035 |
| Tabs > Sent tab shows stage labels | EXP-036 |
| Tabs > Sent tab shows contact count badge | EXP-037 |
| Tabs > Active tab shows only unsent contacts | EXP-031 |
| Tabs > switching to Active tab from Sent tab restores the task list | EXP-033 |
| Regression > BUG-1: All 16 of Jake's contacts appear | EXP-005 |
| Regression > BUG-2: Company name is populated for LinkedIn CSV contacts | EXP-012, EXP-013 |
| Regression > BUG-3: LinkedIn queue button count equals total Jake contacts | EXP-029 |
| Regression > BUG-3 variant: queue count shown in stat line matches actual contact count | EXP-006 |
| Page Structure > outreach page renders the header with correct title | EXP-047 |
| Page Structure > tab bar shows Active, Signals, and Sent tabs | EXP-032 |
| Page Structure > New Batch button shows correct label when not loading | EXP-050 |
| Page Structure > New Batch button shows success banner | EXP-049 |

---

## Adding New Expectations

When Drew describes a new behavior expectation, the `eloso-test-manager` agent will:
1. Add a new row to the appropriate section with the next sequential `EXP-NNN` ID
2. Set coverage to `not covered`
3. Write a corresponding test in `e2e/outreach.spec.ts`
4. Update the coverage to `covered` and add the test name to the coverage map

## Adding Tests for Uncovered Expectations

High-priority uncovered expectations for next test iteration:
- **EXP-016** — Contact sort order (fit-high first, alphabetical within tier)
- **EXP-022** — LinkedIn button label progression (K/M done format)
- **EXP-042 through EXP-046** — Full Signals tab coverage
- **EXP-051, EXP-052** — Message generation / polling skeleton state
