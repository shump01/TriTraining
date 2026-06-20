-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('SWIM', 'BIKE', 'RUN');

-- CreateEnum
CREATE TYPE "ActualSource" AS ENUM ('MANUAL', 'STRAVA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanDiscipline" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "eventDistanceMeters" INTEGER NOT NULL,
    "startingWeeklyMeters" INTEGER NOT NULL,

    CONSTRAINT "PlanDiscipline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyTarget" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "targetMeters" INTEGER NOT NULL,

    CONSTRAINT "WeeklyTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyActual" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "discipline" "Discipline" NOT NULL,
    "weekStartDate" DATE NOT NULL,
    "actualMeters" INTEGER NOT NULL,
    "source" "ActualSource" NOT NULL,

    CONSTRAINT "WeeklyActual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "TrainingPlan_userId_idx" ON "TrainingPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDiscipline_planId_discipline_key" ON "PlanDiscipline"("planId", "discipline");

-- CreateIndex
CREATE INDEX "WeeklyTarget_planId_weekStartDate_idx" ON "WeeklyTarget"("planId", "weekStartDate");

-- CreateIndex
CREATE INDEX "WeeklyActual_planId_weekStartDate_idx" ON "WeeklyActual"("planId", "weekStartDate");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanDiscipline" ADD CONSTRAINT "PlanDiscipline_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyTarget" ADD CONSTRAINT "WeeklyTarget_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyActual" ADD CONSTRAINT "WeeklyActual_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
