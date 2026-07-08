import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { leaveGroup } from "@/lib/groups";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/groups/:id/leave — a non-owner member leaves the group. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "groups:write", 20, 60_000);
  if (limited) return limited;

  const { id } = await params;
  try {
    await leaveGroup(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/groups/[id]/leave" });
  }
}
