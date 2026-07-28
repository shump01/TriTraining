import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import {
  StravaTokenError,
  type StravaTokens,
  deauthorizeStrava,
  refreshStravaTokens,
} from "./client";
import { decryptSecret, encryptSecret } from "./crypto";

// Refresh a little before actual expiry to avoid races with in-flight requests.
const REFRESH_BUFFER_MS = 60_000;

/** Create or update the current user's Strava connection (tokens encrypted). */
export async function upsertStravaConnection(
  userId: string,
  tokens: StravaTokens,
  scope: string,
): Promise<void> {
  const data = {
    athleteId: tokens.athleteId,
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: encryptSecret(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    scope,
  };
  await prisma.stravaConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

/** Non-sensitive connection summary for the UI (no tokens). */
export async function getStravaConnectionSummary(userId: string) {
  return prisma.stravaConnection.findUnique({
    where: { userId },
    select: { athleteId: true, scope: true, expiresAt: true, lastSyncedAt: true },
  });
}

/**
 * Return a currently-valid Strava access token for the user, refreshing first if
 * it is expired (or about to be). Persists rotated tokens (encrypted).
 *
 * Never throws: returns `null` when the user isn't connected, when the refresh
 * token was revoked (the dead connection is removed), or on any transient
 * failure — so callers (and the app) never crash on a bad token.
 */
export async function getValidStravaAccessToken(userId: string): Promise<string | null> {
  const connection = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  const stillValid = connection.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS;
  if (stillValid) {
    try {
      return decryptSecret(connection.accessToken);
    } catch {
      return null;
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(connection.refreshToken);
  } catch {
    return null;
  }

  try {
    const refreshed = await refreshStravaTokens(refreshToken);
    await prisma.stravaConnection.update({
      where: { userId },
      data: {
        accessToken: encryptSecret(refreshed.accessToken),
        refreshToken: encryptSecret(refreshed.refreshToken),
        expiresAt: refreshed.expiresAt,
      },
    });
    return refreshed.accessToken;
  } catch (error) {
    if (error instanceof StravaTokenError && error.invalidGrant) {
      // Token revoked / deauthorized — drop the unusable connection.
      await prisma.stravaConnection.delete({ where: { userId } }).catch(() => {});
    } else {
      logger.error("Strava token refresh failed", { error });
    }
    return null;
  }
}

/**
 * Everything Strava's sync wrote that is still recognisably THEIR data: the
 * per-activity heart-rate rows behind training load, each keyed by the Strava
 * activity id it came from. Revoking the grant has to take these with it —
 * Strava's API terms require deleting a user's data once they deauthorize, and
 * keeping a per-activity record of someone's heart rate after they told us to
 * stop is the wrong answer regardless of what the terms say.
 *
 * Scoped to `source: "STRAVA"`. The same table holds Apple Health and Garmin
 * rows for the same user, and those are none of Strava's business.
 *
 * NOT deleted: `WeeklyActual` rows. Those are weekly distance totals against a
 * training plan — the athlete's own training record, aggregated past the point
 * of being per-activity Strava data, and visible in the plan they built around
 * them. Silently blanking a season of progress because someone unlinked an
 * integration is a bigger harm than the one being fixed. Deleting the account
 * still removes them, via the cascade.
 */
async function deleteStravaDerivedData(userId: string): Promise<void> {
  await prisma.activityLoad
    .deleteMany({ where: { userId, source: "STRAVA" } })
    .catch((error: unknown) => {
      logger.warn("Failed to clear Strava training-load rows on disconnect", { error });
    });
}

/**
 * Disconnect: best-effort revoke on Strava, then delete the local row and the
 * data that came from it.
 *
 * The revoke uses a REFRESHED access token, not the stored one: Strava access
 * tokens expire in ~6 hours, so for any user who hasn't synced recently the
 * stored token is dead and deauthorization would silently no-op — leaving the
 * grant live on Strava's side while the privacy policy (and the account-
 * deletion flow) promise it was revoked. Still best-effort: a Strava outage
 * must never block the local delete or the user's right to erasure.
 */
export async function disconnectStrava(userId: string): Promise<void> {
  const connection = await prisma.stravaConnection.findUnique({ where: { userId } });
  if (!connection) return;

  try {
    // Refreshes when expired (and persists the new tokens); null when the
    // grant is already gone on Strava's side, in which case there is nothing
    // left to revoke and the local delete below is the whole job.
    const accessToken = await getValidStravaAccessToken(userId);
    if (accessToken) {
      await deauthorizeStrava(accessToken);
    }
  } catch (error) {
    logger.warn("Strava deauthorize failed; continuing with local delete", { error });
  }

  await prisma.stravaConnection.delete({ where: { userId } }).catch(() => {});
  await deleteStravaDerivedData(userId);
}

/**
 * Remove a connection by Strava athlete id (used by the deauthorization
 * webhook — the user revoked us from Strava's side, so there is no grant left
 * to revoke and nothing to call back about). Clears the same derived data as
 * `disconnectStrava`: the two paths mean the same thing to the user.
 *
 * Only reached when `STRAVA_WEBHOOK_VERIFY_TOKEN` is configured and the
 * subscription is registered with Strava — which is optional (see DEPLOY.md).
 * Without it a revoke on Strava's side is silent, so don't promise users
 * anywhere that it cleans up on its own; the in-app Disconnect is the path
 * that is always there.
 */
export async function deleteStravaConnectionByAthleteId(athleteId: string): Promise<void> {
  const connections = await prisma.stravaConnection.findMany({
    where: { athleteId },
    select: { userId: true },
  });
  await prisma.stravaConnection.deleteMany({ where: { athleteId } });
  for (const { userId } of connections) {
    await deleteStravaDerivedData(userId);
  }
}
