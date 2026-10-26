-- CreateEnum
CREATE TYPE "OnCallKind" AS ENUM ('ON_SITE', 'REMOTE', 'ON_CALL');

-- CreateEnum
CREATE TYPE "OnCallStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OnCallCompensation" AS ENUM ('NONE', 'PAID', 'DAYS', 'PENDING');

-- CreateTable
CREATE TABLE "OnCallShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "kind" "OnCallKind" NOT NULL DEFAULT 'ON_CALL',
    "status" "OnCallStatus" NOT NULL DEFAULT 'PLANNED',
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "compensation" "OnCallCompensation" NOT NULL DEFAULT 'PENDING',
    "compensationDays" DOUBLE PRECISION,
    "jiraIssueKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "OnCallShift_userId_startDate_idx" ON "OnCallShift"("userId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "OnCallShift" ADD CONSTRAINT "OnCallShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
