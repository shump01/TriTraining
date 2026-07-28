import { createHash, randomBytes } from "crypto";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

/**
 * Password-reset tokens, stored in the (otherwise unused) Auth.js
 * `VerificationToken` table under a `pwreset:<email>` identifier.
 *
 * Security model:
 * - The raw token goes in the emailed URL; only its **SHA-256 hash** is stored,
 *   so a database leak yields no usable reset links.
 * - Single-use: the row is deleted the moment a valid token is consumed.
 * - 60-minute expiry.
 * - No user enumeration: `createPasswordResetToken` returns null (silently) for
 *   an unknown email; the caller responds identically either way.
 * - A successful reset revokes ALL of the user's sessions.
 */

/**
 * Namespaces reset tokens inside the shared Auth.js `VerificationToken` table.
 * Exported so other flows can invalidate a user's outstanding reset links —
 * see changePassword (src/lib/account.ts) and account deletion.
 */
export const IDENTIFIER_PREFIX = "pwreset:";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Issue a reset token for `email` if an account exists. Returns the RAW token
 * (to embed in the reset URL) or null when there is no such user — the caller
 * must not reveal which happened. Replaces any previous token for the account.
 */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const normalized = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
  if (!user) return null;

  const rawToken = randomBytes(32).toString("base64url");
  const identifier = `${IDENTIFIER_PREFIX}${normalized}`;

  // One outstanding token per account: clear any prior ones first.
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({
    data: { identifier, token: sha256hex(rawToken), expires: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  return rawToken;
}

/**
 * Validate a raw token and CONSUME it (delete, single-use). Returns the account
 * email on success, or null when the token is unknown/expired/already used.
 */
export async function consumePasswordResetToken(rawToken: string): Promise<string | null> {
  const hashed = sha256hex(rawToken);
  const record = await prisma.verificationToken.findFirst({
    where: {
      token: hashed,
      identifier: { startsWith: IDENTIFIER_PREFIX },
      expires: { gt: new Date() },
    },
  });
  if (!record) return null;

  // Single-use: remove it before doing anything else, so a token can never be
  // replayed even if a later step fails.
  await prisma.verificationToken.deleteMany({
    where: { identifier: record.identifier, token: hashed },
  });

  return record.identifier.slice(IDENTIFIER_PREFIX.length);
}

/**
 * Complete a reset: consume the token, set the new (argon2-hashed) password, and
 * revoke every session for the account. Returns whether it succeeded — callers
 * surface only a generic message on failure.
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
  const email = await consumePasswordResetToken(rawToken);
  if (!email) return false;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return false; // token existed but account since deleted

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // Evict any existing sessions — anyone logged in must re-authenticate.
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  return true;
}
