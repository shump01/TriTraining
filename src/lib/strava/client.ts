import { env } from "@/env";

/**
 * Thin wrapper around Strava's OAuth token endpoints. Network/HTTP errors throw
 * `StravaTokenError`; `invalidGrant` distinguishes a revoked/expired refresh
 * token (the connection should be dropped) from transient failures.
 */
const STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
const STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

/** Requested scopes: read profile + read activities. */
export const STRAVA_SCOPES = "read,activity:read";

export class StravaTokenError extends Error {
  readonly invalidGrant: boolean;
  constructor(message: string, invalidGrant = false) {
    super(message);
    this.name = "StravaTokenError";
    this.invalidGrant = invalidGrant;
  }
}

export interface StravaTokens {
  athleteId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Subset of refresh data (a refresh response carries no athlete). */
export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: `${env.NEXTAUTH_URL}/api/strava/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_SCOPES,
    state,
  });
  return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(body: Record<string, string>): Promise<StravaTokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (res.status === 400 || res.status === 401) {
    // Strava returns these for invalid/expired/revoked grants.
    throw new StravaTokenError(`Strava token request rejected (${res.status})`, true);
  }
  if (!res.ok) {
    throw new StravaTokenError(`Strava token request failed (${res.status})`);
  }
  return (await res.json()) as StravaTokenResponse;
}

export async function exchangeCodeForTokens(code: string): Promise<StravaTokens> {
  const data = await postToken({
    client_id: env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
  });
  if (!data.athlete?.id) {
    throw new StravaTokenError("Strava token response missing athlete id");
  }
  return {
    athleteId: String(data.athlete.id),
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  };
}

export async function refreshStravaTokens(refreshToken: string): Promise<RefreshedTokens> {
  const data = await postToken({
    client_id: env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  };
}

/** Best-effort revoke on Strava's side. Caller ignores failures. */
export async function deauthorizeStrava(accessToken: string): Promise<void> {
  await fetch(STRAVA_DEAUTHORIZE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
  });
}

// ── Activities ───────────────────────────────────────────────────────────────

/** Non-token Strava API error (e.g. 5xx). */
export class StravaApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StravaApiError";
  }
}

/** Normalized activity (only the fields sync needs). */
export interface StravaActivitySummary {
  sportType: string | undefined;
  distanceMeters: number;
  startDateLocal: string;
}

export interface FetchActivitiesResult {
  activities: StravaActivitySummary[];
  /** True if a 429 was hit and pagination stopped early (partial result). */
  rateLimited: boolean;
}

interface RawActivity {
  sport_type?: string;
  type?: string;
  distance?: number;
  start_date_local?: string;
}

interface FetchActivitiesOptions {
  /** Only fetch activities after this unix-seconds timestamp. */
  afterEpochSeconds?: number;
  perPage?: number;
  maxRetriesPer429?: number;
  /** Injectable for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch the athlete's activities, paginating until exhausted. Handles HTTP 429
 * with exponential backoff (honoring `Retry-After` when present); if the rate
 * limit persists past `maxRetriesPer429`, it stops paginating and returns what
 * it has with `rateLimited: true` — it never throws on a 429, so a rate limit
 * can't fail the whole sync.
 */
export async function fetchRecentActivities(
  accessToken: string,
  options: FetchActivitiesOptions = {},
): Promise<FetchActivitiesResult> {
  const perPage = options.perPage ?? 200;
  const maxRetries = options.maxRetriesPer429 ?? 3;
  const sleep = options.sleep ?? defaultSleep;

  const activities: StravaActivitySummary[] = [];
  let rateLimited = false;

  for (let page = 1; ; page++) {
    let batch: RawActivity[] | null = null;

    for (let attempt = 0; ; attempt++) {
      const url = new URL(STRAVA_ACTIVITIES_URL);
      url.searchParams.set("per_page", String(perPage));
      url.searchParams.set("page", String(page));
      if (options.afterEpochSeconds) {
        url.searchParams.set("after", String(options.afterEpochSeconds));
      }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

      if (res.status === 429) {
        if (attempt >= maxRetries) {
          rateLimited = true;
          break; // give up on this page; stop paginating
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
        await sleep(delayMs);
        continue;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new StravaApiError(
          `Strava activities request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }

      batch = (await res.json()) as RawActivity[];
      break;
    }

    if (batch === null) break; // rate-limited: graceful partial result

    for (const a of batch) {
      activities.push({
        sportType: a.sport_type ?? a.type,
        distanceMeters: a.distance ?? 0,
        startDateLocal: a.start_date_local ?? "",
      });
    }

    if (batch.length < perPage) break; // last page
  }

  return { activities, rateLimited };
}
