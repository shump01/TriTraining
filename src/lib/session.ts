import { randomBytes } from "crypto";

import { prisma } from "@/lib/prisma";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/session-cookie";

/**
 * Create a database-backed session row in the Auth.js adapter's `Session` table.
 * The returned `sessionToken` is what we store in the session cookie; Auth.js's
 * `auth()` looks it up here, so credentials sessions behave exactly like any
 * other database session.
 */
export async function createDatabaseSession(userId: string): Promise<{
  sessionToken: string;
  expires: Date;
}> {
  const data = newSessionData(userId);
  await prisma.session.create({ data });
  return { sessionToken: data.sessionToken, expires: data.expires };
}

/**
 * The row values for a fresh session, without writing them.
 *
 * Lets a caller create the session on a TRANSACTION client instead of the
 * global one — password change rotates the token in the same transaction that
 * revokes the old sessions, so there is never a moment where the account has
 * no valid session (or two valid sets).
 */
export function newSessionData(userId: string): {
  sessionToken: string;
  userId: string;
  expires: Date;
} {
  return {
    sessionToken: randomBytes(32).toString("hex"),
    userId,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  };
}

/** Delete a session by its token (used by sign-out). Safe if it doesn't exist. */
export async function destroyDatabaseSession(sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { sessionToken } });
}
