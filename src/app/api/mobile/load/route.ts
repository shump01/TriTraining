import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { getTrainingLoad } from "@/lib/load-data";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/load — JSON mirror of the training-load page's server data
 * (src/app/(app)/load/page.tsx): threshold HR, the daily CTL/ATL/TSB series,
 * and the current summary. Empty series/summary until a threshold is set and
 * HR-recorded activities have been synced.
 */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  try {
    const load = await getTrainingLoad();
    return NextResponse.json(load, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/load" });
  }
}
