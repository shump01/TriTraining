/**
 * The rules both sign-in paths — Auth.js on the web, POST /api/auth/oauth
 * for the app — apply when a provider identity meets an account. They must
 * agree, or an attacker simply uses the weaker one.
 *
 * What they protect is the meaning of `emailVerified`: "the owner of this
 * address's inbox controls this account". Sign-up only sets it once the inbox
 * owner confirms with the password they chose (src/lib/signup-verification.ts),
 * so a provider link must never set it on weaker evidence — and a link that
 * arrives with real evidence must strip whatever was attached without it.
 *
 * Rule 1: only a VERIFIED provider email may match an existing account, or
 * create one. Apple and Google both vouch for the address they send; an
 * unverified claim must never open someone else's account, and an account
 * must never exist for an address nobody has proven.
 *
 * Rule 2: a provider vouches for ITS address and nothing else. A link that
 * lands on a row with a different email (Auth.js's "signed-in" branch links
 * to whoever the session belongs to — see oauth-session-guard.ts) proves
 * nothing about that row: it is not stamped verified, and the link is undone.
 *
 * Rule 3: an email-matched link into a row whose email was never proven is
 * the FIRST proof of who owns the address, so everything attached to the row
 * before it was attached by someone unproven, and goes: the password, every
 * session, and every other provider link. Such rows are password sign-ups
 * from before sign-up verified email, and accounts the app used to create
 * from an unverified provider email — either may belong to a squatter who
 * registered an address they don't own (a pre-hijack: the real owner later
 * arrives through Apple or Google and would otherwise share the row with the
 * squatter's password, sessions or Google login). The owner sets a fresh
 * password through the reset email if they want one. A row that WAS verified
 * keeps everything.
 */

/** Rule 1, over the raw claims: Apple sends email_verified as a string on some tokens. */
export function isProviderEmailVerified(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  const v = claims?.email_verified;
  return v === true || v === "true";
}

/** Addresses compare case- and whitespace-insensitively; null when there is none. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase();
  return v ? v : null;
}

/** The slice of the linked-to user Rules 2 and 3 need. */
export interface LinkTarget {
  email: string;
  emailVerified: Date | null;
}

/**
 * What a new provider link means for the row it landed on:
 * - "foreign": Rule 2 — the provider vouched for another address; undo it.
 * - "reclaim": Rule 3 — first proof of the inbox; strip the row, then verify it.
 * - "keep": an already-verified row simply gains the provider.
 *
 * `verifiedProviderEmail` must be an address the provider VERIFIED (Rule 1
 * is checked before any link happens); a missing one counts as foreign.
 */
export type LinkOutcome = "foreign" | "reclaim" | "keep";

export function linkOutcome(
  target: LinkTarget,
  verifiedProviderEmail: string | null | undefined,
): LinkOutcome {
  const vouched = normalizeEmail(verifiedProviderEmail);
  if (!vouched || vouched !== normalizeEmail(target.email)) return "foreign";
  return target.emailVerified === null ? "reclaim" : "keep";
}
