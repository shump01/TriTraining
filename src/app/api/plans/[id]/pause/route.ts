import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { NotFoundError, UnauthorizedError, clearPause, recordPause } from "@/lib/training-plan";
import { clearPauseSchema, pauseSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validationError(issues: { message: string }[]) {
  return NextResponse.json({ error: "Validation failed", issues }, { status: 400 });
}

function mapError(error: unknown, route: string) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return handleApiError(error, { route });
}

/** POST /api/plans/:id/pause — mark a week as time off (ill / injured / away). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "pause:write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = pauseSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => ({ message: i.message })));
  }

  try {
    const pause = await recordPause(id, parsed.data);
    return NextResponse.json(
      { ok: true, pause: { reason: pause.reason, note: pause.note } },
      { status: 200 },
    );
  } catch (error) {
    return mapError(error, "POST /api/plans/[id]/pause");
  }
}

/** DELETE /api/plans/:id/pause — un-pause a week. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "pause:write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = clearPauseSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => ({ message: i.message })));
  }

  try {
    await clearPause(id, parsed.data.weekStartDate);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return mapError(error, "DELETE /api/plans/[id]/pause");
  }
}
