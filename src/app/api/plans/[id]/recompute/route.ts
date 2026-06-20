import { NextResponse, type NextRequest } from "next/server";

import { isCrossSiteRequest } from "@/lib/security";
import { NotFoundError, UnauthorizedError, recomputePlanTargets } from "@/lib/training-plan";
import { recomputePlanSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/plans/:id/recompute
 *
 * Regenerates the plan's weekly targets. An optional body may change the event
 * date and/or per-discipline starting volumes first; an empty body just
 * regenerates from the current values. Scoped to the owning user.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Tolerate an empty body (regenerate with no changes).
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = recomputePlanSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
  }

  try {
    const plan = await recomputePlanTargets(id, parsed.data);
    return NextResponse.json({ ok: true, plan }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw error;
  }
}
