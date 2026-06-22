-- AlterTable: add nullable week-1 start date (back-dated plans).
ALTER TABLE "TrainingPlan" ADD COLUMN "startDate" DATE;
