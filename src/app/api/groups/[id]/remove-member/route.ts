import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { removeMember } from "@/lib/groups";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { removeMemberSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/groups/:id/remove-member — owner removes a member. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "groups:write", 20, 60_000);
  if (limited) return limited;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = removeMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    await removeMember(id, parsed.data.userId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/groups/[id]/remove-member" });
  }
}
