import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { getGroupByToken } from "@/lib/groups";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/groups/join-info/:token — group name + member count for the
 * join-confirmation screen (auth required; mirrors the web join page).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  const { token } = await params;

  try {
    const group = await getGroupByToken(token);
    if (!group) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ group }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/groups/join-info/[token]" });
  }
}
