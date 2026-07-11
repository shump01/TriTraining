import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { getGroup, getGroupMemberStats } from "@/lib/groups";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/groups/:id — group detail + per-member stats, both
 * membership-gated in the data layer (non-members get 404).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  const { id } = await params;

  try {
    const [group, memberStats] = await Promise.all([getGroup(id), getGroupMemberStats(id)]);
    return NextResponse.json({ group, memberStats }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/groups/[id]" });
  }
}
