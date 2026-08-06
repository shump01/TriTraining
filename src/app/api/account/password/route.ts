import { NextResponse, type NextRequest } from "next/server";

import { WrongPasswordError, changePassword } from "@/lib/account";
import { mapKnownApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";
import { requireUserId } from "@/lib/training-plan";
import { changePasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/password — change the password while signed in.
 *
 * Requires the current password (so a walk-up attacker with an unlocked device
 * can't silently take the account) and enforces the sign-up password policy on
 * the new one. On success EVERY session is revoked and the caller's is rotated
 * to a fresh token, so no credential that existed before the change survives
 * it — including the caller's own, which may itself be the compromised one.
 *
 * The rotated token is delivered the same way login delivers it: a refreshed
 * cookie for web, plus the token in the JSON body for the mobile client
 * (`X-Client: mobile`), which stores it and sends it as a Bearer header. Both
 * therefore stay signed in across the change.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // As tight as the login/reset flows — this endpoint verifies passwords.
  const limited = enforceRateLimit(req, "account:password", 5, 15 * 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ message: i.message })),
      },
      { status: 400 },
    );
  }

  try {
    const userId = await requireUserId();

    const { sessionToken, expires } = await changePassword(
      userId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    // Mirror the login route: the mobile client can't use the httpOnly cookie,
    // so it needs the rotated token in the body or it would be signed out.
    const isMobileClient = req.headers.get("x-client") === "mobile";
    const res = NextResponse.json(
      isMobileClient ? { ok: true, sessionToken, expires: expires.toISOString() } : { ok: true },
      { status: 200 },
    );
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      ...sessionCookieOptions,
      expires,
    });
    return res;
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return mapKnownApiError(error, { route: "POST /api/account/password" });
  }
}
