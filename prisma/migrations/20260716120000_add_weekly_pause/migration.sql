-- CreateEnum
CREATE TYPE "PauseReason" AS ENUM ('ILLNESS', 'INJURY', 'TRAVEL', 'OTHER');

-- CreateTable
CREATE TABLE "WeeklyPause" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "reason" "PauseReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyPause_planId_weekStartDate_idx" ON "WeeklyPause"("planId", "weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPause_planId_weekStartDate_key" ON "WeeklyPause"("planId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "WeeklyPause" ADD CONSTRAINT "WeeklyPause_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
