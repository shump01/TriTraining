import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { handleApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { spendMailBudget } from "@/lib/mail-budget";
import {
  isMailerConfigured,
  sendPasswordResetEmail,
  sendSignupConfirmationEmail,
} from "@/lib/mailer";
import { createPasswordResetToken } from "@/lib/password-reset";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { issueSignupToken } from "@/lib/signup-verification";
import { forgotPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60_000; // 15 minutes
const MAX_PER_WINDOW = 3;

// Deliberately identical for every request — never reveals whether an account
// exists. It must also cover the address that only has an unfinished sign-up:
// that person gets a CONFIRMATION link, not a reset link, and a message
// promising a reset would convince them nothing was sent.
const GENERIC_MESSAGE =
  "If that address has an account — or a sign-up waiting to be confirmed — we've emailed it a link. Check your inbox (and spam).";

/** POST /api/auth/forgot-password — email a reset link (no user enumeration). */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Per-IP limit first (cheap to reject abuse).
  const ipLimited = enforceRateLimit(req, "auth:forgot", MAX_PER_WINDOW, WINDOW_MS);
  if (ipLimited) return ipLimited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    // Only an input-format error — reveals nothing about accounts.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter a valid email address." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();

  // Per-recipient budget, shared with sign-up and resend so no combination of
  // them can bomb one inbox — and spent whether or not the account exists, so
  // the 429 can't be used to enumerate.
  const overBudget = spendMailBudget(email);
  if (overBudget) return overBudget;

  try {
    const rawToken = await createPasswordResetToken(email);
    if (rawToken) {
      const resetUrl = `${env.NEXTAUTH_URL}/reset-password/${rawToken}`;
      const sent = await sendPasswordResetEmail(email, resetUrl);
      if (!sent) {
        // Dev has no SMTP — surface the link in logs so the flow is testable.
        // Two conditions, both required: NODE_ENV must be explicitly
        // "development" (it defaults to production — see src/env.ts), AND the
        // mailer must be genuinely unconfigured rather than merely failing, so
        // a live-credentials environment can never write a reset link to a log
        // just because SMTP hiccuped.
        if (env.NODE_ENV === "development" && !isMailerConfigured()) {
          logger.info("Password-reset link (dev; mailer not configured)", { resetUrl });
        } else {
          logger.warn("Password-reset email not sent");
        }
      }
    } else {
      // No account — but perhaps a sign-up that was never confirmed. Someone
      // who lost the confirmation email lands here: "Forgot password?" is the
      // obvious button, and in the App Store build that predates email
      // verification it is the ONLY recovery path. Re-send the confirmation
      // instead of silently doing nothing. Same response either way.
      const issued = await issueSignupToken(email);
      if (issued) {
        const confirmUrl = `${env.NEXTAUTH_URL}/verify-email/${issued.rawToken}`;
        const outcome = await sendSignupConfirmationEmail(
          email,
          confirmUrl,
          issued.expires,
          "recovery",
        );
        if (outcome !== "sent" && env.NODE_ENV === "development" && !isMailerConfigured()) {
          logger.info("Sign-up confirmation link (dev; mailer not configured)", { confirmUrl });
        }
      }
    }
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE }, { status: 200 });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/auth/forgot-password" });
  }
}
