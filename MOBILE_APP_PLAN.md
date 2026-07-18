# TriTrainer Mobile — React Native app plan

A plan for building an iOS/Android app with **feature parity with the website plus Apple
Health imports**, as a **new client of the existing backend**. The current architecture —
Next.js 16 on Hetzner/Passenger at `training.richysdev.co.uk`, Prisma 7 + Supabase Postgres,
Auth.js database sessions, the Strava integration, the progression/adaptive engine — **stays
exactly as it is**. The only server work is a thin, additive API surface the app needs
(section 4); nothing existing changes behavior.

---

## 1. Goals

- Native app (iOS first; Android same codebase minus HealthKit) with the same features:
  auth, dashboard, plans (create/edit/delete, cap multiple, week-start day), tracking
  (charts incl. trend line, Command/Timeline, manual actuals), Strava sync, adaptive weekly
  roll-forward, groups (create/invite/join/leave/stats), about.
- **New:** import workouts from **Apple Health** (HealthKit) as a third actuals source.
- One user account works interchangeably on web and mobile against the same database.

## 2. Hard constraints

| Stays as-is                                                                       | Notes                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Next.js server + Passenger hosting                                                | The app is a pure API client of `https://training.richysdev.co.uk`    |
| Prisma schema & Supabase DB                                                       | One additive migration only (Apple Health enum value, §4.4)           |
| Auth.js database sessions                                                         | Mobile reuses the **same `Session` table rows** as bearer tokens      |
| All existing routes & pages                                                       | Website is untouched; mobile endpoints are new, additive routes       |
| Domain engine (`weekly-targets`, `progress`, `actuals`, `plan-progress`, `trend`) | Reused server-side; pure copies reused in-app for instant client math |

## 3. App tech stack

- **Expo** (latest SDK) with a **custom dev client / EAS Build** — required because
  HealthKit needs a native module; everything else stays in the managed workflow.
- **TypeScript (strict)** — same conventions as the website.
- **expo-router** — file-based navigation mirroring the web routes.
- **@tanstack/react-query** — fetching/caching/invalidation for all API calls.
- **expo-secure-store** — session token storage (Keychain/Keystore).
- **react-native-svg** — the bespoke charts port nearly 1:1 (see §7).
- **react-native-health** (HealthKit; iOS-only, feature-flagged by platform).
- **zod** — reuse the copied `validation.ts` schemas for client-side form validation.
- Repo: **separate repository** (`tritrainer-mobile`). The website repo stays untouched;
  the pure domain modules are **copied** (they are dependency-free TS + zod):
  `weekly-targets.ts`, `progress.ts`, `actuals.ts`, `plan-progress.ts`, `trend.ts`,
  `validation.ts`, plus the color/status constants from `ui/theme.ts` as a plain object.
  (A shared npm package/monorepo is a later refactor if drift becomes painful.)

## 4. Backend additions (additive only — the app's contract)

All follow the existing route pattern: `enforceRateLimit` → zod parse → data-layer call →
`mapKnownApiError`. The data layer already does all authorization scoping.

### 4.1 Mobile auth (bearer over the existing Session table)

- **Login returns the token to mobile.** `POST /api/auth/login` already holds
  `sessionToken` + `expires` from `createDatabaseSession` — when the request carries
  `X-Client: mobile`, include `{ sessionToken, expires }` in the JSON body (web behavior
  unchanged). Same for signup→login flow.
- **Bearer fallback in `requireUserId()`** ([src/lib/training-plan.ts]): after `auth()`
  returns null, read `Authorization: Bearer <token>` via `next/headers` and look up
  `prisma.session` (`sessionToken`, `expires > now`) → userId. One central change gives
  every existing mutation route and every new read route mobile auth for free.
  Logout (`POST /api/auth/logout`) already deletes the session row — works for bearer too
  with a small extension to resolve the token from the header.
- **CSRF:** `isCrossSiteRequest` passes requests with no `Origin`/`Sec-Fetch-Site`
  (verified in testing) — native fetch sends neither, so **no change needed**.
- Token storage: SecureStore; 30-day expiry (`SESSION_MAX_AGE_SECONDS`); on 401 the app
  clears the token and returns to login.

### 4.2 JSON read endpoints (the web reads via server components; mobile needs JSON)

Thin wrappers over existing, already-session-scoped functions:

| Endpoint                                   | Reuses                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/mobile/dashboard`                | `listTrainingPlans` + active-plan rule, `buildPlanProgressInputs`/`computeProgress` minis, `getStravaConnectionSummary`, `listRecentActuals` (mirror of `dashboard/page.tsx`)                                                                                                                            |
| `GET /api/mobile/plans`                    | `listTrainingPlansWithProgress()`                                                                                                                                                                                                                                                                        |
| `GET /api/mobile/plans/[id]`               | **`maybeRecalculatePlan(id)` first** (preserves the adaptive roll-forward trigger), then `getTrainingPlan` + the series shaping currently in `plans/[id]/page.tsx` — extract that shaping into `src/lib/plan-series.ts` and use it from both the page and this route (pure refactor, no behavior change) |
| `GET /api/mobile/groups`                   | `listMyGroups()`                                                                                                                                                                                                                                                                                         |
| `GET /api/mobile/groups/[id]`              | `getGroup` + `getGroupMemberStats`                                                                                                                                                                                                                                                                       |
| `GET /api/mobile/groups/join-info/[token]` | `getGroupByToken`                                                                                                                                                                                                                                                                                        |

All **mutations already exist** and are reused unmodified: `POST /api/plans`,
`PUT/DELETE /api/plans/[id]`, `POST /api/plans/[id]/actuals`, all `/api/groups/*`,
`POST /api/strava/sync`, `GET /api/strava/weekly-average`.

### 4.3 Account deletion (App Store requirement)

Apple Guideline 5.1.1(v): apps with account creation **must offer in-app account
deletion**. Add `DELETE /api/account` → `prisma.user.delete` for the session user (the
schema already cascades plans/actuals/groups/sessions/Strava connection). In-app
"Delete account" in Settings with a typed confirmation.

### 4.4 Apple Health ingest

- **Migration:** add `APPLE_HEALTH` to the `ActualSource` enum (additive
  `ALTER TYPE ... ADD VALUE`; the `WeeklyActual` unique key already includes `source`, so
  a third source slots in with no other schema change).
- **`POST /api/health/ingest`** — body `{ workouts: [{ sportType, distanceMeters,
startDateLocal }] }` using Strava-compatible `sportType` strings (`Swim`/`Ride`/`Run`),
  so the server **reuses `mapSportTypeToDiscipline` + `aggregateActivitiesByWeek`
  unchanged** ([src/lib/strava/sync-core.ts]). Mirror `syncStravaActivities`
  ([src/lib/strava/sync.ts]): bucket per distinct plan `weekStartDay`, fan out to plans
  whose range covers each week, and **idempotently replace all `APPLE_HEALTH` rows** in
  one transaction (the app always sends everything since the earliest plan week, so
  re-syncs and deletions reconcile exactly like Strava). Rate-limit `health:ingest`.
- **Precedence** ([src/lib/actuals.ts]): extend `resolveEffectiveActuals` to
  `MANUAL > STRAVA > APPLE_HEALTH` (deterministic, still never summed).
  ⚠ **Double-count is impossible** (precedence picks one source per week), but a user
  whose Watch workouts also auto-post to Strava gets the _same_ data from both sources —
  fine. The real risk is _partial overlap_ (e.g. only some workouts reach Strava): then
  the higher-precedence STRAVA week hides a more-complete Health week. Mitigation: an
  in-app note recommending one auto source, and a Settings toggle "Prefer Apple Health
  over Strava" (per-user column, phase 7) if it proves needed.
- Unit tests mirror the existing sync-core/authz test patterns.

### 4.5 Strava connect from mobile (phased)

The OAuth flow is browser-redirect + session-cookie + state-cookie; an in-app browser has
no app session. **v1 (zero backend change):** the app's Strava card links out to the
website (`/dashboard`) to connect once; the app then reads connection status and calls
`POST /api/strava/sync` itself. **v2 (optional):** `POST /api/strava/connect-intent`
(bearer) returns a one-time short-lived URL; `/api/strava/connect?ott=…` resolves the
user from it; the callback trusts the **HMAC-signed state** (already binds `userId`) +
nonce cookie in lieu of a session, then deep-links back (`tritrainer://strava-connected`).
Security review required before v2 ships.

## 5. App structure (mirrors the web 1:1)

```
app/
  (auth)/login.tsx  signup.tsx  about.tsx      # public
  (tabs)/
    dashboard.tsx                              # Home tab
    plans/index.tsx  new.tsx  [id]/index.tsx  [id]/edit.tsx
    groups/index.tsx  [id].tsx
    settings.tsx                               # theme, Strava, Apple Health, sign out, delete account
  groups/join/[token].tsx                      # deep link target
lib/domain/    # copied pure modules (§3)
lib/api.ts     # fetch wrapper: base URL, bearer header, 401 → logout, zod-parsed responses
components/    # charts (VolumeChart/ProgressRing/Sparkline), StatusPill, tiles, forms
```

- **Navigation:** bottom tabs (Dashboard / Plans / Groups / Settings) + stacks — the
  mobile-drawer nav from Redesign B maps naturally to tabs.
- **Screens keep web behavior exactly:** plan form (name, dates, peak-week cap ×,
  week-starts-on, per-sport distances with m/km units), plan detail (discipline tabs,
  Command/Timeline toggle, condensed expandable week table with inline actual entry —
  the mobile layout from Redesign B is the design reference), groups (owner invite
  panel with native Share sheet, per-sport tiles, remove/leave/delete).
- **Deep links:** `tritrainer://` scheme + universal links for
  `https://training.richysdev.co.uk/groups/join/*` so invite links open the app when
  installed (web page remains the fallback).

## 6. Theming

Port `globals.css` variables to a `theme.ts` object with `dark`/`light` palettes
(identical hex values). Theme = system (`useColorScheme`) with a manual override stored
in AsyncStorage — same dark-default feel as the web.

## 7. Charts

`charts.tsx` is already bespoke SVG with pure coordinate math — port to
`react-native-svg` (`<Svg><Line><Rect><Path><Circle><Text>`) with the same geometry:
target line + dots, actual bars, current-week band, start-volume dashed line, **trend
line** (reuse copied `trend.ts` — fit over completed weeks, clamped projection), axis
labels, "now"/"trend" labels. Sparkline and ProgressRing port the same way.

## 8. Apple Health integration (the new feature)

1. **Setup:** HealthKit entitlement, `NSHealthShareUsageDescription`, EAS custom dev
   client with `react-native-health` config plugin.
2. **Permissions:** read-only `Workout` type (distance swimming / cycling / running come
   from workout samples).
3. **Sync flow ("Sync now" in Settings + on-launch refresh):**
   - Query workouts from the earliest plan week (`GET /api/mobile/plans` supplies plan
     start dates) to now.
   - Map `HKWorkoutActivityType`: swimming→`Swim`, cycling→`Ride`, running→`Run`
     (others ignored — same policy as Strava mapping); take each workout's total
     distance in meters and local start date.
   - `POST /api/health/ingest` with the full normalized batch (idempotent replace
     server-side; weekly bucketing per plan's `weekStartDay` happens on the server).
4. **UI:** an "Apple Health" card (Settings + dashboard) mirroring the Strava card —
   Connected/Not connected, last synced, Sync now; per-week source label already renders
   ("apple health" alongside "strava"/"manual").
5. **Phase 2 (post-launch):** HealthKit background delivery (observer query + background
   capability) to auto-ingest without opening the app.
6. **Android:** feature hidden; Health Connect is a possible future parallel.

## 9. Delivery phases (each independently shippable/testable)

| Phase                   | Scope                                                                                                                                                                            | Done when                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **0. Backend contract** | §4.1–4.3 (bearer auth, mobile reads, delete account) + tests                                                                                                                     | curl with a Bearer token exercises every endpoint; web unaffected (full suite green) |
| **1. App skeleton**     | Expo project, theming, API client, auth screens, secure token, tab shell                                                                                                         | Sign up / in / out on a device against prod-like backend                             |
| **2. Read-only parity** | Dashboard, plans list, plan detail (charts, tabs, Command/Timeline), groups read                                                                                                 | Screens match web data exactly for the same account                                  |
| **3. Mutations**        | Plan create/edit/delete, manual actuals (condensed table), groups create/join/leave/manage, deep links                                                                           | Two-device group flow works; adaptive recompute observed on week-start day           |
| **4. Strava v1**        | Connection status, link-out connect, in-app Sync now                                                                                                                             | Strava actuals appear in-app                                                         |
| **5. Apple Health**     | §4.4 migration + ingest, HealthKit permissions, manual sync, source labels                                                                                                       | Watch workout → visible weekly actual; idempotent re-sync; precedence honored        |
| **6. Release**          | App icons/splash, error/empty states, account deletion UI, privacy policy page on the website, EAS → TestFlight → App Store review (demo account)                                | App live                                                                             |
| **7. Post-launch**      | HealthKit background delivery (expanded into [APPLE_HEALTH_PUSH_PLAN.md](APPLE_HEALTH_PUSH_PLAN.md)), Strava in-app OAuth (v2), source-preference toggle, Android/Health Connect | —                                                                                    |

## 10. Testing

- **Domain math:** the copied pure modules bring their vitest suites with them
  (progression, progress, trend, week helpers) — run under vitest in the app repo too.
- **Backend additions:** route tests in the website repo mirroring
  `groups.authz.test.ts` (bearer auth fallback, ingest idempotency + authz, account
  deletion cascade).
- **App:** React Native Testing Library for forms/tables; **Maestro** for E2E happy
  paths (login → create plan → enter actual → see chart); manual HealthKit testing on a
  physical device (simulator HealthKit data is limited).
- **Live verification pattern:** same as this project's convention — seed temp
  `@test.dev` users via curl against a dev server, assert, clean up.

## 11. Risks & open decisions

- **Apple review:** HealthKit apps get extra scrutiny — read-only scope, clear usage
  string, privacy policy, and the account-deletion requirement (§4.3) are the usual
  rejection points. Budget a review round-trip.
- **Strava/Health overlap** (§4.4): default precedence is safe but may hide
  partial-overlap weeks; the settings toggle is the escape hatch.
- **Rate limiting** is per-IP in-memory on one Passenger process — fine for mobile
  volumes; revisit only if sync traffic grows.
- **Session lifetime:** 30-day tokens mean roughly monthly re-login; acceptable v1
  (refresh/extend-on-use is a small later backend tweak).
- **Costs/accounts:** Apple Developer Program ($99/yr) required for HealthKit +
  TestFlight; EAS free tier suffices initially.
- **Open:** app name/bundle id, minimum iOS version (HealthKit workouts fine from iOS
  15+), whether Android ships in v1 (recommend: yes, minus Health).
