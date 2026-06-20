import { NextResponse, type NextRequest } from "next/server";

import { isCrossSiteRequest } from "@/lib/security";
import {
  UnauthorizedError,
  createTrainingPlanWithDisciplines,
  listTrainingPlans,
} from "@/lib/training-plan";
import { createPlanSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/plans — list the authenticated user's plans (scoped by session). */
export async function GET() {
  try {
    const plans = await listTrainingPlans();
    return NextResponse.json({ plans }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}

/** POST /api/plans — create a plan + its three disciplines for the current user. */
export async function POST(req: NextRequest) {
  // CSRF: reject cross-site requests.
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Server-side validation. Any `userId` in the body is ignored — the schema
  // doesn't include it, and the user is derived from the session below.
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }

  try {
    const plan = await createTrainingPlanWithDisciplines(parsed.data);
    return NextResponse.json(
      { ok: true, plan: { id: plan.id, name: plan.name, eventDate: plan.eventDate } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
