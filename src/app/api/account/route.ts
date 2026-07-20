import { NextResponse, type NextRequest } from "next/server";

import { updateDigestEnabled, updateScreenName } from "@/lib/account";
import { mapKnownApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";
import { disconnectStrava } from "@/lib/strava/connection";
import { requireUserId } from "@/lib/training-plan";
import { updateAccountSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/account — update account preferences: the screen name (empty
 * string clears it) and/or the weekly-digest switch.
 */
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
    if (parsed.data.name !== undefined) {
      await updateScreenName(userId, parsed.data.name);
    }
    if (parsed.data.digestEnabled !== undefined) {
      await updateDigestEnabled(userId, parsed.data.digestEnabled);
    }
    return NextResponse.json(
      {
        ok: true,
        name: parsed.data.name === undefined ? undefined : parsed.data.name.trim() || null,
      },
      { status: 200 },
    );
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
    // Revoke the Strava grant on Strava's side first (their expectation when an
    // account goes away) — strictly best-effort: a Strava outage must never
    // block the user's right to erasure, so any failure falls through to the
    // delete, which removes the stored tokens regardless.
    await disconnectStrava(userId).catch(() => {});
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
