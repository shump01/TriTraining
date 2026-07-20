import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import {
  InvalidSessionsError,
  NotFoundError,
  UnauthorizedError,
  WeekOutOfRangeError,
  replaceWeekSessions,
} from "@/lib/training-plan";
import { plannerWeekSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/plans/:id/sessions — replace one week's planned sessions (the week
 * planner's only write: day moves and manual ticks both send the whole week).
 * Body: { weekStartDate, sessions: [{ discipline, slot, label, share,
 * dayOffset, done }] }.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "sessions:write", 60, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = plannerWeekSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }

  try {
    await replaceWeekSessions({ planId: id, ...parsed.data });
    return NextResponse.json({ ok: true }, { status: 200 });
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
    if (error instanceof InvalidSessionsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleApiError(error, { route: "PUT /api/plans/[id]/sessions" });
  }
}
