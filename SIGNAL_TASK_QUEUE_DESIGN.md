# Signal Task Queue Design

**Date:** 2026-05-02  
**Status:** Draft — for review by Drew (CTO) and Jake (strategic/governance)

---

## Problem Statement

Drew's complaint: Trigify LinkedIn signals don't show up in the task queue.

Currently:
- `trigify-daily-sync` runs at 07:00 UTC, writes `signal:post-engagement` tag + `last_signal_date` meta + a `NOTE` contact event to Kissinger
- The Outreach page shows `prospect-contact`-tagged people as actionable tasks
- Signals and outreach tasks are completely disconnected — there is no path from "this person posted about S&OP on LinkedIn today" to "someone should reach out to them today"

The gap: signals are written to Kissinger but the Outreach page never reads signal data. A prospect can signal daily and the rep sees nothing new.

---

## Data Model Decision

### Do NOT create a separate `signals` table or entity type.

Kissinger already has everything needed:
- `signal:post-engagement` tag on entity
- `last_signal_date` meta field (ISO string, updated each sync)
- Contact events with `createdBy: "trigify-sync"` and summary `Posted about "keyword": excerpt`

The problem is not missing data — it's missing surfacing. The fix is UI + query, not schema.

**One small addition:** The `fetchProspectContacts` query needs to pull `last_signal_date` meta for each person so the UI can distinguish "signalled recently" from "in queue but cold."

### Signal states for a prospect-contact:

| State | Definition |
|-------|------------|
| `hot` | `last_signal_date` within last 3 days AND not yet contacted |
| `warm` | `last_signal_date` within last 14 days AND not yet contacted |
| `cold` | No signal in 14 days, or already in outreach cadence |
| `signalled-in-cadence` | Has a recent signal AND is already at `touched_1+` |

---

## Interface Design

### Recommended approach: Signal badge + "Signals" tab in Outreach page

Keep the existing Outreach page structure. Extend it in two ways:

**1. Signal badges on OutreachTaskCard**

Each card already shows name/title/company/fitTier. Add a signal indicator:
- If `last_signal_date` within 3 days: amber lightning bolt + "Signalled 2d ago — via supply chain planning"
- If `last_signal_date` within 14 days: subtle green dot + relative date
- No badge if no recent signal

This gives Drew an at-a-glance view of which prospects are warm right now without any new pages.

**2. "Signals" tab in OutreachPageClient**

Add a new tab between "All" and "Sent":
- Tab label: `Signals` with count of hot/warm prospects (those with signal in last 14 days who haven't been contacted yet)
- Content: sorted list showing most-recently-signalled first
- Each item shows: name, title, company, keyword, post excerpt, signal date, intro path if exists
- Action buttons: "Draft Message", "Mark Irrelevant", "Snooze 7 days"

This directly addresses Drew's complaint — there's now a dedicated view where signals are tasks.

**What we're NOT building (proportionate to 3-user team):**
- Push notifications (Telegram digest already covers this)
- Separate signals dashboard page
- Complex scoring engine with ML
- Signal aggregation across multiple events (single most recent is enough)

---

## Workflow

When a rep sees a signal in the Signals tab:

```
Signal appears →
  [Draft Message] → pre-populates OutreachTaskCard with signal context in message
  [Open LinkedIn] → opens profile directly (same as current batch opener)
  [Snooze 7d]    → writes `signal_snoozed_until` meta, hides from tab until date passes
  [Not relevant] → writes `signal_dismissed` meta (boolean), removes from tab permanently
```

After drafting/sending → `recordOutreachTouch()` is called as normal → contact moves to touched_1 → disappears from Signals tab, appears in Sent.

**Feedback loop:** When a signal prompts outreach → the `outreach_stage` progression already tracks it. No new schema needed.

---

## Prioritization / Scoring

Keep it simple. Compute a `signalScore` at render time (no DB field needed):

```typescript
function signalScore(contact: ProspectContact): number {
  const ageDays = daysSince(contact.lastSignalDate);
  const recency = ageDays <= 1 ? 100 : ageDays <= 3 ? 80 : ageDays <= 7 ? 60 : ageDays <= 14 ? 40 : 0;
  const fit = { high: 30, medium: 15, low: 5 }[contact.fitTier] ?? 0;
  const hasIntroPath = contact.hasIntroPath ? 15 : 0;
  // Seniority bonus: C-level/VP/Director adds 10pts
  const senior = isSenior(contact.title) ? 10 : 0;
  return recency + fit + hasIntroPath + senior;
}
```

Sort Signals tab by `signalScore` descending. No user-visible score number — just the sort order.

**Signal strength displayed to user:** just the recency label ("Today", "2 days ago", "Last week") and the keyword. That's all a rep needs.

---

## Implementation Plan

### Phase 1 — Signals visible in Outreach (1 day of work)

**Goal:** Signals tab exists, signals appear there, reps can act on them.

**Step 1: Extend `fetchProspectContacts` in `kissinger.ts`** (~30 min)

Pull `last_signal_date`, `signal_dismissed`, and `signal_snoozed_until` from meta for each prospect person. Add these fields to `ProspectContactRaw` and `ProspectContact`.

```typescript
// Add to ProspectContactRaw:
lastSignalDate?: string;       // ISO from meta.last_signal_date
signalDismissed?: boolean;     // meta.signal_dismissed === "true"
signalSnoozedUntil?: string;   // ISO from meta.signal_snoozed_until
lastSignalKeyword?: string;    // meta.last_signal_keyword (needs sync-side write)
```

**Step 2: Write `last_signal_keyword` in `daily_sync.py`** (~15 min)

In `update_entity_tags_and_meta()` calls within `run_sync()`, also write:
```python
{"key": "last_signal_keyword", "value": keyword}
```
This lets the UI show "Signalled via supply chain planning" without fetching contact events.

**Step 3: Add signal scoring utility in `outreach.ts`** (~20 min)

```typescript
export function computeSignalScore(contact: ProspectContact): number { ... }
export function isHotSignal(contact: ProspectContact): boolean { ... }  // last 3 days
export function isWarmSignal(contact: ProspectContact): boolean { ... } // last 14 days
```

**Step 4: Filter + sort signals in `outreach/page.tsx`** (~20 min)

```typescript
// Signals = prospect-contacts with recent signal, not dismissed, not snoozed,
// and not yet contacted (outreachStage === "cold")
const signalContacts: ProspectContact[] = allMappedContacts
  .filter(c => isWarmSignal(c) && !c.signalDismissed && !isSnoozed(c) && c.outreachStage === "cold")
  .sort((a, b) => computeSignalScore(b) - computeSignalScore(a));
```

Pass `signalContacts` to `OutreachPageClient`.

**Step 5: Add "Signals" tab to `OutreachPageClient.tsx`** (~45 min)

- New `ActiveTab` value: `"Signals"`
- Tab added between "All" and "Sent" with count badge (highlighted amber if > 0)
- New `SignalsTaskList` component or reuse `OutreachTaskList` with signal-specific rendering

**Step 6: Add signal badge to `OutreachTaskCard`** (~30 min)

```tsx
{contact.lastSignalDate && isWarmSignal(contact) && (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 border border-amber-200">
    Signalled {relativeDate(contact.lastSignalDate)}
    {contact.lastSignalKeyword && ` · "${contact.lastSignalKeyword}"`}
  </span>
)}
```

**Step 7: Signal actions API routes** (~1 hour)

- `POST /api/signals/dismiss` → writes `signal_dismissed: "true"` via `mergeEntityMeta`
- `POST /api/signals/snooze` → writes `signal_snoozed_until: ISODate` via `mergeEntityMeta`

Both reuse the existing `mergeEntityMeta` function — no new Kissinger mutations needed.

**Total Phase 1: ~3.5 hours of focused implementation.**

---

### Phase 2 — Signal context in outreach messages (future, ~0.5 day)

When a rep clicks "Draft Message" from the Signals tab, pre-populate the outreach message with signal context:

```
"I saw your recent post about S&OP challenges — the part about forecast accuracy 
really resonated. We're building something that directly addresses..."
```

This requires passing `lastSignalKeyword` + signal excerpt into the `outreach-generate` API. The excerpt is already available as a contact event — fetch the most recent trigify event at message generation time.

---

### Phase 3 — Trigify-discovered prospects in Signals tab (future, ~0.5 day)

Currently `trigify-discovered` + `prospect` people are created but never tagged `prospect-contact`, so they never appear in Outreach at all. Two options:

**Option A (recommended):** Add a "Discovered" sub-section to the Signals tab showing `trigify-discovered` people. Simple filter — no tag change. Rep can promote them to `prospect-contact` with one click.

**Option B:** Auto-tag new Trigify discoveries as `prospect-contact`. Riskier — pollutes the outreach queue with unvetted contacts.

Option A gives Drew visibility into new discoveries without requiring any vetting automation.

---

## What NOT to build

- **Separate signals table:** Kissinger contact events are sufficient. Adding a parallel data store creates sync problems and is over-engineering for 3 users.
- **Real-time push notifications:** The existing Telegram digest at 07:00 UTC handles this. Adding browser push or Slack alerts is not worth it at this scale.
- **ML signal scoring:** The simple recency + fit + path formula is adequate. The database doesn't have enough history to train anything meaningful.
- **Signal aggregation views:** Showing "this person has signalled 5 times in 30 days" is a nice-to-have but not blocking Phase 1. Add to Phase 2 if demand warrants.

---

## Summary

The root cause of Drew's complaint is a query gap, not a data gap. Signals are in Kissinger — the Outreach page just doesn't read them.

Phase 1 fixes this in ~3.5 hours with no new backend infrastructure:
1. Extend `fetchProspectContacts` to pull signal meta
2. Write `last_signal_keyword` in `daily_sync.py`
3. Add Signals tab to Outreach page
4. Add signal badges to task cards
5. Add dismiss/snooze API routes

After Phase 1, opening the Outreach page every morning will show a Signals tab with today's warm prospects sorted by priority — directly actionable, directly connected to what Trigify found overnight.
