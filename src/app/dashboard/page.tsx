import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getStravaConnectionSummary } from "@/lib/strava/connection";

import { SignOutButton } from "./sign-out-button";
import { StravaCard } from "./strava-card";

export const dynamic = "force-dynamic";

const STRAVA_BANNERS: Record<string, string> = {
  connected: "✅ Strava connected.",
  denied: "Strava connection was cancelled.",
  error: "⚠️ Could not connect Strava. Please try again.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ strava?: string }>;
}) {
  // Full server-side validation of the database session. Redirects unauthenticated
  // (or stale-cookie) visitors to /login.
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const { strava } = await searchParams;
  const banner = strava ? STRAVA_BANNERS[strava] : undefined;
  const stravaConnection = await getStravaConnectionSummary(session.user.id);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Dashboard</h1>
      <p>
        You are signed in as <strong>{session.user.email}</strong>.
      </p>

      {banner && (
        <p
          role="status"
          style={{ padding: "0.5rem 0.75rem", background: "#f0f0f0", borderRadius: 4 }}
        >
          {banner}
        </p>
      )}

      <p>
        <Link href="/plans">View your training plans →</Link>
      </p>

      <StravaCard
        connection={
          stravaConnection
            ? {
                athleteId: stravaConnection.athleteId,
                scope: stravaConnection.scope,
                lastSyncedAt: stravaConnection.lastSyncedAt?.toISOString() ?? null,
              }
            : null
        }
      />

      <div style={{ marginTop: "1.5rem" }}>
        <SignOutButton />
      </div>
    </main>
  );
}
