import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/session-cookie";

/**
 * Auth.js (NextAuth v5) instance.
 *
 * Uses the Prisma adapter with the **database** session strategy. `auth()`
 * reads the session cookie and looks the token up in the `Session` table — the
 * same table our credentials login writes to (see src/lib/session.ts). This is
 * how we get credentials login + database sessions, which the built-in
 * Credentials provider alone does not support.
 *
 * `signIn` / additional OAuth providers can be added to `providers` later; the
 * adapter and database-session plumbing are already in place.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  // The Prisma 7 generated client is structurally compatible with the adapter.
  adapter: PrismaAdapter(prisma as never),
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  // Required when not deployed on Vercel so Auth.js trusts the request host.
  trustHost: true,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: sessionCookieOptions,
    },
  },
  pages: {
    signIn: "/login",
  },
  providers: [],
});
