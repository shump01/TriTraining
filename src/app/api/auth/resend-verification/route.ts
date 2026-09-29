import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { handleApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { spendMailBudget } from "@/lib/mail-budget";
import { isMailerConfigured, sendSignupConfirmationEmail } from "@/lib/mailer";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { issueSignupToken } from "@/lib/signup-verification";
import { resendVerificationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC =
  "If a sign-up is waiting for that address, we've sent a new confirmation link. Check your spam folder too.";

/**
 * POST /api/auth/resend-verification { email } — email another confirmation
 * link for a sign-up that hasn't been confirmed. Earlier links keep working.
 *
 * Always the same 200, including when the send FAILS. Unlike sign-up — where
 * both branches send mail, so a 503 is safe — this only sends when an attempt
 * is pending, and a 503 here would announce that someone is mid-sign-up with
 * the address.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ipLimited = enforceRateLimit(req, "auth:resend", 5, 15 * 60_000);
  if (ipLimited) return ipLimited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = resendVerificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Enter a valid email address." },
      { status: 400 },
    );
  }

  const email = parsed.data.email.toLowerCase();
  const overBudget = spendMailBudget(email);
  if (overBudget) return overBudget;

  try {
    const issued = await issueSignupToken(email);
    if (issued) {
      const confirmUrl = `${env.NEXTAUTH_URL}/verify-email/${issued.rawToken}`;
      const outcome = await sendSignupConfirmationEmail(email, confirmUrl, issued.expires);
      if (outcome !== "sent" && env.NODE_ENV === "development" && !isMailerConfigured()) {
        logger.info("Sign-up confirmation link (dev; mailer not configured)", { confirmUrl });
      }
    }
    return NextResponse.json({ ok: true, message: GENERIC }, { status: 200 });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/auth/resend-verification" });
  }
}
