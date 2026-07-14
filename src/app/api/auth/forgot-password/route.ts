import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { handleApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { sendPasswordResetEmail } from "@/lib/mailer";
import { createPasswordResetToken } from "@/lib/password-reset";
import { rateLimit } from "@/lib/rate-limit";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { forgotPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 15 * 60_000; // 15 minutes
const MAX_PER_WINDOW = 3;

// Deliberately identical for every request — never reveals whether an account exists.
const GENERIC_MESSAGE =
  "If an account exists for that address, we've sent a link to reset your password.";

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

  // Per-email limit — same behavior whether or not the account exists, so it
  // can't be used to enumerate, while still stopping reset-email bombing.
  const emailLimit = rateLimit(`auth:forgot:email:${email}`, MAX_PER_WINDOW, WINDOW_MS);
  if (!emailLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } },
    );
  }

  try {
    const rawToken = await createPasswordResetToken(email);
    if (rawToken) {
      const resetUrl = `${env.NEXTAUTH_URL}/reset-password/${rawToken}`;
      const sent = await sendPasswordResetEmail(email, resetUrl);
      if (!sent) {
        // Dev has no SMTP — surface the link in logs so the flow is testable.
        // Production only records that delivery was skipped (never the link).
        if (env.NODE_ENV === "development") {
          logger.info("Password-reset link (dev; mailer not configured)", { resetUrl });
        } else {
          logger.warn("Password-reset email not sent — mailer is not configured");
        }
      }
    }
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE }, { status: 200 });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/auth/forgot-password" });
  }
}
