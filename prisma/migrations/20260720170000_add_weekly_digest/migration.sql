-- Weekly digest email preference + per-week send idempotency (see
-- src/lib/digest.ts). Additive — safe to apply with the previous build running.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "lastDigestWeek" DATE;

-- Existing accounts signed up under a privacy policy that promised email only
-- when the service requires it, so they start OPTED OUT and can enable the
-- digest themselves on the Account page. New signups keep DEFAULT true — the
-- digest is disclosed in the policy and terms they accept at signup, and every
-- email carries a one-click unsubscribe.
UPDATE "User" SET "digestEnabled" = false;
