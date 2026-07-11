import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { listMyGroups } from "@/lib/groups";
import { enforceRateLimit } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/mobile/groups — groups the user belongs to, with member counts. */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "mobile:read", 120, 60_000);
  if (limited) return limited;

  try {
    const groups = await listMyGroups();
    return NextResponse.json({ groups }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "GET /api/mobile/groups" });
  }
}
