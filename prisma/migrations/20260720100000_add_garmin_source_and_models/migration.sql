-- Garmin groundwork (see GARMIN_INTEGRATION_PLAN.md): GARMIN as a third
-- activity source plus the connection + durable activity store it needs.
-- Purely additive — safe to apply while the previous build is still running.
-- (The new enum value is not referenced by any statement in this migration,
-- which keeps ALTER TYPE ... ADD VALUE legal inside the migration transaction.)

-- AlterEnum
ALTER TYPE "ActualSource" ADD VALUE 'GARMIN';

-- CreateTable
CREATE TABLE "GarminConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "garminUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3),
    "permissions" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarminConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GarminActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "summaryId" TEXT NOT NULL,
    "sportType" TEXT NOT NULL,
    "startTimeUtc" TIMESTAMP(3) NOT NULL,
    "offsetSeconds" INTEGER NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "avgHr" INTEGER,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GarminActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GarminConnection_userId_key" ON "GarminConnection"("userId");

-- CreateIndex
CREATE INDEX "GarminConnection_garminUserId_idx" ON "GarminConnection"("garminUserId");

-- CreateIndex
CREATE UNIQUE INDEX "GarminActivity_userId_activityId_key" ON "GarminActivity"("userId", "activityId");

-- CreateIndex
CREATE INDEX "GarminActivity_userId_startTimeUtc_idx" ON "GarminActivity"("userId", "startTimeUtc");

-- AddForeignKey
ALTER TABLE "GarminConnection" ADD CONSTRAINT "GarminConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GarminActivity" ADD CONSTRAINT "GarminActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
