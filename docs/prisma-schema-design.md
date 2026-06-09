# Prisma Schema Design — Eloso Bisque Relational Persistence Layer

**Document status:** Design proposal (May 2026)
**Replaces:** Kissinger graph CRM (entities + meta + tags + edges) + Vercel KV (users + counters)
**Preserves:** SQLite booking schema (adapted to Prisma)
**Optimized for:** Entity listing, outreach queue management, and activity tracking

---

## 1. Design Principles

### 1.1 What is broken today and why

The Kissinger graph CRM is a general-purpose graph database forced to carry purpose-built CRM logic through two escape hatches — the `meta[]` key-value bag and free-form string tags. This creates four concrete pain points:

**Untyped attribute storage.** Every attribute beyond `name`, `kind`, `tags`, and `notes` lives in `meta[]` as a key-value pair of strings. Reading `outreach_stage` for a contact requires iterating the meta array and parsing the value as a string enum. There is no schema enforcement: a contact can have `outreach_stage = "touuched_1"` (typo), or have no `outreach_stage` key at all, and the system will not catch it. The frontend `_fetchProspectContacts` function is littered with `meta["outreach_stage"] ?? "cold"` fallbacks precisely because the store cannot enforce presence or type.

**Outreach state encoded as tags and meta, not a state machine.** Queue assignment (`queue:drew`, `queue:ben`, `queue:jake`) is a tag. Outreach stage (`cold`, `touched_1` … `responded`) is a meta string. Sent status is a tag (`outreach-sent`). These three overlapping signals require careful (and fragile) cross-referencing in `_fetchProspectContacts` and `_fetchSentContacts`. There is no single authoritative record of "who is assigned to whom, at what stage, since when."

**No referential integrity for assignments or touches.** There is no row linking a contact to a user for a queue assignment. There is no row for each outreach touch (message sent, timestamp, which message was used). Both are reconstructed from meta fields or derived from tag presence. This makes it impossible to query "how many touches did Drew send this week" without scanning all contacts.

**Activity counters in KV, not queryable rows.** Login events and outreach-sent events are stored as Vercel KV counters keyed by user+date. They are readable for the Activity Dashboard but cannot be queried (no filtering, no joins, no aggregations beyond what the code pre-computes).

### 1.2 What the relational schema solves

- Every domain concept becomes a first-class typed row with enforced constraints.
- Outreach queue state lives in a dedicated `OutreachQueueEntry` table with a proper enum state machine — one authoritative row per contact-user assignment.
- Each touch is a `OutreachTouch` row; each response is an `OutreachResponse` row. History is queryable.
- Activity events (logins, touches sent) are `ActivityLog` rows, enabling real SQL aggregations: "total touches by user this week", "contacts reached per day", "response rate by sender".
- Scores that are currently re-computed client-side on every render can be stored in typed fields with `Float` columns.
- Tags that serve as classification become proper foreign keys or enums: `OutreachStage`, `FunnelStage`, `FitTier`, `InvestorPipelineStage`.

### 1.3 What stays deliberately flexible

The graph structure — `knows` edges between people for intro path traversal — is not well-served by a relational schema. A `Relationship` table is included for direct typed relationships (works_at, knows), but BFS graph traversal for intro path computation would be more efficiently handled by a graph store or a recursive CTE. For the current team size this is acceptable in Postgres via a CTE, but the design keeps the graph data thin and queryable.

### 1.4 Target database

PostgreSQL (via Prisma ORM). The booking tables use SQLite today; they are adapted to Postgres here for a unified store. SQLite remains an option for local development by swapping the `datasource` block provider.

---

## 2. Entity Model — Full Prisma Schema

```prisma
// ============================================================
// datasource + generator
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// Enums
// ============================================================

/// Outreach cadence stage for a prospect contact.
/// Progresses linearly: cold → touched_1 → touched_2 → touched_3 → responded.
/// Contacts in state "responded" never re-enter the cold queue.
enum OutreachStage {
  cold
  touched_1
  touched_2
  touched_3
  responded
}

/// Sales funnel stage for prospect organizations (Kanban board).
enum FunnelStage {
  Identified
  Researched
  Contacted
  Engaged
  MeetingBooked
  ProposalSent
  ClosedNurture
}

/// Fundraising pipeline stage for investor firms.
enum InvestorPipelineStage {
  Research
  WarmIntro
  FirstMeeting
  PartnerMeeting
  TermSheet
  Closed
  Passed
}

/// ICP / investor fit tier — human-readable bucketing of computed scores.
enum FitTier {
  high
  medium
  low
}

/// Message angle — determines which value proposition framing is used.
enum MessageAngle {
  vision      // Ben (CEO) — market timing, big picture
  technical   // Drew (CTO) — implementation, integration
  strategic   // Jake (COO/CFO) — business outcomes, ROI
}

/// Response type when a prospect replies to outreach.
enum ResponseType {
  Interested
  NotNow
  WrongPerson
  NoReply
  Bounced
}

/// Contact event / CRM interaction kinds.
enum ContactEventKind {
  Note
  Meeting
  Email
  Call
  Custom
}

/// Activity event types for the Activity Dashboard.
enum ActivityEventType {
  Login
  OutreachTouchSent
  BatchPulled
  ResponseLogged
  ContactEnriched
}

/// Relationship types between entities.
enum RelationType {
  works_at
  knows
  funded_by
  part_of
  works_on
  ally
  champion
  advisor
  sponsor
  board_member
  referred_by
}

/// Signal action a user has taken on a Trigify signal.
enum SignalAction {
  snoozed
  dismissed
  engaged
}

// ============================================================
// User — internal team members (Ben, Jake, Drew)
// Previously split across Vercel KV (auth) + SQLite (activity)
// ============================================================

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  /// Outreach sector affinity — drives default queue assignment.
  /// e.g. ["defense", "evtol"] for Ben
  sectorAffinity String[] @default([])
  /// Message angle assigned to this user for outreach generation.
  messageAngle MessageAngle
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // Relations
  queueEntries     OutreachQueueEntry[]
  outreachTouches  OutreachTouch[]
  activityLogs     ActivityLog[]
  passwordResets   PasswordResetToken[]
}

// ============================================================
// PasswordResetToken — for forgot-password flow
// ============================================================

model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// ============================================================
// Organization — prospect companies and VC firms
// Previously: Kissinger entity (kind=org) with tags + meta[]
// ============================================================

model Organization {
  id          String  @id @default(cuid())
  /// Display name
  name        String
  /// External identifier from the original Kissinger graph (for migration cross-reference)
  kissingerId String? @unique

  // Classification — mutually exclusive; an org is either a prospect or a VC firm.
  isProspect  Boolean @default(false)
  isVcFirm    Boolean @default(false)
  isArchived  Boolean @default(false)

  // Common fields
  website     String?
  hq          String?   // "Austin, TX" — freeform location string
  notes       String?
  logoUrl     String?

  // Prospect-specific fields
  industry    String?   // e.g. "Aerospace & Defense"
  /// Primary sector slug — drives sector heatmap and assignment routing
  sectorPrimary String?
  employees   Int?
  /// Revenue as a float in USD (store normalised; display formatted)
  revenueUsd  Float?
  /// ICP score 0–100, stored after computation so listing queries can sort/filter
  icpScore    Float?
  /// Fit tier derived from icpScore
  fitTier     FitTier?
  /// Known number of suppliers in the graph (used for supply chain complexity scoring)
  knownSuppliers Int @default(0)
  /// Known number of customers in the graph
  knownCustomers Int @default(0)
  /// Apollo market size estimate for this sector (from Apollo data)
  apolloMarketSize Float?
  /// Sales funnel stage on the Kanban board
  funnelStage FunnelStage @default(Identified)
  funnelStageUpdatedAt DateTime?

  // VC-firm-specific fields
  /// Investment stage focus: "seed", "series-a", etc. (stored as freeform string
  /// because the taxonomy varies widely; enum would be too rigid)
  investmentStage  String?
  checkSize        String?   // "$500K–$3M" — kept as formatted string per existing UI
  thesis           String?
  sectorFit        String?   // freeform notes on sector alignment
  investorPipeline InvestorPipelineStage @default(Research)
  investorPipelineUpdatedAt DateTime?
  /// Investor fit score 0–100
  investorFitScore Float?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  contacts      Contact[]           // people who work here
  sectors       OrganizationSector[] // many-to-many sector tags
  tags          OrganizationTag[]
  relationships RelationshipTo[]    @relation("RelationshipTarget")
  relationships2 RelationshipFrom[] @relation("RelationshipSourceOrg")
  queueEntries  OutreachQueueEntry[]

  @@index([isProspect, isArchived])
  @@index([isVcFirm, isArchived])
  @@index([sectorPrimary])
  @@index([funnelStage])
  @@index([investorPipeline])
  @@index([icpScore])
}

// ============================================================
// Contact — individual people (prospect contacts, investor contacts, etc.)
// Previously: Kissinger entity (kind=person) with tags + meta[]
// ============================================================

model Contact {
  id          String  @id @default(cuid())
  name        String
  /// External identifier from the original Kissinger graph
  kissingerId String? @unique

  // Identity
  email       String?
  linkedinUrl String?
  /// Date the team member connected with this person on LinkedIn (ISO date string)
  linkedinConnectedOn String?
  title       String?
  /// Freeform location string from their LinkedIn profile
  location    String?

  // Classification
  isProspectContact Boolean @default(false)
  isInvestorContact Boolean @default(false)
  isArchived        Boolean @default(false)

  // Employer
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id])
  /// Role at the organization (extracted from works_at edge notes in Kissinger)
  roleAtOrg     String?
  /// Connection strength to the employer org (0.0–1.0)
  orgStrength   Float?

  // Notes
  notes       String?

  // Scores
  /// Eloso Fit Score 0–100 (contact-level)
  fitScore    Float?
  fitTier     FitTier?
  /// Investor Fit Score 0–100 (for investor contacts)
  investorFitScore Float?

  // Outreach stage — the contact's current position in the outreach cadence.
  // This is the authoritative stage value; OutreachQueueEntry also tracks
  // assignment-level metadata, but stage lives on the contact.
  outreachStage OutreachStage @default(cold)

  // Signal tracking (Trigify)
  lastSignalDate     DateTime?
  lastSignalKeyword  String?
  lastSignalUrl      String?
  signalDismissed    Boolean  @default(false)
  signalSnoozedUntil DateTime?

  // Investor-specific fields
  /// Inferred or explicit incentive description for investor contacts
  incentive        String?
  /// Warm intro path description (freeform notes on how to get introduced)
  warmIntroPath    String?
  /// Investor priority: "high", "medium", "low" (freeform for now; could be enum)
  priority         String?

  // Timestamps
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  tags             ContactTag[]
  queueEntries     OutreachQueueEntry[]
  touches          OutreachTouch[]
  responses        OutreachResponse[]
  generatedMessages GeneratedMessage[]
  signals          Signal[]
  events           ContactEvent[]
  relationshipsFrom RelationshipFrom[] @relation("RelationshipSourcePerson")
  relationshipsTo   RelationshipTo[]   @relation("RelationshipTargetPerson")

  @@index([isProspectContact, isArchived, outreachStage])
  @@index([isInvestorContact, isArchived])
  @@index([organizationId])
  @@index([lastSignalDate])
  @@index([fitScore])
}

// ============================================================
// Tagging — explicit join tables for contact and org tags.
// Replaces the free-form string tags array on Kissinger entities.
//
// Rationale: keeping tags as a join table (vs. String[] column) allows:
//   - Querying "all contacts with tag X" efficiently via an index
//   - Future tag normalization (canonical tag registry)
//   - Tag history/audit if needed
//
// For now the tag value is a plain string (no foreign key to a Tag master table)
// to keep migration simple. A tag normalization pass can follow.
// ============================================================

model ContactTag {
  contactId String
  tag       String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@id([contactId, tag])
  @@index([tag])
}

model OrganizationTag {
  organizationId String
  tag            String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@id([organizationId, tag])
  @@index([tag])
}

// ============================================================
// Sector — named industry verticals used for routing and heatmap.
// Previously: free-form tags like "defense", "evtol", "rail-transportation-equipment"
// ============================================================

model Sector {
  slug        String @id   // e.g. "defense-aerospace", "rail-transportation-equipment"
  displayName String       // e.g. "Aerospace & Defense", "Rail & Transportation"
  /// Which team member is the default assignee for contacts in this sector
  defaultAssignee String?  // "Ben" | "Jake" | "Drew"
  /// Apollo market size for this sector (for the heatmap tile)
  apolloMarketSize Float?

  organizations OrganizationSector[]

  @@index([defaultAssignee])
}

/// Many-to-many: an org can be in multiple sectors.
model OrganizationSector {
  organizationId String
  sectorSlug     String
  /// Whether this is the primary sector (used for sector_primary routing)
  isPrimary      Boolean @default(false)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  sector       Sector       @relation(fields: [sectorSlug], references: [slug], onDelete: Cascade)

  @@id([organizationId, sectorSlug])
  @@index([sectorSlug])
}

// ============================================================
// Relationship — typed edges between entities.
// Replaces Kissinger graph edges (works_at, knows, funded_by, etc.)
//
// Design note: A single Relationship table covers person→person,
// person→org, and org→org edges. The source and target are typed
// separately to allow the DB to enforce integrity without a
// polymorphic join. We use two nullable FKs (sourcePerson/sourceOrg,
// targetPerson/targetOrg) with a CHECK constraint (enforced at app
// layer in Prisma) that exactly one source and one target is set.
//
// For intro path BFS traversal (NET-5), a recursive CTE on this
// table is far more efficient than Kissinger's full graph scan.
// ============================================================

model RelationshipFrom {
  id           String       @id @default(cuid())
  relationType RelationType

  // Exactly one of sourcePersonId or sourceOrgId is set
  sourcePersonId String?
  sourceOrgId    String?
  sourcePerson   Contact?      @relation("RelationshipSourcePerson", fields: [sourcePersonId], references: [id], onDelete: Cascade)
  sourceOrg      Organization? @relation("RelationshipSourceOrg", fields: [sourceOrgId], references: [id], onDelete: Cascade)

  // Exactly one of targetPersonId or targetOrgId is set
  targetPersonId String?
  targetOrgId    String?
  targetPerson   Contact?      @relation("RelationshipTargetPerson", fields: [targetPersonId], references: [id], onDelete: Cascade)
  targetOrg      Organization? @relation("RelationshipTarget", fields: [targetOrgId], references: [id], onDelete: Cascade)

  /// Connection strength 0.0–1.0 (from Kissinger edge strength)
  strength Float  @default(0.5)
  /// Freeform context (e.g. role description from edge notes)
  notes    String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sourcePersonId, relationType])
  @@index([sourceOrgId, relationType])
  @@index([targetPersonId, relationType])
  @@index([targetOrgId, relationType])
  @@index([relationType])
}

// Alias type for target-side reverse lookup (Prisma requires separate relation names)
model RelationshipTo {
  id           String       @id @default(cuid())
  relationType RelationType

  sourcePersonId String?
  sourceOrgId    String?

  targetPersonId String?
  targetOrgId    String?
  targetPerson   Contact?      @relation("RelationshipTargetPerson2", fields: [targetPersonId], references: [id], onDelete: Cascade)
  targetOrg      Organization? @relation("RelationshipTarget2", fields: [targetOrgId], references: [id], onDelete: Cascade)

  strength Float  @default(0.5)
  notes    String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([targetPersonId, relationType])
  @@index([targetOrgId, relationType])
}

// ============================================================
// OutreachQueueEntry — a contact assigned to a user's outreach queue.
//
// Previously modeled as: tag "queue:drew" on the contact entity.
//
// One row = one assignment. A contact can only be in one user's
// queue at a time (enforced by unique constraint on contactId).
// Re-assignment creates a new row (old row is deactivated via isActive).
//
// Key invariant: at most ONE active queue entry per contact at any time.
// The "New Batch" operation creates N new rows for the calling user.
// The "Skip" action soft-deletes the row (isActive=false) without
// recording a touch.
// ============================================================

model OutreachQueueEntry {
  id         String   @id @default(cuid())
  contactId  String
  userId     String
  /// The organization this contact belongs to (denormalized for list queries)
  organizationId String?

  isActive   Boolean  @default(true)
  /// Why the entry was deactivated, if applicable
  deactivatedReason String? // "skipped" | "sent" | "responded" | "reassigned"

  /// Snapshot of the contact's outreach stage at assignment time
  stageAtAssignment OutreachStage @default(cold)
  /// Current stage (mirrors Contact.outreachStage; kept here for queue-level queries)
  currentStage      OutreachStage @default(cold)

  assignedAt   DateTime @default(now())
  deactivatedAt DateTime?
  updatedAt    DateTime @updatedAt

  contact      Contact      @relation(fields: [contactId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id])
  organization Organization? @relation(fields: [organizationId], references: [id])
  touches      OutreachTouch[]

  // At most one active entry per contact
  @@unique([contactId, isActive], name: "unique_active_assignment")
  @@index([userId, isActive, currentStage])
  @@index([userId, isActive])
  @@index([contactId])
}

// ============================================================
// OutreachTouch — a single sent outreach message (T1, T2, T3).
//
// Previously: outreach_stage meta field advanced on the entity; no
// individual touch record existed. This makes it impossible to query
// "how many touches did Drew send today" without scanning all contacts.
//
// One row = one message sent. The touchNumber (1, 2, 3) corresponds
// to the T1/T2/T3 cadence. The message body at time of send is stored
// here for historical fidelity (generated messages may be regenerated).
// ============================================================

model OutreachTouch {
  id              String   @id @default(cuid())
  contactId       String
  queueEntryId    String?
  userId          String   // who sent it
  touchNumber     Int      // 1, 2, or 3
  /// The message text as actually sent (snapshot)
  messageBody     String?
  /// Reference to the stored GeneratedMessage (if AI-generated)
  generatedMessageId String?
  /// The angle used for this message
  angle           MessageAngle?
  /// Stage before this touch
  stageBeforeTouch OutreachStage
  /// Stage after this touch (advanced by mutation)
  stageAfterTouch  OutreachStage
  sentAt          DateTime @default(now())
  createdAt       DateTime @default(now())

  contact        Contact            @relation(fields: [contactId], references: [id], onDelete: Cascade)
  queueEntry     OutreachQueueEntry? @relation(fields: [queueEntryId], references: [id])
  user           User               @relation(fields: [userId], references: [id])
  generatedMessage GeneratedMessage? @relation(fields: [generatedMessageId], references: [id])

  @@index([contactId])
  @@index([userId, sentAt])
  @@index([sentAt])
}

// ============================================================
// OutreachResponse — a prospect's response to outreach.
//
// Previously: "responded" stage encoded in meta; no response type
// or notes stored. The response type (Interested, NotNow, etc.)
// determines the next action in the sales workflow.
// ============================================================

model OutreachResponse {
  id           String       @id @default(cuid())
  contactId    String
  userId       String?      // who logged the response (null = system)
  responseType ResponseType
  notes        String?
  respondedAt  DateTime     @default(now())
  createdAt    DateTime     @default(now())

  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId])
  @@index([responseType])
  @@index([respondedAt])
}

// ============================================================
// GeneratedMessage — AI-generated or template-based outreach messages.
//
// Previously: outreach_message + outreach_message_generated_at +
// outreach_message_sender stored as meta fields on the person entity.
// Only ONE message per contact existed (last generated wins).
//
// Now: each generation creates a new row. The contact's current
// "active" message is the most recent non-superseded row.
// Message versioning enables A/B analysis and regeneration auditing.
// ============================================================

model GeneratedMessage {
  id          String       @id @default(cuid())
  contactId   String
  /// Which team member's angle/persona this was generated for
  angle       MessageAngle
  /// "ai" or "template"
  generationMethod String   @default("template")
  /// The model used for AI generation (e.g. "claude-opus-4-5")
  modelId     String?
  messageBody String
  /// Whether this is the currently active message for this contact+angle combo
  isActive    Boolean      @default(true)
  generatedAt DateTime     @default(now())
  createdAt   DateTime     @default(now())

  contact Contact        @relation(fields: [contactId], references: [id], onDelete: Cascade)
  touches OutreachTouch[]

  @@index([contactId, angle, isActive])
  @@index([contactId, isActive])
}

// ============================================================
// Signal — Trigify LinkedIn post engagement signals.
//
// Previously: last_signal_date, last_signal_keyword, last_signal_url,
// signal_dismissed, signal_snoozed_until stored as meta fields — only
// the MOST RECENT signal was surfaced. Full signal history was visible
// only as Kissinger "interactions" created by the trigify-sync job.
//
// Now: each signal is a row. The Outreach Signals tab queries for
// signals within the last 14 days where action != dismissed.
// ============================================================

model Signal {
  id          String   @id @default(cuid())
  contactId   String
  keyword     String
  postUrl     String?
  /// Excerpt of the LinkedIn post content
  postSnippet String?
  signalDate  DateTime

  // User action on this signal
  action         SignalAction?
  actionBy       String?      // userId
  snoozedUntil   DateTime?
  actionAt       DateTime?

  createdAt DateTime @default(now())

  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId, signalDate])
  @@index([signalDate])
  @@index([action])
}

// ============================================================
// ContactEvent — CRM interaction timeline (meetings, calls, emails, notes).
//
// Previously: Kissinger "interactions" with kind/occurredAt/subject/notes.
// These are not outreach touches — they are logged CRM events.
// ============================================================

model ContactEvent {
  id         String           @id @default(cuid())
  contactId  String
  kind       ContactEventKind
  notes      String?
  subject    String?
  occurredAt DateTime
  /// User who logged the event (null = system/import)
  loggedBy   String?
  createdAt  DateTime         @default(now())

  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([contactId, occurredAt])
}

// ============================================================
// ActivityLog — queryable replacement for Vercel KV activity counters.
//
// Previously: kv.incr("outreach:sent:drew:2026-05-25") per day.
// Now: one row per event, with full metadata.
//
// This enables:
//   - SELECT COUNT(*) WHERE userId=X AND eventType=OutreachTouchSent AND createdAt > 7d
//   - 7-day heatmap via GROUP BY DATE(createdAt)
//   - All-time totals
//   - Per-contact, per-user, per-week breakdowns
// ============================================================

model ActivityLog {
  id        String            @id @default(cuid())
  userId    String
  eventType ActivityEventType
  /// Optional reference to the contact involved (for outreach events)
  contactId String?
  /// Free-form metadata bag for event-specific details (small, not replacing typed fields)
  metadata  Json?
  createdAt DateTime          @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([userId, eventType, createdAt])
  @@index([eventType, createdAt])
  @@index([createdAt])
}

// ============================================================
// Booking system — adapted from SQLite schema to Prisma/Postgres.
// The logic is identical; only the types change (TEXT → String,
// INTEGER booleans → Boolean, SQLite datetime defaults → @default(now())).
// ============================================================

model Booking {
  id              String   @id @default(cuid())
  guestName       String
  guestEmail      String
  guestNotes      String   @default("")
  startUtc        DateTime
  endUtc          DateTime
  durationMinutes Int
  timezone        String   // IANA tz string, e.g. "America/New_York"
  status          BookingStatus @default(confirmed)
  cancelToken     String   @unique
  rescheduleToken String   @unique
  cancelTokenUsed     Boolean @default(false)
  rescheduleTokenUsed Boolean @default(false)
  reminder24hSent Boolean @default(false)
  reminder1hSent  Boolean @default(false)
  /// If this guest was matched to a Contact in the CRM, link here
  contactId       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  contact Contact? @relation(fields: [contactId], references: [id])

  @@index([startUtc])
  @@index([status])
  @@index([cancelToken])
  @@index([rescheduleToken])
  @@index([status, startUtc, reminder24hSent, reminder1hSent])
}

// Booking relation on Contact (reverse side)
// (Add to Contact model above: bookings Booking[])

enum BookingStatus {
  confirmed
  cancelled
  rescheduled
}

model AvailabilityConfig {
  id                  Int      @id @default(1)
  workingDays         String[] @default(["Mon", "Tue", "Wed", "Thu", "Fri"])
  startTime           String   @default("09:00") // HH:MM in host's local tz
  endTime             String   @default("17:00")
  slotDurationMinutes Int      @default(30)
  bufferMinutes       Int      @default(15)
  timezone            String   @default("America/New_York")
  bookingHorizonDays  Int      @default(60)
  minNoticeHours      Int      @default(2)
  updatedAt           DateTime @updatedAt
}

model BlockedDate {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  reason    String   @default("")
  createdAt DateTime @default(now())

  @@unique([date])
}
```

---

## 3. Rationale for Key Decisions

### 3.1 Outreach state machine

The current system has three overlapping sources of truth for a contact's outreach status: the `outreach_stage` meta field (string), the `outreach-sent` tag, and the `queue:user` tag. The `_fetchSentContacts` function has to reconcile all three to build the Sent tab.

The new schema centralizes this into two tables:

- `Contact.outreachStage` — the authoritative current stage enum. This is the single value the UI reads to determine what stage badge to show and what action buttons to present.
- `OutreachQueueEntry` — one row per assignment, with `isActive` flag and `deactivatedReason`. This replaces `queue:drew` tags. The row is deactivated (not deleted) when a contact is skipped or sent, preserving history. The unique constraint `(contactId, isActive=true)` enforces the invariant that a contact can only be in one user's active queue at a time.
- `OutreachTouch` — one row per sent touch. The "Mark Sent (T1/T2/T3)" action creates a row here AND advances `Contact.outreachStage`. This separates the write of "touch happened" from the read of "current stage."

The state machine transition enforced at the application layer:

```
cold → [Mark Sent T1] → touched_1 → [Mark Sent T2] → touched_2 → [Mark Sent T3] → touched_3
                                                                              ↓
                                                                     [Log Response]
                                                                          ↓
                                                                       responded
```

Contacts in `responded` state are excluded from the active queue. They still have an `OutreachQueueEntry` row (deactivated) and an `OutreachResponse` row.

### 3.2 Queue assignment: `OutreachQueueEntry` design choices

The "New Batch" operation currently pulls 12 contacts from the global Kissinger pool and assigns them by writing `queue:drew` tags on each entity. This is a batch write of up to 12 GraphQL mutations. In the new schema, it is a single `createMany` on `OutreachQueueEntry`.

The `deactivatedReason` field captures why the assignment ended: `"skipped"` (user clicked Skip), `"sent"` (first touch sent, contact moved to Sent tab), `"responded"` (contact replied), `"reassigned"` (contact moved to another user). This history enables future analysis: "what fraction of Drew's queue does he actually send to?"

The `organizationId` on `OutreachQueueEntry` is a denormalization for list query performance. The Outreach Active tab needs to render each card with the org's sector tags (for assignment routing). Without this denormalization, every queue entry would require a join through `Contact → Organization`. Since org rarely changes for a contact, this is safe.

### 3.3 Tagging strategy — join table vs. array column

The schema uses join tables (`ContactTag`, `OrganizationTag`) instead of `String[]` array columns for two reasons:

First, Postgres `String[]` columns cannot be indexed for "contains" queries efficiently. `WHERE 'defense' = ANY(tags)` cannot use a B-tree index. A join table with an index on `tag` makes `SELECT * FROM OrganizationTag WHERE tag = 'defense'` a fast index scan.

Second, join tables enable future normalization (a canonical `Tag` master table with display name, category, color) without a data migration.

The downside is more complex queries for "give me all tags for this contact" — that is now a join. For the contact detail page this is fine. For the listing page, tags can be aggregated with a `GROUP_CONCAT` or loaded via Prisma's `include: { tags: true }`.

### 3.4 Sector model

`Sector` is now a first-class model rather than a free-form string. The `slug` field (`defense-aerospace`, `rail-transportation-equipment`) is the stable identifier used in code. The `displayName` is the human-readable label shown in the UI. The `defaultAssignee` field encodes the sector-to-user routing table that currently lives as `SECTOR_PREFERENCE` in `outreach.ts`.

`OrganizationSector` is a many-to-many join so an org can belong to multiple sectors. The `isPrimary` flag marks which sector is the `sector_primary` (used for the heat map and routing logic).

### 3.5 Scores — stored vs. computed

Currently all scores (Eloso Fit, ICP, Investor Fit) are computed client-side on every render from raw Kissinger meta. This means:

- The listing page cannot sort by score server-side (no score in the list query result)
- Every page load re-runs the scoring computation for potentially hundreds of contacts
- The "★ Score" sort on the Contacts page loads all contacts and sorts in JavaScript

The new schema stores computed scores in `Contact.fitScore`, `Organization.icpScore`, and `Organization.investorFitScore` as `Float` columns. A background job (or post-enrichment hook) recomputes scores when relevant fields change. The listing queries can then `ORDER BY fitScore DESC LIMIT 50` server-side.

Scores are still computed with the same six-factor/five-factor logic from `score-contact.ts` and `score-prospect.ts` — the schema just adds persistence.

### 3.6 Signal model — full history vs. latest-only

Kissinger stores only the most recent signal per contact (four meta fields: `last_signal_date`, `last_signal_keyword`, `last_signal_url`, `signal_dismissed`). The full signal history is buried in Kissinger interaction records created by the `trigify-sync` job.

The `Signal` table stores every signal as a row. The Trigify daily sync job inserts new rows. The Outreach Signals tab queries:

```sql
SELECT * FROM Signal
WHERE signalDate > NOW() - INTERVAL '14 days'
  AND action IS DISTINCT FROM 'dismissed'
  AND (action IS NULL OR (action = 'snoozed' AND snoozedUntil < NOW()))
ORDER BY signalDate DESC
LIMIT 50
```

This is a single indexed query vs. the current approach of: scan all 7k+ person entities, load their meta, filter by `last_signal_date` within 14 days, then batch 10-at-a-time detail fetches. The performance improvement is significant.

### 3.7 ActivityLog — rows instead of KV counters

Vercel KV stores activity as day-bucketed counters: `outreach:sent:drew:2026-05-25 = 3`. To render the 7-day heatmap, the dashboard reads 7 × 3 = 21 keys per metric type.

The `ActivityLog` table stores one row per event. The 7-day heatmap query:

```sql
SELECT
  DATE(createdAt) as day,
  userId,
  COUNT(*) FILTER (WHERE eventType = 'OutreachTouchSent') as outreach_sent,
  COUNT(*) FILTER (WHERE eventType = 'Login') as logins
FROM ActivityLog
WHERE createdAt > NOW() - INTERVAL '7 days'
GROUP BY DATE(createdAt), userId
```

This replaces 21 KV lookups with a single aggregation query. All-time totals are `SELECT COUNT(*)` with a WHERE clause. The schema is future-proof: adding a new event type (`ContactEnriched`, `BatchPulled`) adds one row per event, not a new KV key namespace.

### 3.8 GeneratedMessage versioning

The current system overwrites the single `outreach_message` meta field on each regeneration. This means there is no history of what message was previously used, no way to compare message versions, and no way to tell whether the message currently stored was ever actually sent.

`GeneratedMessage` stores each generation as a row. The `isActive` flag marks the current message for a given `(contactId, angle)` pair. When a message is regenerated, the old row is set `isActive=false` and a new row is inserted. `OutreachTouch.generatedMessageId` links a sent touch to the exact message that was used.

### 3.9 Relationship table design

The `RelationshipFrom` table is a generalized edge table covering person→person (`knows`), person→org (`works_at`), and org→org (`funded_by`, `part_of`). Two nullable foreign keys (`sourcePersonId`, `sourceOrgId`) with application-layer validation that exactly one is set avoids a polymorphic JOIN pattern while keeping the table unified.

For intro path BFS (the shortest path from any team member to a target contact), a recursive CTE on this table works as follows:

```sql
WITH RECURSIVE intro_path AS (
  SELECT sourcePersonId, targetPersonId, 1 as hops, ARRAY[sourcePersonId] as path
  FROM RelationshipFrom
  WHERE sourcePersonId IN (team_member_ids) AND relationType = 'knows'

  UNION ALL

  SELECT r.sourcePersonId, r.targetPersonId, ip.hops + 1, ip.path || r.sourcePersonId
  FROM RelationshipFrom r
  JOIN intro_path ip ON r.sourcePersonId = ip.targetPersonId
  WHERE r.relationType = 'knows'
    AND NOT r.targetPersonId = ANY(ip.path)
    AND ip.hops < 5
)
SELECT * FROM intro_path WHERE targetPersonId = $target_id ORDER BY hops LIMIT 1
```

This replaces the Kissinger `introPath` GraphQL query. Performance depends on the density of `knows` edges; for the current dataset this is bounded.

---

## 4. Migration Notes

### 4.1 Migration phases

**Phase 1: Stand up the new schema alongside Kissinger**

Run `prisma migrate dev` to create all tables in a Postgres instance. The new schema is additive — Kissinger is not touched. The `kissingerId` field on `Contact` and `Organization` is the foreign key linking old and new records throughout the migration.

**Phase 2: Write a migration script**

A one-time Node.js script reads all Kissinger entities via GraphQL and inserts rows into the new schema. For each entity:

- `kind=person` → `Contact` row, with meta fields mapped to typed columns, tags mapped to `ContactTag` rows.
- `kind=org` → `Organization` row, with classification inferred from tags (`vc`/`investor` → `isVcFirm`, `prospect` → `isProspect`).
- `works_at` edges → `RelationshipFrom` rows + `Contact.organizationId` + `Contact.roleAtOrg`.
- `knows` edges → `RelationshipFrom` rows with `relationType=knows`.
- `queue:drew`/`queue:ben`/`queue:jake` tags → `OutreachQueueEntry` rows for each active assignment.
- `outreach_stage` meta → `Contact.outreachStage` enum (map string to enum; default `cold` for unrecognized values).
- `outreach_message` meta → `GeneratedMessage` row with `isActive=true`.
- Trigify interaction events → `Signal` rows.
- Non-Trigify interactions → `ContactEvent` rows.
- `pipeline_stage` meta on investor firms → `Organization.investorPipeline` enum.
- `funnel_stage` meta on prospect orgs → `Organization.funnelStage` enum.

**Phase 3: Dual-write period**

During the transition, mutation API routes write to both Kissinger (for backward compatibility) and the new Postgres store. Read paths are migrated page by page:

1. Activity Dashboard — migrates first (simplest: replace KV counters with `ActivityLog` queries)
2. Outreach queue — migrates second (highest pain point; `OutreachQueueEntry` + `OutreachTouch`)
3. Contacts listing — migrates third (highest complexity; replaces full Kissinger entity scan)
4. Sectors heatmap — migrates with Contacts listing (uses same entity data)
5. Investors section — migrates fourth
6. Contact detail / Funnel Kanban — migrates last (requires relationship data to be fully populated)

**Phase 4: Cut over and decommission Kissinger**

Once all read paths are migrated and dual-write has been stable for 2+ weeks, remove the Kissinger write path. The Kissinger GraphQL endpoint can be kept in read-only mode temporarily as a rollback option, then decommissioned.

### 4.2 Meta field mapping table

| Kissinger meta key | New column | Model |
|---|---|---|
| `title` | `title` | `Contact` |
| `email` | `email` | `Contact` |
| `linkedin_url` / `linkedin` | `linkedinUrl` | `Contact` |
| `connected_on` | `linkedinConnectedOn` | `Contact` |
| `location` | `location` | `Contact` |
| `company` / `org` | `organizationId` (via lookup) | `Contact` |
| `outreach_stage` | `outreachStage` (enum) | `Contact` |
| `outreach_message` | `messageBody` | `GeneratedMessage` |
| `outreach_message_generated_at` | `generatedAt` | `GeneratedMessage` |
| `outreach_message_sender` | `angle` (via user→angle map) | `GeneratedMessage` |
| `last_signal_date` | `signalDate` | `Signal` |
| `last_signal_keyword` | `keyword` | `Signal` |
| `last_signal_url` | `postUrl` | `Signal` |
| `signal_dismissed` | `action=dismissed` | `Signal` |
| `signal_snoozed_until` | `snoozedUntil`, `action=snoozed` | `Signal` |
| `industry` | `industry` | `Organization` |
| `hq` / `location` | `hq` | `Organization` |
| `employees` | `employees` (Int) | `Organization` |
| `revenue` | `revenueUsd` (Float, parsed) | `Organization` |
| `website` | `website` | `Organization` |
| `sector_primary` | `sectorPrimary` + `OrganizationSector` | `Organization` |
| `known_suppliers` | `knownSuppliers` (Int) | `Organization` |
| `known_customers` | `knownCustomers` (Int) | `Organization` |
| `pipeline_stage` | `investorPipeline` (enum) | `Organization` |
| `stage` (investor) | `investmentStage` | `Organization` |
| `check_size` | `checkSize` | `Organization` |
| `thesis` | `thesis` | `Organization` |
| `sector_fit` | `sectorFit` | `Organization` |
| `warm_intro_path` | `warmIntroPath` | `Contact` |
| `priority` | `priority` | `Contact` |
| `incentive` | `incentive` | `Contact` |
| `funnel_stage` | `funnelStage` (enum) | `Organization` |

### 4.3 Tag mapping

| Kissinger tag | New representation |
|---|---|
| `prospect` | `Organization.isProspect = true` |
| `vc`, `investor` | `Organization.isVcFirm = true` |
| `prospect-contact` | `Contact.isProspectContact = true` |
| `outreach-sent` | `OutreachQueueEntry.deactivatedReason = "sent"` |
| `queue:drew` | `OutreachQueueEntry.userId = drew_user_id` |
| `queue:ben` | `OutreachQueueEntry.userId = ben_user_id` |
| `queue:jake` | `OutreachQueueEntry.userId = jake_user_id` |
| `fit-high` | `Contact.fitTier = high` / `Organization.fitTier = high` |
| `fit-medium` | `Contact.fitTier = medium` / `Organization.fitTier = medium` |
| `fit-low` | `Contact.fitTier = low` / `Organization.fitTier = low` |
| `signal:post-engagement` | Presence of `Signal` rows for the contact |
| `defense`, `evtol`, etc. | `OrganizationSector` rows |
| All other tags | `ContactTag` or `OrganizationTag` rows |

### 4.4 Booking migration

The SQLite booking schema is largely compatible. The differences:

- `id TEXT PRIMARY KEY` → `id String @id @default(cuid())` (CUIDs are compatible with UUIDs for external references; existing UUID values can be imported verbatim by using `@id` without `@default`)
- SQLite `INTEGER 0|1` booleans → Postgres `Boolean`
- SQLite `TEXT` timestamps → Postgres `DateTime`
- The `kissinger_contact_id` column becomes `contactId` (FK to `Contact`)

The `AvailabilityConfig` singleton row migrates directly. The `BlockedDate` table migrates directly.

---

## 5. What Stays in Kissinger (If Anything)

The recommendation is a **full replacement** of Kissinger for all CRM data within 3–6 months of migration. There is no persistent value in maintaining Kissinger as a parallel store after the dual-write period completes.

The one area where Kissinger provides value not replicated here is **full-text search** across entity names, tags, and meta. The relational schema does not include a search index. Options:

1. **Postgres full-text search** (`tsvector`/`to_tsquery`) on `Contact.name`, `Contact.title`, `Contact.notes`, `Organization.name`, `Organization.notes` — adequate for the current 8k-contact scale.
2. **Algolia or Typesense** as a dedicated search layer, populated by a sync on write.
3. **Keep Kissinger read-only for search only** — simplest transition path; decommission after option 1 or 2 is implemented.

**Intro path BFS** is the second area. The `RelationshipFrom` table supports recursive CTE traversal in Postgres, but graph algorithms run better in dedicated graph stores. For the current team size (3 users, ~8k contacts, sparse `knows` edges) a recursive CTE is sufficient. If the network grows to millions of edges, migrating the `knows` relationship to a dedicated graph store would be warranted.

**Kissinger interaction events** are migrated to `ContactEvent` and `Signal` rows. After migration, Kissinger interactions are no longer needed.

In summary: Kissinger is fully replaced by the Postgres schema. Full-text search is the only feature that requires an explicit implementation decision before decommissioning Kissinger.
