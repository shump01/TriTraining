import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import {
  NotFoundError,
  UnauthorizedError,
  WeekOutOfRangeError,
  deleteManualActual,
  recordManualActual,
} from "@/lib/training-plan";
import { actualDeleteSchema, actualEntrySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/plans/:id/actuals — record a manual weekly actual.
 * Body: { discipline, weekStartDate, actualMeters }. Source is MANUAL, which
 * ADDS to any synced total for that week rather than replacing it (a top-up for
 * sessions a sync couldn't see — see src/lib/actuals.ts).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "actuals:write", 60, 60_000);
  if (limited) return limited;

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
    return handleApiError(error, { route: "POST /api/plans/[id]/actuals" });
  }
}

/**
 * DELETE /api/plans/:id/actuals — remove a manual entry for one (discipline,
 * week). Body: { discipline, weekStartDate }. Only the MANUAL row is cleared;
 * any synced value for that week is untouched.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "actuals:write", 60, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = actualDeleteSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }

  try {
    await deleteManualActual({ planId: id, ...parsed.data });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return handleApiError(error, { route: "DELETE /api/plans/[id]/actuals" });
  }
}
