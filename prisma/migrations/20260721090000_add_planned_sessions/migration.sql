-- Week planner: sessions laid onto days (see src/lib/week-planner.ts).
-- Additive — safe to apply with the previous build still running.

-- CreateTable
CREATE TABLE "PlannedSession" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "share" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlannedSession_planId_weekStartDate_discipline_slot_key" ON "PlannedSession"("planId", "weekStartDate", "discipline", "slot");

-- CreateIndex
CREATE INDEX "PlannedSession_planId_weekStartDate_idx" ON "PlannedSession"("planId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "PlannedSession" ADD CONSTRAINT "PlannedSession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
