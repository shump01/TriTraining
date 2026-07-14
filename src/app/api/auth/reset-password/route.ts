import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { resetPassword } from "@/lib/password-reset";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { resetPasswordSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/reset-password — set a new password using a reset token. */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "auth:reset", 5, 15 * 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    // Surface only the password-policy message (safe); never anything about the token.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    const ok = await resetPassword(parsed.data.token, parsed.data.password);
    if (!ok) {
      return NextResponse.json(
        { error: "This reset link is invalid or has expired. Request a new one." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: true, message: "Your password has been updated. You can now sign in." },
      { status: 200 },
    );
  } catch (error) {
    return handleApiError(error, { route: "POST /api/auth/reset-password" });
  }
}
