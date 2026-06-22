import { NextResponse, type NextRequest } from "next/server";

import { isCrossSiteRequest } from "@/lib/security";
import {
  NotFoundError,
  UnauthorizedError,
  WeekOutOfRangeError,
  recordManualActual,
} from "@/lib/training-plan";
import { actualEntrySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/plans/:id/actuals — manually record/override a weekly actual.
 * Body: { discipline, weekStartDate, actualMeters }. Source is always MANUAL,
 * which takes precedence over STRAVA for that week (see src/lib/actuals.ts).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = actualEntrySchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }

  try {
    const actual = await recordManualActual({ planId: id, ...parsed.data });
    return NextResponse.json(
      {
        ok: true,
        actual: {
          discipline: actual.discipline,
          weekStartDate: actual.weekStartDate,
          actualMeters: actual.actualMeters,
          source: actual.source,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof WeekOutOfRangeError) {
      return NextResponse.json(
        { error: "That week is outside the plan's date range." },
        { status: 400 },
      );
    }
    throw error;
  }
}
