import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Apple from "next-auth/providers/apple";
import Google from "next-auth/providers/google";

import { hardenLinkedAccount } from "@/lib/oauth-account";
import { isProviderEmailVerified } from "@/lib/oauth-link-policy";
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
 * OAuth providers (Apple, Google) sit beside the credentials login. Each is
 * registered only when its credentials are in the environment, and the
 * sign-in pages show a button only for registered providers — a deployment
 * that has one and not the other never offers a sign-in that can only fail.
 * `allowDangerousEmailAccountLinking` is on for both, under the two rules of
 * src/lib/oauth-link-policy.ts that the mobile endpoint applies too: only a
 * VERIFIED provider email may match an existing account (callbacks.signIn),
 * and linking into an account whose email we never verified removes its
 * password and sessions (events.linkAccount) — so an existing password
 * account gets the provider attached rather than an "account not linked"
 * dead end, without a squatter's pre-registered password surviving.
 *
 * Apple answers with a cross-site form POST (response_mode form_post), and a
 * SameSite=Lax cookie is not sent on one: Auth.js's state and nonce cookies
 * would go missing and every Apple sign-in would fail its state check. Those
 * two cookies are therefore SameSite=None; they are short-lived and
 * CSRF-bound, so the relaxation costs nothing.
 */

/** Which OAuth providers this deployment can actually offer. */
export function oauthProviders(): { apple: boolean; google: boolean } {
  return {
    apple: Boolean(process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET),
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  };
}

const enabled = oauthProviders();

const crossSiteCookie = {
  httpOnly: true,
  sameSite: "none" as const,
  path: "/",
  secure: true,
};

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
    state: { name: "__Secure-authjs.state", options: crossSiteCookie },
    nonce: { name: "__Secure-authjs.nonce", options: crossSiteCookie },
    // Same reason: the post-sign-in destination rides in this cookie, and an
    // Apple sign-in that lost it would land on the site root, not the page
    // the athlete asked for.
    callbackUrl: { name: "__Secure-authjs.callback-url", options: crossSiteCookie },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    // Rule 1: an unverified provider email must never reach the email match.
    signIn({ account, profile }) {
      if (account?.type !== "oidc" && account?.type !== "oauth") return true;
      return isProviderEmailVerified(profile as Record<string, unknown> | undefined);
    },
  },
  events: {
    // Rule 2, after Auth.js has attached the provider and before it mints
    // the session. Fires for brand-new users too, where it is a no-op.
    async linkAccount({ user }) {
      if (!user.id) return;
      const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { passwordHash: true, emailVerified: true },
      });
      if (row) await hardenLinkedAccount(prisma, { id: user.id, ...row });
    },
  },
  providers: [
    ...(enabled.apple ? [Apple({ allowDangerousEmailAccountLinking: true })] : []),
    ...(enabled.google ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
  ],
});
