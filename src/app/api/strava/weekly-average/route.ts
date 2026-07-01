import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/security";
import { getRecentWeeklyAverages } from "@/lib/strava/weekly-average";
import { UnauthorizedError, requireUserId } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/strava/weekly-average — average weekly distance per discipline
 * over the last 4 completed weeks, computed from Strava activity history.
 * Used to suggest a starting weekly volume when creating a new plan.
 */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "strava:weekly-average", 20, 60_000);
  if (limited) return limited;

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handleApiError(error, { route: "GET /api/strava/weekly-average" });
  }

  try {
    const result = await getRecentWeeklyAverages(userId);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/strava/weekly-average" });
  }
}
