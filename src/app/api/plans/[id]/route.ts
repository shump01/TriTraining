import { NextResponse, type NextRequest } from "next/server";

import { isCrossSiteRequest } from "@/lib/security";
import {
  NotFoundError,
  PlanDateRangeError,
  UnauthorizedError,
  deleteTrainingPlan,
  updateTrainingPlan,
} from "@/lib/training-plan";
import { createPlanSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/plans/:id — full edit of a plan (name, dates, disciplines + volumes).
 * Regenerates the weekly targets. Scoped to the owning user.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }

  try {
    const plan = await updateTrainingPlan(id, parsed.data);
    return NextResponse.json({ ok: true, plan: { id: plan!.id } }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof PlanDateRangeError) {
      return NextResponse.json(
        { error: "Validation failed", issues: [{ path: "startDate", message: error.message }] },
        { status: 400 },
      );
    }
    throw error;
  }
}

/** DELETE /api/plans/:id — delete a plan and all its data. Scoped to the owner. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const deleted = await deleteTrainingPlan(id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
