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
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: { sessionToken, userId, expires },
  });

  return { sessionToken, expires };
}

/** Delete a session by its token (used by sign-out). Safe if it doesn't exist. */
export async function destroyDatabaseSession(sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { sessionToken } });
}
