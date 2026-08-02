-- CreateEnum
CREATE TYPE "ViewMode" AS ENUM ('SIMPLE', 'DETAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "viewMode" "ViewMode" NOT NULL DEFAULT 'DETAILED';
