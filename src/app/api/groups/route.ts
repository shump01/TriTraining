import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { createGroup } from "@/lib/groups";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { createGroupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/groups — create a group owned by the current user. */
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

  const parsed = createGroupSchema.safeParse(body);
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
    const group = await createGroup(parsed.data.name);
    return NextResponse.json(
      { ok: true, group: { id: group.id, name: group.name } },
      { status: 201 },
    );
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/groups" });
  }
}
