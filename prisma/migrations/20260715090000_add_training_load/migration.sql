-- AlterTable
ALTER TABLE "User" ADD COLUMN     "thresholdHr" INTEGER;

-- CreateTable
CREATE TABLE "ActivityLoad" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "movingSeconds" INTEGER NOT NULL,
    "avgHr" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLoad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLoad_userId_date_idx" ON "ActivityLoad"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityLoad_userId_stravaActivityId_key" ON "ActivityLoad"("userId", "stravaActivityId");

-- AddForeignKey
ALTER TABLE "ActivityLoad" ADD CONSTRAINT "ActivityLoad_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
