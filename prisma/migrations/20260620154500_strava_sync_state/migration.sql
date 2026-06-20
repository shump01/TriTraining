-- AlterTable
ALTER TABLE "StravaConnection" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyActual_planId_discipline_weekStartDate_source_key" ON "WeeklyActual"("planId", "discipline", "weekStartDate", "source");
