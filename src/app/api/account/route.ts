import { NextResponse, type NextRequest } from "next/server";

import { updateScreenName } from "@/lib/account";
import { mapKnownApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { requireUserId } from "@/lib/training-plan";
import { updateAccountSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/account — update the screen name (empty string clears it). */
export async function PATCH(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "account:write", 20, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = updateAccountSchema.safeParse(body);
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
    await updateScreenName(userId, parsed.data.name);
    return NextResponse.json({ ok: true, name: parsed.data.name.trim() || null }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "PATCH /api/account" });
  }
}

/**
 * DELETE /api/account — delete the session user and, via the schema's cascades,
 * all their data: plans (targets/actuals), group memberships, owned groups,
 * sessions, and the Strava connection. Required for App Store review
 * (Guideline 5.1.1(v): in-app account deletion).
 */
export async function DELETE(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "account:delete", 5, 60_000);
  if (limited) return limited;

  try {
    const userId = await requireUserId();
    await prisma.user.delete({ where: { id: userId } });
    // The session rows are gone with the user; clear the now-dead cookie too so
    // the web client lands cleanly on the public pages. No-op for bearer clients.
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  } catch (error) {
    return mapKnownApiError(error, { route: "DELETE /api/account" });
  }
}
