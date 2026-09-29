import { createHash, randomBytes } from "crypto";

import { Prisma } from "@/generated/prisma/client";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

/**
 * Email verification at sign-up.
 *
 * A password sign-up creates no User. It creates a PendingSignup (the chosen
 * password's hash) and emails a link; the account only comes into being when
 * someone confirms with BOTH that link and that password.
 *
 * Why both, and not just a "Confirm" button: confirming stamps emailVerified,
 * and emailVerified is exactly the flag that switches off the anti-squatting
 * rule for Apple/Google linking (src/lib/oauth-link-policy.ts). If the link
 * alone sufficed, an attacker could sign up with someone else's address, the
 * owner would click the email they received, and the attacker's password would
 * become a verified credential on the owner's account — surviving the owner's
 * later Google sign-in. The token proves control of the inbox; the password
 * proves the confirmer is the person who chose it. Together they make
 * emailVerified mean what it says, which is also what makes signing the
 * confirmer straight in safe.
 *
 * Two deliberate structural choices:
 * - One PendingSignup row per ATTEMPT, never overwritten. If a re-signup
 *   replaced the row, anyone could swap their own password into a sign-up
 *   that someone else is halfway through. Confirmation instead checks the
 *   password against every live attempt for the address, so the owner gets
 *   the account with the password THEY typed whichever of the emails they
 *   happen to click.
 * - Tokens are stored apart from the attempts, in VerificationToken under
 *   "signup:<email>" (the pattern password reset uses with "pwreset:"). A
 *   token is proof of the inbox, not of any one attempt — so re-sending mints
 *   a new token and every earlier link keeps working until it expires. A
 *   rotating token killed the link the athlete was about to click every time
 *   they, impatiently, pressed "Create account" again.
 *
 * Only token HASHES are stored (SHA-256), as with password reset: a database
 * leak yields no usable links.
 */

export const SIGNUP_IDENTIFIER_PREFIX = "signup:";

/** How long a sign-up (and each link for it) stays confirmable. */
export const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Live attempts kept per address. Each confirm and each login may verify the
 * password against these, so the cap bounds the argon2 work an address can
 * cost; the per-recipient mail budget bounds how fast anyone can add more.
 */
export const MAX_LIVE_SIGNUPS_PER_EMAIL = 5;

function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function identifierFor(email: string): string {
  return `${SIGNUP_IDENTIFIER_PREFIX}${email}`;
}

type Tx = Prisma.TransactionClient;

async function mintToken(db: Tx | typeof prisma, email: string, expires: Date): Promise<string> {
  const rawToken = randomBytes(32).toString("base64url");
  await db.verificationToken.create({
    data: { identifier: identifierFor(email), token: sha256hex(rawToken), expires },
  });
  return rawToken;
}

/**
 * Delete every expired attempt AND every expired link, across all addresses.
 *
 * Both tables, always together: the links carry the address in plain text
 * (the identifier is "signup:<email>"), so sweeping only the attempts would
 * leave an abandoned address behind indefinitely. Run opportunistically from
 * every sign-up path, because the daily cron that also sweeps (see
 * src/lib/retention.ts) is not guaranteed to be configured — and the privacy
 * policy promises unconfirmed sign-ups don't linger. Indexed on `expires` and
 * bounded by what has actually expired, so it stays cheap.
 */
export async function sweepExpiredSignups(now: Date = new Date()): Promise<void> {
  await Promise.all([
    prisma.pendingSignup.deleteMany({ where: { expires: { lt: now } } }),
    prisma.verificationToken.deleteMany({
      where: { identifier: { startsWith: SIGNUP_IDENTIFIER_PREFIX }, expires: { lt: now } },
    }),
  ]);
}

/**
 * Remove every trace of a pending sign-up for an address: the attempts and
 * their links. Called whenever the address gets a real account by ANY route
 * (confirm, Apple/Google sign-in) and on account deletion — otherwise a
 * leftover link could resurrect an address after its account was erased, or
 * the login screen would keep offering "confirm your email" to someone who
 * already has an account.
 */
export async function clearPendingSignups(email: string, db: Tx | typeof prisma = prisma) {
  const normalized = email.toLowerCase();
  await db.pendingSignup.deleteMany({ where: { email: normalized } });
  await db.verificationToken.deleteMany({ where: { identifier: identifierFor(normalized) } });
}

export type StartSignupResult =
  | {
      kind: "pending";
      rawToken: string;
      expires: Date;
      /** For discardSignupAttempt, should the confirmation email fail to send. */
      attemptId: string;
    }
  /** The address already has an account: no attempt is stored. */
  | { kind: "existing" };

/**
 * Record a sign-up attempt and mint its link. The caller hashes the password
 * BEFORE calling (on both branches — see the signup route), so this never sees
 * plaintext and the "address already registered" branch costs the same.
 */
export async function startSignup(
  email: string,
  passwordHash: string,
  now: Date = new Date(),
): Promise<StartSignupResult> {
  const normalized = email.toLowerCase();

  // Abandoned attempts hold an address and a password hash, possibly
  // submitted by someone other than the address's owner: never let them pile up.
  await sweepExpiredSignups(now);

  const existing = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  if (existing) return { kind: "existing" };

  const expires = new Date(now.getTime() + SIGNUP_TTL_MS);
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.pendingSignup.create({
      data: { email: normalized, passwordHash, expires },
      select: { id: true },
    });
    // No trimming here — see trimSignupAttempts for why it waits for the send.
    return {
      kind: "pending" as const,
      rawToken: await mintToken(tx, normalized, expires),
      expires,
      attemptId: attempt.id,
    };
  });
}

/**
 * Trim an address back to its newest few live attempts, oldest first — the
 * athlete's own attempt is almost always the most recent one they made.
 *
 * A separate step, run by the signup route only once the new attempt is
 * staying (its email sent, or possibly still on its way). Trimming inside
 * startSignup evicted an older attempt BEFORE knowing whether the new one
 * would survive: a send that then failed discarded the new attempt too, and
 * the address was left one attempt poorer — possibly the owner's own.
 */
export async function trimSignupAttempts(email: string, now: Date = new Date()): Promise<void> {
  const live = await prisma.pendingSignup.findMany({
    where: { email: email.toLowerCase(), expires: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const surplus = live.slice(MAX_LIVE_SIGNUPS_PER_EMAIL).map((r) => r.id);
  if (surplus.length > 0) {
    await prisma.pendingSignup.deleteMany({ where: { id: { in: surplus } } });
  }
}

/**
 * Undo a sign-up attempt whose confirmation email DEFINITELY never went out. The route
 * answers 503 in that case, and leaving the attempt behind would contradict
 * it: the login screen would then say "we sent you a link" about an email
 * that doesn't exist.
 */
export async function discardSignupAttempt(
  email: string,
  started: { attemptId: string; rawToken: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.pendingSignup.deleteMany({ where: { id: started.attemptId } }),
    prisma.verificationToken.deleteMany({
      where: { identifier: identifierFor(email.toLowerCase()), token: sha256hex(started.rawToken) },
    }),
  ]);
}

/**
 * Mint a fresh link for an address with a live pending sign-up (resend, and
 * forgot-password for an address that never finished signing up). Returns the
 * raw token and when it stops working, or null when there is nothing to
 * confirm — the caller must respond identically either way. Earlier links
 * stay valid.
 *
 * The new link expires with the sign-up it confirms, NOT 24h from now. A link
 * outliving its attempt is a link that says "works for 24 hours" and then
 * reports itself dead an hour later. And pushing the attempt's own expiry out
 * instead is off the table: resend is anonymous, so anyone could then keep
 * someone else's attempt — possibly carrying an attacker's password — alive
 * indefinitely, breaking the 24h retention the privacy policy promises.
 */
export async function issueSignupToken(
  email: string,
  now: Date = new Date(),
): Promise<{ rawToken: string; expires: Date } | null> {
  const normalized = email.toLowerCase();
  await sweepExpiredSignups(now);
  const [user, latest] = await Promise.all([
    prisma.user.findUnique({ where: { email: normalized }, select: { id: true } }),
    // Confirm accepts ANY live attempt, so the last to expire sets the deadline.
    prisma.pendingSignup.findFirst({
      where: { email: normalized, expires: { gt: now } },
      orderBy: { expires: "desc" },
      select: { expires: true },
    }),
  ]);
  if (user || !latest) return null;
  const cap = new Date(now.getTime() + SIGNUP_TTL_MS);
  const expires = latest.expires < cap ? latest.expires : cap;
  return { rawToken: await mintToken(prisma, normalized, expires), expires };
}

export type ConfirmSignupResult =
  | { status: "created"; userId: string }
  /** The address got an account some other way (e.g. Apple/Google) meanwhile. */
  | { status: "already_registered" }
  /** Unknown, expired, or already-used link. */
  | { status: "invalid_token" }
  /** A valid link, but not the password chosen for any live attempt. */
  | { status: "wrong_password" };

/**
 * Confirm a sign-up: the link proves the inbox, the password picks (and
 * proves authorship of) the attempt that becomes the account.
 *
 * A wrong password does NOT consume the link — the owner may simply have
 * mistyped. Only the person holding the link can try, and the route throttles
 * failures.
 */
export async function confirmSignup(
  rawToken: string,
  password: string,
  now: Date = new Date(),
): Promise<ConfirmSignupResult> {
  await sweepExpiredSignups(now);
  const record = await prisma.verificationToken.findFirst({
    where: {
      token: sha256hex(rawToken),
      identifier: { startsWith: SIGNUP_IDENTIFIER_PREFIX },
      expires: { gt: now },
    },
    select: { identifier: true },
  });
  if (!record) return { status: "invalid_token" };
  const email = record.identifier.slice(SIGNUP_IDENTIFIER_PREFIX.length);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Never touch an existing account from here — least of all hand it the
    // pending password (an Apple/Google-only user would suddenly have one).
    // Just retire the now-meaningless attempts and links.
    await clearPendingSignups(email);
    return { status: "already_registered" };
  }

  const attempts = await prisma.pendingSignup.findMany({
    where: { email, expires: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: MAX_LIVE_SIGNUPS_PER_EMAIL,
    select: { passwordHash: true },
  });
  // A live link with no live attempt behind it (they expired or were trimmed)
  // has nothing to confirm; tell the athlete to start again.
  if (attempts.length === 0) return { status: "invalid_token" };

  let chosen: string | null = null;
  for (const attempt of attempts) {
    if (await verifyPassword(attempt.passwordHash, password)) {
      chosen = attempt.passwordHash;
      break;
    }
  }
  if (!chosen) return { status: "wrong_password" };

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash: chosen, emailVerified: now },
        select: { id: true },
      });
      await clearPendingSignups(email, tx);
      return created;
    });
    return { status: "created", userId: user.id };
  } catch (error) {
    // Unique violation on User.email: an Apple/Google sign-in created the
    // account between our check and the create. Same outcome as above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await clearPendingSignups(email);
      return { status: "already_registered" };
    }
    throw error;
  }
}

/**
 * The newest live attempt's password hash, for the login route. Login runs
 * exactly ONE argon2 verification on every path (user hash, this hash, or the
 * dummy), so it compares against the newest attempt only rather than all of
 * them — checking every live attempt would make the response time reveal how
 * many sign-ups are pending for an address.
 */
export async function newestPendingSignupHash(
  email: string,
  now: Date = new Date(),
): Promise<string | null> {
  const row = await prisma.pendingSignup.findFirst({
    where: { email: email.toLowerCase(), expires: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { passwordHash: true },
  });
  return row?.passwordHash ?? null;
}
