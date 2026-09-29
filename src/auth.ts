import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import Apple from "next-auth/providers/apple";
import Google from "next-auth/providers/google";
import { headers } from "next/headers";

import { hardenLinkedAccount } from "@/lib/oauth-account";
import { isProviderEmailVerified } from "@/lib/oauth-link-policy";
import { guardProviderCallback, SIGNED_IN_ELSEWHERE_ERROR } from "@/lib/oauth-session-guard";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
} from "@/lib/session-cookie";
import { clearPendingSignups } from "@/lib/signup-verification";

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
 * `allowDangerousEmailAccountLinking` is on for both, under the rules of
 * src/lib/oauth-link-policy.ts that the mobile endpoint applies too — so an
 * existing password account gets the provider attached rather than an
 * "account not linked" dead end, without a squatter's pre-registered
 * password, sessions or provider links surviving:
 * - callbacks.signIn refuses an UNVERIFIED provider email outright (Rule 1),
 *   and refuses a callback made while signed in as a different address
 *   (src/lib/oauth-session-guard.ts). It is the one hook whose refusal aborts
 *   the sign-in: Auth.js logs and swallows an event's errors.
 * - events.linkAccount applies Rules 2 and 3 to the row the link landed on.
 * - events.createUser retires any password sign-up still pending for the
 *   address that has just become an account.
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
    async signIn({ account, profile }) {
      if (account?.type !== "oidc" && account?.type !== "oauth") return true;
      // Rule 1: an unverified provider email must never reach the email
      // match, nor become an account of its own.
      if (!isProviderEmailVerified(profile as Record<string, unknown> | undefined)) return false;
      // The raw header, not cookies(): the guard has to find the session
      // token exactly as Auth.js will (see sessionTokenCandidates).
      const cookieHeader = (await headers()).get("cookie");
      const verdict = await guardProviderCallback(cookieHeader, profile?.email);
      // A path aborts the sign-in just as `false` does, but lands on a message
      // that says what to do rather than "sign-in was cancelled".
      return verdict === "refuse" ? `/login?error=${SIGNED_IN_ELSEWHERE_ERROR}` : true;
    },
  },
  events: {
    // After Auth.js creates a user — and, quirkily, after it picks an
    // email-matched existing one too, where retiring leftovers is just as right.
    async createUser({ user }) {
      if (user.email) await clearPendingSignups(user.email);
    },
    // Rules 2 and 3, after Auth.js has attached the provider and before it
    // mints the session. `profile.email` is the provider's address, and a
    // verified one: signIn refused the callback otherwise. On a brand-new user
    // (Auth.js creates them unverified) this just marks the row verified.
    async linkAccount({ user, account, profile }) {
      const userId = user.id;
      if (!userId) return;
      await prisma.$transaction(async (tx) => {
        const row = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, emailVerified: true },
        });
        if (!row) return;
        await hardenLinkedAccount(tx, row, {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          verifiedEmail: profile.email,
        });
      });
    },
  },
  providers: [
    ...(enabled.apple ? [Apple({ allowDangerousEmailAccountLinking: true })] : []),
    ...(enabled.google ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
  ],
});
