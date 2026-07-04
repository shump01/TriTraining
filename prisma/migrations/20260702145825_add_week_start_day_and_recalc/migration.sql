-- AlterTable
ALTER TABLE "TrainingPlan" ADD COLUMN     "lastRecalcWeek" DATE,
ADD COLUMN     "weekStartDay" INTEGER NOT NULL DEFAULT 1;
