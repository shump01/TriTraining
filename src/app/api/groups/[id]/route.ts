import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { deleteGroup } from "@/lib/groups";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/groups/:id — owner deletes the group (cascades memberships). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "groups:write", 20, 60_000);
  if (limited) return limited;

  const { id } = await params;
  try {
    await deleteGroup(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "DELETE /api/groups/[id]" });
  }
}
