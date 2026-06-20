/**
 * Single source of truth for the session cookie name and options.
 *
 * Kept free of any Node-only imports (no Prisma) so it can be imported from
 * edge middleware as well as from server route handlers and the Auth.js config.
 */
const isProd = process.env.NODE_ENV === "production";

/**
 * Matches Auth.js's default database-session cookie name so that `auth()` and
 * `signOut()` interoperate with sessions we create directly in the adapter's
 * `Session` table. The `__Secure-` prefix is used over HTTPS (production).
 */
export const SESSION_COOKIE_NAME = isProd
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Secure, httpOnly, sameSite=lax — sent on top-level navigations, not cross-site fetches. */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: isProd,
};
