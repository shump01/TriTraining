-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlan_shareToken_key" ON "TrainingPlan"("shareToken");
