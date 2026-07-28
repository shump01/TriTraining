import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { ingestHealthWorkouts } from "@/lib/health/ingest";
import { enforceBodyLimit, enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { requireUserId } from "@/lib/training-plan";
import { healthIngestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/health/ingest — replace the user's APPLE_HEALTH weekly actuals
 * from a full batch of normalized HealthKit workouts (§4.4). The app sends
 * everything since the earliest plan week; ingest is an idempotent replace.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Ingest rewrites many rows — keep it as modest as Strava sync.
  const limited = enforceRateLimit(req, "health:ingest", 10, 60_000);
  if (limited) return limited;

  // The largest legitimate body in the app: up to 10,000 workouts (the schema
  // cap) at ~150 bytes each. Checked BEFORE req.json() buffers the whole thing.
  const tooBig = enforceBodyLimit(req, 4 * 1024 * 1024);
  if (tooBig) return tooBig;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = healthIngestSchema.safeParse(body);
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
    const result = await ingestHealthWorkouts(userId, parsed.data.workouts);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/health/ingest" });
  }
}
