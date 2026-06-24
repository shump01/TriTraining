import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { disconnectStrava } from "@/lib/strava/connection";
import { UnauthorizedError, requireUserId } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/strava/disconnect — revoke on Strava (best effort) and delete the link. */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "strava:disconnect", 10, 60_000);
  if (limited) return limited;

  try {
    const userId = await requireUserId();
    await disconnectStrava(userId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleApiError(error, { route: "POST /api/strava/disconnect" });
  }
}
