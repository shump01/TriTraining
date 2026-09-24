/**
 * The rules both sign-in paths — Auth.js on the web, POST /api/auth/oauth
 * for the app — apply when a provider identity meets an EXISTING account
 * with the same email. They must agree, or an attacker simply uses the
 * weaker one.
 *
 * Rule 1: only a VERIFIED provider email may match an existing account.
 * Apple and Google both vouch for the address they send; an unverified
 * claim must never open someone else's account.
 *
 * Rule 2: linking into an account whose email was never verified by us
 * removes that account's password and revokes its sessions. Sign-up does
 * not verify email, so anyone could have registered an address they don't
 * own and set a password on it — a pre-hijack: the real owner later signs
 * in with Apple or Google, lands in that row, and the squatter's password
 * still opens it. After the link, the provider's verification is the only
 * proof of ownership on the row, so the password (which proved nothing)
 * goes, and the owner sets a fresh one through the reset email if they want
 * one. A password account that WAS verified keeps its password.
 */

/** Rule 1, over the raw claims: Apple sends email_verified as a string on some tokens. */
export function isProviderEmailVerified(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  const v = claims?.email_verified;
  return v === true || v === "true";
}

/** The slice of the existing user Rule 2 needs. */
export interface LinkTarget {
  passwordHash: string | null;
  emailVerified: Date | null;
}

/** Rule 2: does linking into this account have to drop its password and sessions? */
export function linkRevokesPassword(target: LinkTarget): boolean {
  return target.passwordHash !== null && target.emailVerified === null;
}
