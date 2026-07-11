import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/security";
import { listTrainingPlansWithProgress } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mobile/plans — the user's plans with combined progress summaries. */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  try {
    const plans = await listTrainingPlansWithProgress();
    return NextResponse.json({ plans }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/plans" });
  }
}
