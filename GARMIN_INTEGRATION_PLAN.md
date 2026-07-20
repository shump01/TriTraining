# Garmin integration plan

Add Garmin as a third activity source alongside Strava and Apple Health: completed
workouts flow from a Garmin device into weekly actuals and HR training load, with
the same one-source-of-truth doctrine the existing providers follow.

Status: **Phase 1 (provider-neutral groundwork) implemented; Phases 2–4 blocked on
Garmin API access** — see §1. Research verified 2026-07-20; re-verify §1 before
starting Phase 2 (the program status and API details may have changed).

---

## 1. Access — the external blocker

**Garmin has paused new Connect Developer Program applications** (since ~March
2026). The access request form is down ("Under Construction") and Garmin support
confirms new API access requests are not being reviewed, with no timeline, while
the program is "modernized". Existing partners are unaffected.

When it reopens:

- **Business-only eligibility.** The program is explicitly for business use;
  individual applications have been rejected. Apply as a sole trader/business
  with a use-case justification. Free — no licensing fees for standard summaries.
- **Which APIs to request:** **Activity API** (inbound completed workouts — the
  one this plan needs). Optionally later: Training API (push planned workouts to
  the athlete's device — a compelling future feature), Health API (sleep/wellness
  for readiness context).
- **Keys:** the first app gets an **evaluation key** (real prod endpoints,
  throttled, small user cap). **Production** comes via the portal's Partner
  Verification tool — automated checks requiring a working push integration,
  data from ≥2 real Garmin accounts, and deregistration + permission-change
  endpoints configured.
- **Brand guidelines (June 2025, strict):** every primary display of
  Garmin-sourced data must show "Garmin [device model]" adjacent to the title,
  above the fold (not tooltips/footnotes); derived analytics (our
  Fitness/Fatigue/Form) must credit "derived in part from Garmin device-sourced
  data"; exports must retain attribution.

**Route decision: direct API (wait for reopening), not an aggregator** (Terra,
Spike, Rook…). Aggregators work today but add per-user cost and a new data
processor to the privacy policy — wrong trade for a free app. Monitor
developer.garmin.com monthly; interest can be registered via
connect-support@developer.garmin.com.

## 2. Verified API facts the design rests on

- **OAuth2 + PKCE + client secret** (server-side, confidential client).
  Authorize: `https://connect.garmin.com/oauth2Confirm`; token:
  `https://diauth.garmin.com/di-oauth2-service/oauth/token`. Access token 24 h;
  **refresh token ~90 days and ROTATES on every refresh** — always persist the
  newly returned refresh token. Scopes are fixed per app, not per request.
  Stable Garmin user id from `GET /wellness-api/rest/user/id`; granted
  permissions from `GET /wellness-api/rest/user/permissions` (want
  `ACTIVITY_EXPORT`).
- **Delivery is event-driven — no polling.** Register HTTPS endpoints per
  summary type at `https://apis.garmin.com/tools/endpoints`, choosing **Push**
  (full JSON in the POST — our choice) or Ping/Pull. Garmin POSTs within
  minutes of a device sync; respond 200 fast (~30 s timeout), even for unknown
  users; payloads batch multiple users/activities — always iterate arrays.
  Retries back off; **Garmin retains data server-side only ~7 days**, so our own
  durable store is mandatory (hence `GarminActivity`, §3).
- **Activity summary fields:** `summaryId` (delivery dedup), `activityId`
  (stable per activity — the upsert key), `activityType` (UPPER_SNAKE, e.g.
  `LAP_SWIMMING`, `OPEN_WATER_SWIMMING`, `ROAD_BIKING`, `INDOOR_CYCLING`,
  `RUNNING`, `TREADMILL_RUNNING`), `startTimeInSeconds` (UTC) +
  `startTimeOffsetInSeconds` (derive local time), `durationInSeconds`,
  `distanceInMeters`, `averageHeartRateInBeatsPerMinute`, `deviceName`,
  `manual`, and multisport linkage: `isParent` / `parentSummaryId` — a
  triathlon is a `MULTI_SPORT` parent with swim/bike/run child legs plus
  `TRANSITION` segments. The full activityType list (Appendix A) is
  portal-gated; unknown types must be handled leniently (ignored).
- **Backfill:** `GET /wellness-api/rest/backfill/activities?summaryStartTimeInSeconds=…&summaryEndTimeInSeconds=…`
  → HTTP 202, then data arrives async on the same push endpoints (same code
  path, free idempotency). ≤90 days per request; duplicate window → 409;
  ~2-year per-user history cap; evaluation keys throttled to ~100
  days-of-data/minute (queue chunks).
- **Deregistration:** Garmin-side revocation arrives on a deregistration
  webhook (delete the connection). Our-side disconnect **must** call
  `DELETE https://apis.garmin.com/wellness-api/rest/user/registration`
  (documented requirement) — same best-effort pattern as Strava revocation,
  including on account deletion. Permission changes arrive on a
  `User_Permission` webhook → re-read `/user/permissions`.

## 3. Design decisions

**The write model is the one genuinely new piece.** Strava sync and Apple
Health ingest both do source-scoped _full replaces_ from a complete activity
list they can re-fetch at will. Garmin pushes are incremental per-activity
events and Garmin only retains ~7 days — we can never re-fetch history. So:

- **`GarminActivity` table = our durable per-activity store.** Webhook upserts
  on `(userId, activityId)` (updated activities arrive as new summaries for the
  same `activityId`; `summaryId` changes per delivery). Only rows that map to a
  tracked discipline are stored; `MULTI_SPORT` parents and `TRANSITION`
  segments are skipped at normalization time (legs carry the real data).
- **Recompute, don't accumulate.** After each upsert batch (and after
  backfill deliveries), GARMIN-sourced `WeeklyActual` + `ActivityLoad` rows are
  recomputed from the full `GarminActivity` set via the provider-neutral
  builders in [sync-core.ts](src/lib/strava/sync-core.ts) — a source-scoped
  transactional replace, exactly the doctrine the other writers follow ("each
  writer replaces only its own source's rows"). Deletions on Garmin's side are
  the one thing this can't see (no delete webhook in the public docs — Phase 3
  should re-check); an activity deleted in Garmin Connect persists here until
  reconnect/backfill or manual override.
- **Precedence:** `MANUAL(4) > STRAVA(3) > GARMIN(2) > APPLE_HEALTH(1)` in
  [actuals.ts](src/lib/actuals.ts); load source chain in
  [load-data.ts](src/lib/load-data.ts): STRAVA if connected → GARMIN if
  connected → APPLE_HEALTH. Rationale: many Garmin users auto-mirror to Strava;
  Strava-on-top means connecting Garmin never silently changes an existing
  Strava user's numbers. (Flippable later; it's one rank table + one chain.)
- **Tokens:** encrypted with the existing AES-256-GCM helper
  ([crypto.ts](src/lib/strava/crypto.ts) — provider-neutral). The refresh
  helper must persist the rotated refresh token on every refresh (differs from
  Strava, where the refresh token is long-lived).
- **Dormant by design:** `GARMIN_CLIENT_ID`/`GARMIN_CLIENT_SECRET` are optional
  env vars; connect UI renders only when both are set. Everything in Phase 1
  ships inert — no GarminConnection rows can exist until OAuth lands.

## 4. Phases

### Phase 1 — provider-neutral groundwork (no credentials needed) ✅

- **Schema + migration** (additive, safe against a live old-code server):
  `GARMIN` enum value; `GarminConnection` (garminUserId, encrypted
  access/refresh tokens, accessExpiresAt, permissions, lastEventAt);
  `GarminActivity` (activityId/summaryId, sportType, startTimeUtc +
  offsetSeconds, distanceMeters, durationSeconds, avgHr, deviceName);
  `User.garminConnection` / `User.garminActivities` relations.
- **Precedence + load chain + UI unions/labels** (dashboard recent-actual
  label, plan-detail actual cell, load page prose).
- **`src/lib/garmin/core.ts`** (pure): `mapGarminActivityType` (lenient,
  multisport-aware), `normalizeGarminActivities` → sync-core `ActivityInput` /
  `ActivityHrInput` shapes (local time from UTC + offset).
- **`src/lib/garmin/recompute.ts`**: `recomputeGarminDerivedRows(userId)` —
  reads `GarminActivity`, fans out per-plan weekly buckets (mirrors
  [sync.ts](src/lib/strava/sync.ts)), transactionally replaces GARMIN-sourced
  rows on both tables.
- Optional env vars + `.env.example`; unit tests for all pure logic + the
  recompute's source scoping.

### Phase 2 — OAuth (needs credentials)

- `src/lib/garmin/client.ts` (authorize URL with PKCE challenge, token
  exchange/refresh-with-rotation, user id + permissions fetch, deregistration
  DELETE) + `connection.ts` (upsert encrypted, getValidAccessToken with rotation
  persist, disconnect).
- Routes `src/app/api/garmin/{connect,callback,disconnect}` — clone the Strava
  route pattern: signed HMAC state + nonce cookie
  ([oauth-state.ts](src/lib/strava/oauth-state.ts) is reusable), the standard
  guard order, `NEXTAUTH_URL`-based redirects. PKCE verifier rides in a short
  httpOnly cookie alongside the state nonce.
- Dashboard Garmin card (sibling of [strava-card.tsx](<src/app/(app)/dashboard/strava-card.tsx>))
  with the mandated "Garmin" attribution; feature-flagged on env presence.
- Account deletion: best-effort Garmin deregistration next to
  `disconnectStrava` in [route.ts](src/app/api/account/route.ts).

### Phase 3 — data flow (needs credentials)

- `POST /api/garmin/webhook` — fast-200, tolerant of batched arrays; resolves
  users by garminUserId; normalizes + upserts `GarminActivity`; queues a
  recompute per affected user. Unauthenticated by design (like the Strava
  webhook: Garmin doesn't sign payloads publicly — re-check portal docs; guard
  with rate limit + strict zod + unknown-user 200s).
- Deregistration + permission-change endpoints (delete connection / re-read
  permissions).
- Backfill-on-connect: chunked ≤90-day requests from the earliest plan week,
  respecting the evaluation throttle; 409s treated as already-requested.
- Endpoint registration in Garmin's tool; on-Hold flag awareness.

### Phase 4 — compliance, docs, production

- Privacy policy: Garmin section (explicit-consent health data, mirroring the
  Strava section); deletion text gains Garmin revocation.
- Load page + intensity card: source-aware copy ("from Garmin", attribution).
- README (sources doctrine, env), DEPLOY.md (env rows, webhook URL setup,
  endpoint registration steps), smoke checklist.
- Partner Verification → production key (needs 2 real Garmin accounts with
  device uploads and the deregistration/permission endpoints live).

## 5. Verification

- **Unit:** sport mapping (incl. `MULTI_SPORT`/`TRANSITION` skip + unknown
  leniency), normalization (UTC+offset → local; HR-less activities kept for
  actuals, dropped for load), recompute touches ONLY GARMIN rows (MANUAL/
  STRAVA/APPLE_HEALTH untouched — the double-count guard), precedence with
  GARMIN, refresh-rotation persistence (Phase 2).
- **Webhook (Phase 3):** curl the documented payload shapes (single, batched,
  multisport parent+legs, unknown user, malformed) against a dev server.
- **Sweep:** typecheck / lint / format / vitest / build per repo convention.
- **Live E2E (Phase 3+):** evaluation key + a real device sync; backfill a
  window; verify weekly actuals, load series, precedence vs a Strava-connected
  account.

## 6. Deployment notes

- Phase 1 ships with one **additive migration** — safe to apply to the prod DB
  with the old server still running (`npx prisma migrate deploy`): a new enum
  value + two new tables, no existing data touched. **Apply it before running
  the new build** (and before local dev — dev shares the prod DB).
- No new required env vars; `GARMIN_*` stays unset until Phase 2.
- Phases 2–3 deployment additionally needs: Garmin app credentials in env,
  callback URL registered with Garmin, webhook endpoints registered in
  `apis.garmin.com/tools/endpoints`, then Partner Verification.

## 7. Sources (fetched 2026-07-20)

- Program + APIs: developer.garmin.com/gc-developer-program/ (+ /program-faq/,
  /activity-api/, /health-api/, /training-api/)
- OAuth2 PKCE spec: developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf
- Brand guidelines (2025-06-30): developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf
- Pause evidence: Garmin forums thread 433735; themomentum.ai/blog/garmin-developer-program-closed-roadmap;
  openwearables.io/docs/providers/garmin-api-integration
- Field reference (mirror): support.mydatahelps.org/garmin-activity-summary-export-format
- Endpoint tool: apis.garmin.com/tools/endpoints
- Unverified items flagged in research: exact evaluation-key user/rate caps,
  current retry schedule, deregistration payload envelope, full Appendix A
  activity-type list — confirm in the Developer Portal once access exists.
