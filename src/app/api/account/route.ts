import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { requireUserId } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "DELETE /api/account" });
  }
}
