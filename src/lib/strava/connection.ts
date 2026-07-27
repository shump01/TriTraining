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
 * Disconnect: best-effort revoke on Strava, then delete the local row.
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
}

/** Remove a connection by Strava athlete id (used by the deauthorization webhook). */
export async function deleteStravaConnectionByAthleteId(athleteId: string): Promise<void> {
  await prisma.stravaConnection.deleteMany({ where: { athleteId } });
}
