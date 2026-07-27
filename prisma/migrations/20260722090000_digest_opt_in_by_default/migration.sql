-- The weekly digest becomes OPT-IN for new accounts too.
--
-- Sign-up does not verify the email address, so anyone can register someone
-- else's address; with the digest defaulting ON, that person would then
-- receive recurring mail they never consented to. Existing rows were already
-- set to false when the column was introduced; this aligns the column default
-- so newly created accounts match.
--
-- Only the DEFAULT changes — no existing row is touched, so anyone who has
-- switched the digest on keeps it.

ALTER TABLE "User" ALTER COLUMN "digestEnabled" SET DEFAULT false;
