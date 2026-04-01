# Gojiberry AI — Analysis & Cross-Reference with Eloso CRM PRD

**Date:** 2026-04-01
**Source:** [gojiberry.ai](https://gojiberry.ai) | [YC profile](https://www.ycombinator.com/companies/gojiberry-ai)

---

## What Gojiberry Is

Gojiberry AI is a YC-backed (P26 batch, 2025) **GTM brain for small sales teams**. It automates LinkedIn-centric outbound by:

- Monitoring **30+ intent signals** (new roles, competitor engagement, funding announcements, hiring spikes, LinkedIn post interactions)
- Filtering leads by ICP fit and scoring by intent
- Generating personalized outreach messages and running automated LinkedIn campaigns
- Booking demos autonomously, following up until a meeting is confirmed
- Syncing with Slack, HubSpot, and Pipedrive

**Pricing:**
- Pro: $99/seat/month (15+ LinkedIn intent signals, 1 LinkedIn account, unlimited campaigns)
- Elite: Custom pricing (unlimited signals, dedicated CSM, SLA guarantees, 10+ seats)

**Positioning:** "2–5× higher reply rates" via high-intent lead targeting. Targets founders, lean sales teams, and agencies.

---

## Cross-Reference: Gojiberry vs. Eloso CRM PRD

### Overlap Areas

| Feature | Gojiberry | Eloso CRM (PRD) |
|---|---|---|
| **ICP scoring** | Yes — auto-scores against ICP | Yes — ICP fit field per account (backlog model, AI agent usage, ERP stack) |
| **Intent signals** | 30+ LinkedIn signals (funding, roles, engagement) | Via Clay/scraping enrichment layer (§10.5) |
| **Outreach automation** | Fully automated LinkedIn campaigns | Not in scope — Eloso uses Gmail drafts (§8), not automation |
| **CRM sync** | HubSpot, Pipedrive | Eloso IS the CRM; not syncing to a third party |
| **AI-generated messages** | Yes — auto-sent | Yes — draft generation only (human review required, §8) |
| **Activity logging** | Limited — syncs to CRM | Core feature — meetings, emails, DMs, notes all logged per contact (§3.4) |
| **Slack notifications** | Yes — updates | Yes — daily digest, task assignments, staleness alerts (§6) |
| **Multi-stakeholder tracking** | No — contact-level only | Yes — 3–6 contacts per account, with role tagging (Economic Buyer, Champion, etc.) (§3.2) |
| **Deal stage tracking** | No | Yes — 9 defined engagement stages (§4) |
| **Meeting scheduling** | No | Yes — Google Calendar integration, availability polling (§9) |
| **Revenue tracking** | No | Yes — Discovery Fee + Estimated ACV (§5) |

---

## Key Differences

### 1. Market and Motion
Gojiberry is built for **volume outbound** — high-quantity LinkedIn prospecting aimed at booking demos at scale. It is a top-of-funnel tool.

Eloso CRM is built for **enterprise, low-volume, high-value** relationship management. The PRD explicitly states: *"The CRM is not a generic sales tool"* and designs around *"complex, multi-stakeholder enterprise relationships."* Gojiberry's model is fundamentally incompatible with Eloso's sales motion.

### 2. Automation Philosophy
Gojiberry auto-sends messages. Eloso PRD deliberately avoids this — §8 explicitly requires a human review moment before any email goes out, and positions this as intentional: *"Template-sounding language is explicitly avoided."* Gojiberry's automated outreach would be a liability in Eloso's context (outreach to CSCOs at $1B+ manufacturers).

### 3. Contact Depth
Gojiberry tracks leads as individual signal sources. Eloso tracks contacts as nested within accounts, with role types, relationship warmth scores, preferred communication channels, and rich activity history. This depth is absent from Gojiberry.

### 4. Intelligence Layer
Both use AI. Gojiberry uses it for signal detection and message generation. Eloso uses Claude Max for reasoning — synthesizing context across accounts, generating narrative digests (not raw task lists), and producing email drafts grounded in full relationship history.

---

## What Eloso Could Borrow from Gojiberry

1. **Intent signal taxonomy** — Gojiberry's 30+ signal types (funding events, role changes, competitor engagement, hiring spikes) are a useful reference for what to monitor when scanning Clay/web enrichment for Eloso's target accounts.

2. **Continuous ICP learning loop** — Gojiberry learns what ICP attributes correlate with conversions. Eloso's ICP scoring is currently static fields. A feedback loop from won/lost deals to ICP criteria could be valuable.

3. **LinkedIn DM integration** — Gojiberry runs LinkedIn campaigns natively. Eloso tracks LinkedIn DMs as manual activity logs (§3.4). Tighter LinkedIn integration could reduce manual logging friction.

---

## What Gojiberry Cannot Do That Eloso Requires

- Multi-stakeholder account management with role-aware contact maps
- Deal stage tracking and pipeline revenue reporting
- Granola meeting summary ingestion and auto-logging
- Google Calendar scheduling with multi-person availability
- Staleness detection with configurable thresholds per stage
- Intelligent contextual search across full account history

---

## Summary Verdict

Gojiberry and Eloso CRM serve **fundamentally different use cases** and are not competitors. Gojiberry is a top-of-funnel LinkedIn prospecting automation tool for volume outbound. Eloso is a deep-relationship intelligence platform for enterprise design partner recruitment.

The closest Gojiberry analog in Eloso's stack would be the Clay/scraping enrichment layer (§10.5) — Gojiberry's signal detection could theoretically feed enriched, high-intent accounts into Eloso's pipeline, but Eloso then takes over with a fundamentally different motion.

**Recommendation:** Eloso does not need to adjust its PRD in response to Gojiberry. The products are additive rather than competitive. The signal taxonomy from Gojiberry's 30+ intent signals is worth reviewing when defining what Clay lookups Eloso triggers for prospect enrichment.
