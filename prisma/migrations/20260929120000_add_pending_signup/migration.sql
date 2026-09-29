-- Email verification at sign-up: a PendingSignup row holds an unconfirmed
-- sign-up until its owner confirms (see src/lib/signup-verification.ts).
-- Purely additive, and the old code never reads it, so applying it early is
-- safe and rolling the code back leaves it inert. It MUST be applied BEFORE
-- the new code serves traffic: login reads this table on every request (as do
-- sign-up, verify-email, resend, forgot-password and Apple/Google account
-- creation), and without it they fail with P2021 — every password login 500s.
--
-- Also indexes VerificationToken.expires: the sign-up expiry sweep runs on
-- every anonymous sign-up, resend and confirm request, and without the index
-- each is a sequential scan. CREATE INDEX (not CONCURRENTLY) briefly locks
-- writes to VerificationToken — a small table, so this is milliseconds.

-- CreateTable
CREATE TABLE "PendingSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingSignup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingSignup_email_idx" ON "PendingSignup"("email");

-- CreateIndex
CREATE INDEX "PendingSignup_expires_idx" ON "PendingSignup"("expires");

-- CreateIndex
CREATE INDEX "VerificationToken_expires_idx" ON "VerificationToken"("expires");

