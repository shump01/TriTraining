import { normalizeEmail } from "@/lib/oauth-link-policy";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * Keeps Auth.js's "signed-in" linking branch from ever running on this site.
 *
 * When an OAuth callback arrives carrying a session cookie, @auth/core
 * (handleLoginOrRegister) links the provider account to THE SESSION'S user —
 * whatever address the provider vouched for — and fires linkAccount for that
 * user. We have no "connect a provider" screen, so here that branch is only
 * ever an accident or an attack: a squatter who registered victim@x with a
 * password signs in, clicks "Continue with Google" as attacker@gmail, and
 * victim@x's row gains a Google login that no later password reset removes.
 *
 * callbacks.signIn runs just before that branch, and is the one hook whose
 * refusal aborts the sign-in (events can't: Auth.js logs and swallows their
 * errors). It asks this module what the cookie means:
 * - a live session for a DIFFERENT address → "refuse";
 * - any other session the cookie names — the same address, or expired (Auth.js
 *   links into an expired one too; it never checks) — is deleted, so Auth.js
 *   takes its signed-out path: the email-matched link, with the link policy
 *   applied, and a fresh session. Letting a same-address session through would
 *   also sign the athlete out: linking into a never-verified row deletes every
 *   session, the one in this cookie included.
 */

/** The ?error= code the sign-in page shows (src/lib/auth-error-message.ts). */
export const SIGNED_IN_ELSEWHERE_ERROR = "SignedInElsewhere";

/** Only a space or a tab counts as padding around a cookie pair — Auth.js's rule. */
function trimCookiePadding(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && (s[start] === " " || s[start] === "\t")) start++;
  while (end > start && (s[end - 1] === " " || s[end - 1] === "\t")) end--;
  return s.slice(start, end);
}

function decodeCookieValue(s: string): string {
  if (!s.includes("%")) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Every session token Auth.js could read from this Cookie header.
 *
 * Auth.js doesn't read one cookie by name. Its SessionStore (@auth/core
 * lib/utils/cookie.js) joins EVERY cookie whose name starts with the session
 * cookie's name — chunks, "<name>.0", "<name>.1"… — ordered by the numeric
 * suffix, out of a parse in which the FIRST duplicate wins. Next's cookies()
 * keeps the last duplicate and knows nothing of chunks, so someone who writes
 * their own Cookie header could show it one session and Auth.js another. So
 * this mirrors that parse and join (checked against @auth/core 0.41.3 — re-check
 * on upgrade), and adds every individual value, duplicates included, so a
 * drift in Auth.js's parsing still leaves its token in the set.
 */
export function sessionTokenCandidates(
  cookieHeader: string | null | undefined,
  cookieName: string = SESSION_COOKIE_NAME,
): string[] {
  const str = cookieHeader ?? "";
  const firstByName = new Map<string, string>();
  const candidates = new Set<string>();

  // Port of the vendored `cookie` parse (@auth/core lib/vendored/cookie.js).
  let index = 0;
  while (str.length >= 2 && index < str.length) {
    const eqIdx = str.indexOf("=", index);
    if (eqIdx === -1) break;
    const semiIdx = str.indexOf(";", index);
    const endIdx = semiIdx === -1 ? str.length : semiIdx;
    if (eqIdx > endIdx) {
      // A pair without "=": resume from the last ";" before the next "=".
      index = str.lastIndexOf(";", eqIdx - 1) + 1;
      continue;
    }
    const name = trimCookiePadding(str.slice(index, eqIdx));
    const value = decodeCookieValue(trimCookiePadding(str.slice(eqIdx + 1, endIdx)));
    if (name.startsWith(cookieName)) {
      if (value) candidates.add(value);
      // First wins even when empty: an empty first duplicate hides the rest.
      if (!firstByName.has(name)) firstByName.set(name, value);
    }
    index = endIdx + 1;
  }

  // SessionStore: drop empty chunks, order by numeric suffix, concatenate.
  const suffix = (name: string) => parseInt(name.split(".").pop() || "0");
  const joined = [...firstByName.entries()]
    .filter(([, value]) => value)
    .map(([name]) => name)
    .sort((a, b) => suffix(a) - suffix(b))
    .map((name) => firstByName.get(name))
    .join("");
  if (joined) candidates.add(joined);
  return [...candidates];
}

export type SessionGuardVerdict = "proceed" | "refuse";

/**
 * Decide an OAuth callback against the session cookie it carries. Deletes
 * the sessions it lets through (see the module comment) — so call it only
 * where a "proceed" is followed by the sign-in itself: callbacks.signIn.
 */
export async function guardProviderCallback(
  cookieHeader: string | null | undefined,
  providerEmail: string | null | undefined,
  now: Date = new Date(),
): Promise<SessionGuardVerdict> {
  const tokens = sessionTokenCandidates(cookieHeader);
  if (tokens.length === 0) return "proceed";

  const sessions = await prisma.session.findMany({
    where: { sessionToken: { in: tokens } },
    select: { id: true, expires: true, user: { select: { email: true } } },
  });
  if (sessions.length === 0) return "proceed";

  const vouched = normalizeEmail(providerEmail);
  const signedInElsewhere = sessions.some(
    (s) => s.expires > now && (!vouched || normalizeEmail(s.user.email) !== vouched),
  );
  if (signedInElsewhere) return "refuse";

  await prisma.session.deleteMany({ where: { id: { in: sessions.map((s) => s.id) } } });
  return "proceed";
}
