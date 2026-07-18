-- Generalize ActivityLoad from Strava-only to per-source (Strava + Apple Health).
-- The Prisma field renames stravaActivityId -> externalId but keeps the physical
-- column via @map, so no data migration is needed. Adding a column with a
-- constant default is metadata-only in Postgres, and the new unique key is
-- strictly weaker than the old one, so existing rows cannot conflict.

-- AlterTable
ALTER TABLE "ActivityLoad" ADD COLUMN "source" "ActualSource" NOT NULL DEFAULT 'STRAVA';

-- DropIndex
DROP INDEX "ActivityLoad_userId_stravaActivityId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLoad_userId_source_stravaActivityId_key" ON "ActivityLoad"("userId", "source", "stravaActivityId");
