-- Fix: unique_active_assignment was a plain (non-partial) unique index on
-- (contactId, isActive). Since isActive is NOT NULL, that constraint didn't
-- just enforce "at most one active row per contact" -- it also capped
-- inactive (isActive = false) rows at one per contact, which is wrong:
-- inactive rows are the historical/deactivated record and a contact can
-- legitimately be deactivated more than once across its lifetime (e.g.
-- assign -> mark sent -> reassign -> mark sent again). The second
-- deactivation collided with the first deactivated row on the DB-level
-- unique constraint; because every dualWrite* function in
-- src/lib/outreach-dual-write.ts follows the "never throw, log + swallow"
-- contract, this failure was silently eaten -- Postgres tracking silently
-- and permanently stopped updating for the affected contact, with no error
-- surfaced anywhere.
--
-- Prisma's schema DSL has no partial/WHERE-scoped unique index, so this
-- migration is hand-authored (generated via `prisma migrate dev
-- --create-only` against a local scratch Postgres, then edited) to express
-- the real invariant directly in SQL: at most one row with isActive = true
-- per contactId, with unlimited isActive = false history rows allowed.
--
-- Verified against prod (2026-07-22) before authoring this migration: 0
-- contacts currently have 2+ active rows, and 0 contacts have 2+ inactive
-- rows -- this migration only relaxes the incorrect inactive-side
-- restriction and cannot conflict with any existing data.

-- DropIndex: the old plain unique index over-constrained inactive rows.
DROP INDEX "OutreachQueueEntry_contactId_isActive_key";

-- CreateIndex: plain (non-unique) index retained for query planning on
-- (contactId, isActive) lookups (e.g. dualWriteSkip/dualWriteNewBatchAssignment's
-- `updateMany({ where: { contactId, isActive: true } })`).
CREATE INDEX "OutreachQueueEntry_contactId_isActive_idx" ON "OutreachQueueEntry"("contactId", "isActive");

-- CreateIndex: the real invariant -- at most one ACTIVE queue entry per
-- contact. Scoped with a WHERE clause so it does not apply to inactive
-- (historical) rows.
CREATE UNIQUE INDEX "OutreachQueueEntry_contactId_active_unique" ON "OutreachQueueEntry"("contactId") WHERE "isActive" = true;
