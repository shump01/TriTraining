import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { deleteStravaConnectionByAthleteId } from "@/lib/strava/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — Strava's subscription validation handshake. Echoes `hub.challenge` when
 * the mode is `subscribe` and (if configured) the verify token matches.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const challenge = params.get("hub.challenge");
  const verifyToken = params.get("hub.verify_token");
  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && challenge && (!expected || verifyToken === expected)) {
    return NextResponse.json({ "hub.challenge": challenge });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

interface StravaWebhookEvent {
  object_type?: string;
  owner_id?: number;
  updates?: { authorized?: string };
}

/**
 * POST — Strava event push. We only act on athlete de-authorization
 * (`updates.authorized === "false"`), removing the connection. Always returns
 * 200 quickly and never throws, so a bad payload can't crash the app.
 *
 * Note: Strava does not sign webhook payloads, so this endpoint is inherently
 * unauthenticated. The only action it performs is deleting a connection on
 * de-auth (low blast radius — the user can simply reconnect). A generous
 * per-IP rate limit guards against abuse.
 */
export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "strava:webhook", 120, 60_000);
  if (limited) return limited;

  try {
    const event = (await req.json()) as StravaWebhookEvent;
    if (event.object_type === "athlete" && String(event.updates?.authorized) === "false") {
      if (event.owner_id != null) {
        await deleteStravaConnectionByAthleteId(String(event.owner_id));
      }
    }
  } catch (error) {
    logger.error("Strava webhook handling error", { route: "POST /api/strava/webhook", error });
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
