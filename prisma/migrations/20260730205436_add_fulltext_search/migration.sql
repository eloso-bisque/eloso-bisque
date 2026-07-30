-- Postgres full-text search for the Contacts page search box, replacing
-- Kissinger's searchKissinger() (see docs/prisma-schema-design.md section 5,
-- "What Stays in Kissinger" -- full-text search was the one CRM feature with
-- no Postgres equivalent when that doc was written).
--
-- Prisma's schema DSL has no first-class tsvector/generated-column support,
-- so -- following the same hand-authored-migration approach as
-- prisma/migrations/20260722114253_fix_outreach_queue_partial_unique_active_assignment
-- -- this migration was generated via `prisma migrate dev --create-only`
-- against a scratch Postgres container (replaying all prior migrations
-- first), then hand-edited to turn the plain `tsvector` columns Prisma
-- proposed into real GENERATED ALWAYS AS ... STORED columns with GIN
-- indexes. The schema.prisma side models both columns as
-- `Unsupported("tsvector")?` so Prisma Client never attempts to read or
-- write them directly -- all access goes through src/lib/contacts-search.ts
-- via $queryRaw.
--
-- Column choice matches the doc's recommendation exactly: Contact.name +
-- Contact.title + Contact.notes, and Organization.name + Organization.notes
-- (Organization has no title field). Each field is setweight()-tagged
-- ('A' for name, 'B' for title, 'C' for notes) so ts_rank() naturally scores
-- a name match above a notes match -- e.g. searching "aerospace" ranks an
-- org named "Acme Aerospace" above one whose notes merely mention the word.
-- Using STORED generated columns (rather than a plain index-only
-- expression) means the tsvector is computed once per write and reused on
-- every read.

-- AlterTable: Organization -- generated, weighted tsvector over name (A) + notes (C).
ALTER TABLE "Organization"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("notes", '')), 'C')
  ) STORED;

-- CreateIndex: GIN index for ts_rank / @@ query support on Organization.
CREATE INDEX "Organization_searchVector_idx" ON "Organization" USING GIN ("searchVector");

-- AlterTable: Contact -- generated, weighted tsvector over name (A) + title (B) + notes (C).
ALTER TABLE "Contact"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("title", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("notes", '')), 'C')
  ) STORED;

-- CreateIndex: GIN index for ts_rank / @@ query support on Contact.
CREATE INDEX "Contact_searchVector_idx" ON "Contact" USING GIN ("searchVector");
