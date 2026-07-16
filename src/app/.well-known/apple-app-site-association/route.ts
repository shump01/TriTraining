import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /.well-known/apple-app-site-association — tells iOS that group-invite
 * links on this domain open the TriTrainer app (universal links). Apple
 * requires 200 + application/json with no redirects.
 *
 * APPLE_TEAM_ID is the 10-character Apple Developer Team ID (developer.apple.com
 * → Membership). Until it's set, respond 404 so devices never cache a bad file.
 */
export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID;
  if (!teamId) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  return NextResponse.json(
    {
      applinks: {
        apps: [],
        details: [
          {
            appID: `${teamId}.uk.co.richysdev.tritrainer`,
            paths: ["/groups/join/*"],
          },
        ],
      },
    },
    { status: 200, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
