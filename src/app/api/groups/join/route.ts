import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { joinGroupByToken } from "@/lib/groups";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { joinGroupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/groups/join — join a group by its invite token (idempotent). */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "groups:write", 20, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = joinGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid invite." }, { status: 400 });
  }

  try {
    const group = await joinGroupByToken(parsed.data.token);
    return NextResponse.json(
      { ok: true, group: { id: group.id, name: group.name } },
      { status: 200 },
    );
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/groups/join" });
  }
}
