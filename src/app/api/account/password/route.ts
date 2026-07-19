import { NextResponse, type NextRequest } from "next/server";

import { WrongPasswordError, changePassword } from "@/lib/account";
import { mapKnownApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { requireUserId } from "@/lib/training-plan";
import { changePasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/password — change the password while signed in.
 *
 * Requires the current password (so a walk-up attacker with an unlocked device
 * can't silently take the account), enforces the sign-up password policy on the
 * new one, and revokes every OTHER session on success — the session performing
 * the change stays signed in, whichever transport carried it (cookie or the
 * mobile bearer token).
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

    // The session to KEEP: the cookie session, or the mobile bearer token.
    const bearer = req.headers.get("authorization");
    const bearerToken = bearer?.toLowerCase().startsWith("bearer ")
      ? bearer.slice("bearer ".length).trim()
      : null;
    const keepToken = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? bearerToken ?? null;

    await changePassword(userId, parsed.data.currentPassword, parsed.data.newPassword, keepToken);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return mapKnownApiError(error, { route: "POST /api/account/password" });
  }
}
