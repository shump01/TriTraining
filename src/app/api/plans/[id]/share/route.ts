import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { NotFoundError, UnauthorizedError, setPlanSharing } from "@/lib/training-plan";
import { shareSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/plans/:id/share — enable/disable the public read-only share link. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "plans:share", 20, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const token = await setPlanSharing(id, parsed.data.enabled);
    return NextResponse.json({ ok: true, token }, { status: 200 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return handleApiError(error, { route: "POST /api/plans/[id]/share" });
  }
}
