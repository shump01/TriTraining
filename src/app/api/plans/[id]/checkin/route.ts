import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { NotFoundError, UnauthorizedError, recordCheckin } from "@/lib/training-plan";
import { checkinSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/plans/:id/checkin — upsert a weekly wellness check-in. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "checkin:write", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = checkinSchema.safeParse(body);
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
    const checkin = await recordCheckin(id, parsed.data);
    return NextResponse.json(
      {
        ok: true,
        checkin: {
          fatigue: checkin.fatigue,
          sleep: checkin.sleep,
          soreness: checkin.soreness,
          note: checkin.note,
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
    return handleApiError(error, { route: "POST /api/plans/[id]/checkin" });
  }
}
