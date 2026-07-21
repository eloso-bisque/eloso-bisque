-- CreateEnum
CREATE TYPE "OutreachStage" AS ENUM ('cold', 'touched_1', 'touched_2', 'touched_3', 'responded');

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('Identified', 'Researched', 'Contacted', 'Engaged', 'MeetingBooked', 'ProposalSent', 'ClosedNurture');

-- CreateEnum
CREATE TYPE "InvestorPipelineStage" AS ENUM ('Research', 'WarmIntro', 'FirstMeeting', 'PartnerMeeting', 'TermSheet', 'Closed', 'Passed');

-- CreateEnum
CREATE TYPE "FitTier" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "MessageAngle" AS ENUM ('vision', 'technical', 'strategic');

-- CreateEnum
CREATE TYPE "ResponseType" AS ENUM ('Interested', 'NotNow', 'WrongPerson', 'NoReply', 'Bounced');

-- CreateEnum
CREATE TYPE "ContactEventKind" AS ENUM ('Note', 'Meeting', 'Email', 'Call', 'Custom');

-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM ('Login', 'OutreachTouchSent', 'BatchPulled', 'ResponseLogged', 'ContactEnriched');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('works_at', 'knows', 'funded_by', 'part_of', 'works_on', 'ally', 'champion', 'advisor', 'sponsor', 'board_member', 'referred_by');

-- CreateEnum
CREATE TYPE "SignalAction" AS ENUM ('snoozed', 'dismissed', 'engaged');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('confirmed', 'cancelled', 'rescheduled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "sectorAffinity" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageAngle" "MessageAngle" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kissingerId" TEXT,
    "isProspect" BOOLEAN NOT NULL DEFAULT false,
    "isVcFirm" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "hq" TEXT,
    "notes" TEXT,
    "logoUrl" TEXT,
    "industry" TEXT,
    "sectorPrimary" TEXT,
    "employees" INTEGER,
    "revenueUsd" DOUBLE PRECISION,
    "icpScore" DOUBLE PRECISION,
    "fitTier" "FitTier",
    "knownSuppliers" INTEGER NOT NULL DEFAULT 0,
    "knownCustomers" INTEGER NOT NULL DEFAULT 0,
    "apolloMarketSize" DOUBLE PRECISION,
    "funnelStage" "FunnelStage" NOT NULL DEFAULT 'Identified',
    "funnelStageUpdatedAt" TIMESTAMP(3),
    "investmentStage" TEXT,
    "checkSize" TEXT,
    "thesis" TEXT,
    "sectorFit" TEXT,
    "investorPipeline" "InvestorPipelineStage" NOT NULL DEFAULT 'Research',
    "investorPipelineUpdatedAt" TIMESTAMP(3),
    "investorFitScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kissingerId" TEXT,
    "email" TEXT,
    "linkedinUrl" TEXT,
    "linkedinConnectedOn" TEXT,
    "title" TEXT,
    "location" TEXT,
    "isProspectContact" BOOLEAN NOT NULL DEFAULT false,
    "isInvestorContact" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "roleAtOrg" TEXT,
    "orgStrength" DOUBLE PRECISION,
    "notes" TEXT,
    "fitScore" DOUBLE PRECISION,
    "fitTier" "FitTier",
    "investorFitScore" DOUBLE PRECISION,
    "outreachStage" "OutreachStage" NOT NULL DEFAULT 'cold',
    "lastSignalDate" TIMESTAMP(3),
    "lastSignalKeyword" TEXT,
    "lastSignalUrl" TEXT,
    "signalDismissed" BOOLEAN NOT NULL DEFAULT false,
    "signalSnoozedUntil" TIMESTAMP(3),
    "incentive" TEXT,
    "warmIntroPath" TEXT,
    "priority" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tag")
);

-- CreateTable
CREATE TABLE "OrganizationTag" (
    "organizationId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "OrganizationTag_pkey" PRIMARY KEY ("organizationId","tag")
);

-- CreateTable
CREATE TABLE "Sector" (
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "defaultAssignee" TEXT,
    "apolloMarketSize" DOUBLE PRECISION,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "OrganizationSector" (
    "organizationId" TEXT NOT NULL,
    "sectorSlug" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrganizationSector_pkey" PRIMARY KEY ("organizationId","sectorSlug")
);

-- CreateTable
CREATE TABLE "RelationshipFrom" (
    "id" TEXT NOT NULL,
    "relationType" "RelationType" NOT NULL,
    "sourcePersonId" TEXT,
    "sourceOrgId" TEXT,
    "targetPersonId" TEXT,
    "targetOrgId" TEXT,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipFrom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachQueueEntry" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedReason" TEXT,
    "stageAtAssignment" "OutreachStage" NOT NULL DEFAULT 'cold',
    "currentStage" "OutreachStage" NOT NULL DEFAULT 'cold',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachTouch" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "queueEntryId" TEXT,
    "userId" TEXT NOT NULL,
    "touchNumber" INTEGER NOT NULL,
    "messageBody" TEXT,
    "generatedMessageId" TEXT,
    "angle" "MessageAngle",
    "stageBeforeTouch" "OutreachStage" NOT NULL,
    "stageAfterTouch" "OutreachStage" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachResponse" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT,
    "responseType" "ResponseType" NOT NULL,
    "notes" TEXT,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "angle" "MessageAngle" NOT NULL,
    "generationMethod" TEXT NOT NULL DEFAULT 'template',
    "modelId" TEXT,
    "messageBody" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "postUrl" TEXT,
    "postSnippet" TEXT,
    "signalDate" TIMESTAMP(3) NOT NULL,
    "action" "SignalAction",
    "actionBy" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "actionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEvent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" "ContactEventKind" NOT NULL,
    "notes" TEXT,
    "subject" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "loggedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "ActivityEventType" NOT NULL,
    "contactId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestNotes" TEXT NOT NULL DEFAULT '',
    "startUtc" TIMESTAMP(3) NOT NULL,
    "endUtc" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "cancelToken" TEXT NOT NULL,
    "rescheduleToken" TEXT NOT NULL,
    "cancelTokenUsed" BOOLEAN NOT NULL DEFAULT false,
    "rescheduleTokenUsed" BOOLEAN NOT NULL DEFAULT false,
    "reminder24hSent" BOOLEAN NOT NULL DEFAULT false,
    "reminder1hSent" BOOLEAN NOT NULL DEFAULT false,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "workingDays" TEXT[] DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri']::TEXT[],
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '17:00',
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 60,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedDate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_kissingerId_key" ON "Organization"("kissingerId");

-- CreateIndex
CREATE INDEX "Organization_isProspect_isArchived_idx" ON "Organization"("isProspect", "isArchived");

-- CreateIndex
CREATE INDEX "Organization_isVcFirm_isArchived_idx" ON "Organization"("isVcFirm", "isArchived");

-- CreateIndex
CREATE INDEX "Organization_sectorPrimary_idx" ON "Organization"("sectorPrimary");

-- CreateIndex
CREATE INDEX "Organization_funnelStage_idx" ON "Organization"("funnelStage");

-- CreateIndex
CREATE INDEX "Organization_investorPipeline_idx" ON "Organization"("investorPipeline");

-- CreateIndex
CREATE INDEX "Organization_icpScore_idx" ON "Organization"("icpScore");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_kissingerId_key" ON "Contact"("kissingerId");

-- CreateIndex
CREATE INDEX "Contact_isProspectContact_isArchived_outreachStage_idx" ON "Contact"("isProspectContact", "isArchived", "outreachStage");

-- CreateIndex
CREATE INDEX "Contact_isInvestorContact_isArchived_idx" ON "Contact"("isInvestorContact", "isArchived");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- CreateIndex
CREATE INDEX "Contact_lastSignalDate_idx" ON "Contact"("lastSignalDate");

-- CreateIndex
CREATE INDEX "Contact_fitScore_idx" ON "Contact"("fitScore");

-- CreateIndex
CREATE INDEX "ContactTag_tag_idx" ON "ContactTag"("tag");

-- CreateIndex
CREATE INDEX "OrganizationTag_tag_idx" ON "OrganizationTag"("tag");

-- CreateIndex
CREATE INDEX "Sector_defaultAssignee_idx" ON "Sector"("defaultAssignee");

-- CreateIndex
CREATE INDEX "OrganizationSector_sectorSlug_idx" ON "OrganizationSector"("sectorSlug");

-- CreateIndex
CREATE INDEX "RelationshipFrom_sourcePersonId_relationType_idx" ON "RelationshipFrom"("sourcePersonId", "relationType");

-- CreateIndex
CREATE INDEX "RelationshipFrom_sourceOrgId_relationType_idx" ON "RelationshipFrom"("sourceOrgId", "relationType");

-- CreateIndex
CREATE INDEX "RelationshipFrom_targetPersonId_relationType_idx" ON "RelationshipFrom"("targetPersonId", "relationType");

-- CreateIndex
CREATE INDEX "RelationshipFrom_targetOrgId_relationType_idx" ON "RelationshipFrom"("targetOrgId", "relationType");

-- CreateIndex
CREATE INDEX "RelationshipFrom_relationType_idx" ON "RelationshipFrom"("relationType");

-- CreateIndex
CREATE INDEX "OutreachQueueEntry_userId_isActive_currentStage_idx" ON "OutreachQueueEntry"("userId", "isActive", "currentStage");

-- CreateIndex
CREATE INDEX "OutreachQueueEntry_userId_isActive_idx" ON "OutreachQueueEntry"("userId", "isActive");

-- CreateIndex
CREATE INDEX "OutreachQueueEntry_contactId_idx" ON "OutreachQueueEntry"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachQueueEntry_contactId_isActive_key" ON "OutreachQueueEntry"("contactId", "isActive");

-- CreateIndex
CREATE INDEX "OutreachTouch_contactId_idx" ON "OutreachTouch"("contactId");

-- CreateIndex
CREATE INDEX "OutreachTouch_userId_sentAt_idx" ON "OutreachTouch"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "OutreachTouch_sentAt_idx" ON "OutreachTouch"("sentAt");

-- CreateIndex
CREATE INDEX "OutreachResponse_contactId_idx" ON "OutreachResponse"("contactId");

-- CreateIndex
CREATE INDEX "OutreachResponse_responseType_idx" ON "OutreachResponse"("responseType");

-- CreateIndex
CREATE INDEX "OutreachResponse_respondedAt_idx" ON "OutreachResponse"("respondedAt");

-- CreateIndex
CREATE INDEX "GeneratedMessage_contactId_angle_isActive_idx" ON "GeneratedMessage"("contactId", "angle", "isActive");

-- CreateIndex
CREATE INDEX "GeneratedMessage_contactId_isActive_idx" ON "GeneratedMessage"("contactId", "isActive");

-- CreateIndex
CREATE INDEX "Signal_contactId_signalDate_idx" ON "Signal"("contactId", "signalDate");

-- CreateIndex
CREATE INDEX "Signal_signalDate_idx" ON "Signal"("signalDate");

-- CreateIndex
CREATE INDEX "Signal_action_idx" ON "Signal"("action");

-- CreateIndex
CREATE INDEX "ContactEvent_contactId_occurredAt_idx" ON "ContactEvent"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_eventType_createdAt_idx" ON "ActivityLog"("userId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_eventType_createdAt_idx" ON "ActivityLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "Booking"("cancelToken");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_rescheduleToken_key" ON "Booking"("rescheduleToken");

-- CreateIndex
CREATE INDEX "Booking_startUtc_idx" ON "Booking"("startUtc");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_cancelToken_idx" ON "Booking"("cancelToken");

-- CreateIndex
CREATE INDEX "Booking_rescheduleToken_idx" ON "Booking"("rescheduleToken");

-- CreateIndex
CREATE INDEX "Booking_status_startUtc_reminder24hSent_reminder1hSent_idx" ON "Booking"("status", "startUtc", "reminder24hSent", "reminder1hSent");

-- CreateIndex
CREATE UNIQUE INDEX "BlockedDate_date_key" ON "BlockedDate"("date");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationTag" ADD CONSTRAINT "OrganizationTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSector" ADD CONSTRAINT "OrganizationSector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSector" ADD CONSTRAINT "OrganizationSector_sectorSlug_fkey" FOREIGN KEY ("sectorSlug") REFERENCES "Sector"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipFrom" ADD CONSTRAINT "RelationshipFrom_sourcePersonId_fkey" FOREIGN KEY ("sourcePersonId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipFrom" ADD CONSTRAINT "RelationshipFrom_sourceOrgId_fkey" FOREIGN KEY ("sourceOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipFrom" ADD CONSTRAINT "RelationshipFrom_targetPersonId_fkey" FOREIGN KEY ("targetPersonId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipFrom" ADD CONSTRAINT "RelationshipFrom_targetOrgId_fkey" FOREIGN KEY ("targetOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachQueueEntry" ADD CONSTRAINT "OutreachQueueEntry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachQueueEntry" ADD CONSTRAINT "OutreachQueueEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachQueueEntry" ADD CONSTRAINT "OutreachQueueEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachTouch" ADD CONSTRAINT "OutreachTouch_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachTouch" ADD CONSTRAINT "OutreachTouch_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "OutreachQueueEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachTouch" ADD CONSTRAINT "OutreachTouch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachTouch" ADD CONSTRAINT "OutreachTouch_generatedMessageId_fkey" FOREIGN KEY ("generatedMessageId") REFERENCES "GeneratedMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachResponse" ADD CONSTRAINT "OutreachResponse_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedMessage" ADD CONSTRAINT "GeneratedMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvent" ADD CONSTRAINT "ContactEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
