import { NextResponse, type NextRequest } from "next/server";

import { mapKnownApiError } from "@/lib/api";
import { setThresholdHr } from "@/lib/load-data";
import { enforceRateLimit, isCrossSiteRequest } from "@/lib/security";
import { thresholdHrSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/load/threshold — set the athlete's threshold HR (bpm). */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limited = enforceRateLimit(req, "load:threshold", 20, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = thresholdHrSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  try {
    await setThresholdHr(parsed.data.thresholdHr);
    return NextResponse.json({ ok: true, thresholdHr: parsed.data.thresholdHr }, { status: 200 });
  } catch (error) {
    return mapKnownApiError(error, { route: "POST /api/load/threshold" });
  }
}
