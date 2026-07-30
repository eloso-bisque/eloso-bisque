-- CreateEnum
CREATE TYPE "FeedbackThumb" AS ENUM ('up', 'down');

-- CreateTable
CREATE TABLE "OutreachFeedback" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "thumb" "FeedbackThumb" NOT NULL,
    "text" TEXT,
    "loggedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachFeedback_contactId_createdAt_idx" ON "OutreachFeedback"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachFeedback_thumb_idx" ON "OutreachFeedback"("thumb");

-- AddForeignKey
ALTER TABLE "OutreachFeedback" ADD CONSTRAINT "OutreachFeedback_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
