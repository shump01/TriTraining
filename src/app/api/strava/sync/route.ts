import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { syncStravaActivities } from "@/lib/strava/sync";
import { UnauthorizedError, requireUserId } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/strava/sync — pull recent activities into WeeklyActual rows. */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Sync calls the Strava API and writes many rows — keep it modest.
  const limited = enforceRateLimit(req, "strava:sync", 10, 60_000);
  if (limited) return limited;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleApiError(error, { route: "POST /api/strava/sync" });
  }

  try {
    const result = await syncStravaActivities(userId);
    if (!result.ok) {
      return NextResponse.json({ error: "Strava is not connected." }, { status: 409 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error("Strava sync failed", { route: "POST /api/strava/sync", error });
    return NextResponse.json({ error: "Sync failed. Please try again later." }, { status: 502 });
  }
}
