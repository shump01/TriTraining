import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { regenerateInviteToken } from "@/lib/groups";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/groups/:id/regenerate-invite — owner rotates the invite link. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "groups:write", 20, 60_000);
  if (limited) return limited;

  const { id } = await params;
  try {
    const token = await regenerateInviteToken(id);
    return NextResponse.json({ ok: true, token }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/groups/[id]/regenerate-invite" });
  }
}
