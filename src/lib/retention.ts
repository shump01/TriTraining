import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * Retention sweep for the auth tables.
 *
 * Nothing here expires on its own: an expired row keeps working as a row, it
 * just stops being honoured. Both readers already filter on `expires`
 * (`requireUserId` in src/lib/training-plan.ts, `consumePasswordResetToken` in
 * src/lib/password-reset.ts), so this is not a correctness fix — it is about
 * not keeping data we have no further use for:
 *
 * - `Session.sessionToken` is stored in the clear, because that is the
 *   contract with the Auth.js Prisma adapter — `auth()` looks the cookie value
 *   up by equality, so a hash in that column would authenticate nobody. Given
 *   that, the length of time a dead token sits in the table IS the exposure
 *   window for a database leak, and 30-day-old logouts have no business
 *   still being there.
 * - `VerificationToken` rows for password resets carry the account's EMAIL in
 *   plain text inside `identifier` (`pwreset:<email>`). A reset that is never
 *   clicked leaves that address behind forever.
 *
 * Deliberately conservative: only rows whose `expires` is already in the past.
 * A live session is never touched, so this can run at any time.
 */
export interface PruneResult {
  sessions: number;
  verificationTokens: number;
}

export async function pruneExpiredAuthRows(now: Date = new Date()): Promise<PruneResult> {
  const [sessions, verificationTokens] = await Promise.all([
    prisma.session.deleteMany({ where: { expires: { lt: now } } }),
    prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
  ]);

  const result = { sessions: sessions.count, verificationTokens: verificationTokens.count };
  if (result.sessions > 0 || result.verificationTokens > 0) {
    logger.info("Retention sweep removed expired auth rows", result);
  }
  return result;
}
