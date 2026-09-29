import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { logger } from "@/lib/logger";
import { spendMailBudget } from "@/lib/mail-budget";
import {
  isMailerConfigured,
  sendAlreadyRegisteredEmail,
  sendSignupConfirmationEmail,
  type SendOutcome,
} from "@/lib/mailer";
import { hashPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, isCrossSiteRequest } from "@/lib/security";
import { discardSignupAttempt, startSignup, trimSignupAttempts } from "@/lib/signup-verification";
import { signupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allow a few sign-ups per IP per minute.
const SIGNUP_LIMIT = 5;
const WINDOW_MS = 60_000;

// Identical for a new address and one that already has an account.
const CHECK_INBOX = "Check your email to confirm your address and finish creating your account.";
// True whether the send definitely failed or merely timed out (and may yet
// arrive) — the response can't know which, and must not claim either.
const UNAVAILABLE =
  "We couldn't confirm your email was sent. If it hasn't arrived in a few minutes, please try again.";

/**
 * POST /api/auth/signup — start a sign-up. Creates NO account: it records the
 * attempt and emails a confirmation link, and the account only exists once
 * that link is used with this same password (src/lib/signup-verification.ts).
 *
 * The RESPONSE never says whether the address has an account: BOTH branches
 * send an email (a confirmation for a new address, a "you already have an
 * account" notice for a known one), both hash the password first, and both
 * answer identically — including failing identically, which is what lets a
 * failed send be reported honestly as a 503 instead of a cheerful "check your
 * email" that nothing will ever arrive for.
 *
 * Not claimed: that nothing else can tell them apart. Only the new-address
 * branch writes (a few extra database round trips), and signing up and then
 * logging in with the same password answers 403 "confirm your email" for a new
 * address but 401 for a known one. Closing that would take two argon2
 * verifications on every login; instead it is left noisy — every such probe
 * emails the address's owner — and bounded by the per-recipient mail budget.
 */
export async function POST(req: NextRequest) {
  // CSRF: reject cross-site requests.
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit BEFORE doing any work so abuse is cheap to reject.
  const limit = rateLimit(`signup:${getClientIp(req)}`, SIGNUP_LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    // Input-rule messages (email format / password policy) are safe to return —
    // they reveal nothing about which accounts exist.
    const message = parsed.error.issues[0]?.message ?? "Invalid input.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();

  const overBudget = spendMailBudget(email);
  if (overBudget) return overBudget;

  // Without a mailer a sign-up can never be confirmed. Development logs the
  // link instead (below); anywhere else, refuse up front rather than store an
  // attempt nobody can finish.
  const devWithoutMailer = env.NODE_ENV === "development" && !isMailerConfigured();
  if (!isMailerConfigured() && !devWithoutMailer) {
    logger.error("Sign-up refused: mailer not configured");
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  // Hash on BOTH branches. The "already registered" branch doesn't need the
  // hash, but skipping argon2 there would make it measurably faster — and the
  // response time would then say whether the address has an account.
  const passwordHash = await hashPassword(parsed.data.password);
  const started = await startSignup(email, passwordHash);

  let outcome: SendOutcome;
  if (started.kind === "pending") {
    const confirmUrl = `${env.NEXTAUTH_URL}/verify-email/${started.rawToken}`;
    outcome = await sendSignupConfirmationEmail(email, confirmUrl, started.expires);
    if (outcome !== "sent" && devWithoutMailer) {
      // Same double guard as forgot-password: explicitly development AND
      // genuinely unconfigured, so a live mailer that merely hiccups can never
      // write a confirmation link to a log. NB dev shares the production
      // database — a link confirmed here makes a real, verified account.
      logger.info("Sign-up confirmation link (dev; mailer not configured)", { confirmUrl });
      outcome = "sent";
    }

    if (outcome === "failed") {
      // Definitely never went out: take the attempt back out. Left in place,
      // the login screen would tell this person "we sent you a link".
      await discardSignupAttempt(email, started).catch((error: unknown) => {
        logger.warn("Could not discard an unsent sign-up attempt", {
          name: (error as { name?: string })?.name,
        });
      });
    } else {
      // Sent — or timed out, and possibly still on its way, in which case its
      // link must keep working when it lands. Either way the attempt stays,
      // so only now trim the address back to its newest few.
      await trimSignupAttempts(email).catch(() => {});
    }
  } else {
    outcome = await sendAlreadyRegisteredEmail(
      email,
      `${env.NEXTAUTH_URL}/login`,
      `${env.NEXTAUTH_URL}/forgot-password`,
    );
    if (outcome !== "sent" && devWithoutMailer) outcome = "sent";
  }

  if (outcome !== "sent") {
    // sendEmail has already logged why (kind + SMTP error code).
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  }

  return NextResponse.json(
    { ok: true, pendingVerification: true, message: CHECK_INBOX },
    { status: 201 },
  );
}
