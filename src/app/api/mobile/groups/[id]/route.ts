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
    return NextResponse.json(
      {
        group,
        // Wire-format shim: the shipped app binary's zod schema REQUIRES
        // `activePlanName` on every member (`.nullable()`, which rejects a
        // missing key) and hard-parses the response — omit it and the Groups
        // screen errors for everyone on an older app. The field itself was
        // removed from MemberStat on purpose (members shouldn't see each
        // other's race names; see group-stats.ts), so it is pinned to null
        // here rather than restored. The app never rendered it. Removable
        // once no binaries with the required field remain in the wild.
        memberStats: memberStats.map((m) => ({ ...m, activePlanName: null })),
      },
      { status: 200 },
    );
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/groups/[id]" });
  }
}
