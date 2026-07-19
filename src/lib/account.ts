import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";

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

/**
 * Change the password after verifying the current one.
 *
 * On success every OTHER session is revoked — a password change is exactly the
 * moment to evict anyone else holding a session — while the session performing
 * the change stays signed in (`keepSessionToken`). Password policy is enforced
 * at the route boundary via passwordSchema; this layer assumes a valid new
 * password and owns the argon2 verify/hash and the session sweep.
 *
 * The wrong-password failure is deliberately indistinguishable for an account
 * with no password set (OAuth-only): probing which accounts have passwords is
 * not a capability this endpoint should add.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionToken: string | null,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, currentPassword) : false;
  if (!ok) throw new WrongPasswordError();

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.deleteMany({
      where: keepSessionToken ? { userId, sessionToken: { not: keepSessionToken } } : { userId },
    });
  });
}
