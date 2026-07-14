-- CreateTable
CREATE TABLE "WeeklyCheckin" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "fatigue" INTEGER NOT NULL,
    "sleep" INTEGER NOT NULL,
    "soreness" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyCheckin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyCheckin_planId_weekStartDate_idx" ON "WeeklyCheckin"("planId", "weekStartDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyCheckin_planId_weekStartDate_key" ON "WeeklyCheckin"("planId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "WeeklyCheckin" ADD CONSTRAINT "WeeklyCheckin_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
