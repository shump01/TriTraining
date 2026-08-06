import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { IDENTIFIER_PREFIX } from "@/lib/password-reset";
import { newSessionData } from "@/lib/session";

/**
 * User-account self-service: screen name, password change. Deletion lives in
 * the route (a bare cascade delete); the logic worth testing is here.
 *
 * Everything takes an explicit, session-derived userId — same doctrine as the
 * rest of the data layer: callers can never operate on another account.
 */

/** Thrown when the supplied current password doesn't match (or none is set). */
export class WrongPasswordError extends Error {
  constructor() {
    super("Current password is incorrect.");
    this.name = "WrongPasswordError";
  }
}

/**
 * Set (or clear) the user's screen name. An empty/whitespace name clears it,
 * falling back to the email-derived display name everywhere.
 */
export async function updateScreenName(userId: string, name: string | null): Promise<void> {
  const trimmed = name?.trim() || null;
  await prisma.user.update({ where: { id: userId }, data: { name: trimmed } });
}

/** Turn the weekly digest email on or off. */
export async function updateDigestEnabled(userId: string, enabled: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { digestEnabled: enabled } });
}

/** Set the plan-view display density (SIMPLE = current week only). */
export async function updateViewMode(
  userId: string,
  viewMode: "SIMPLE" | "DETAILED",
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { viewMode } });
}

/**
 * Change the password after verifying the current one.
 *
 * On success EVERY session is revoked — including the one making the change —
 * and a fresh one is minted in the same transaction. Two reasons to rotate
 * rather than keep the caller's token:
 *
 *  - A password change is the moment to evict anyone else holding a session,
 *    and the caller's own token may itself be the compromised one (stolen
 *    cookie, shared device) — keeping it would leave the attacker signed in
 *    on the very account the user just tried to secure.
 *  - It's the standard post-privilege-change hygiene: no credential that
 *    existed before the change survives it.
 *
 * The new token is RETURNED rather than applied here: the route owns the
 * transport (a cookie for web, the JSON body for the mobile bearer client), so
 * the caller stays signed in seamlessly instead of being bounced to login.
 *
 * Password policy is enforced at the route boundary via passwordSchema; this
 * layer assumes a valid new password and owns the argon2 verify/hash, the
 * session sweep, and the rotation.
 *
 * The wrong-password failure is deliberately indistinguishable for an account
 * with no password set (OAuth-only): probing which accounts have passwords is
 * not a capability this endpoint should add.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ sessionToken: string; expires: Date }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, email: true },
  });

  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, currentPassword) : false;
  if (!ok) throw new WrongPasswordError();

  const passwordHash = await hashPassword(newPassword);
  const session = newSessionData(userId);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    // Every session, no exception — then immediately replace the caller's.
    // Same transaction, so there is never a window with a stale token still
    // valid, nor one where the user is left with no session at all.
    await tx.session.deleteMany({ where: { userId } });
    await tx.session.create({ data: session });
    // Any reset link already in the athlete's inbox is now stale. Someone who
    // obtained one before the change (old mailbox, forwarded mail) must not be
    // able to walk it in afterwards and take the account straight back.
    if (user?.email) {
      await tx.verificationToken.deleteMany({
        where: { identifier: `${IDENTIFIER_PREFIX}${user.email.toLowerCase()}` },
      });
    }
  });

  return { sessionToken: session.sessionToken, expires: session.expires };
}
