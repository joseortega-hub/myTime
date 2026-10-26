-- CreateTable
CREATE TABLE "CompensatoryGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "pickCount" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompensatoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensatoryOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "label" TEXT,
    "absenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompensatoryOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompensatoryGroup_userId_year_idx" ON "CompensatoryGroup"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "CompensatoryOption_absenceId_key" ON "CompensatoryOption"("absenceId");

-- AddForeignKey
ALTER TABLE "CompensatoryGroup" ADD CONSTRAINT "CompensatoryGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensatoryOption" ADD CONSTRAINT "CompensatoryOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CompensatoryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensatoryOption" ADD CONSTRAINT "CompensatoryOption_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "Absence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
