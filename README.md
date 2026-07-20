# TriTrainer

A triathlon training planner: build progressive weekly swim/bike/run targets up to
race day, sync actuals from Strava, and track target-vs-actual progress week by week.
Next.js 16 (App Router) + TypeScript + Prisma/PostgreSQL, with database-backed auth,
zod-validated environment config, structured logging, rate limiting, and hardened
security headers.

## Stack

| Concern        | Choice                                                           |
| -------------- | ---------------------------------------------------------------- |
| Framework      | Next.js 16 (App Router, Turbopack)                               |
| Language       | TypeScript (strict, `noUncheckedIndexedAccess`)                  |
| Database / ORM | PostgreSQL via Prisma 7 (`prisma-client` + `@prisma/adapter-pg`) |
| Env validation | zod, parsed at boot — fails fast on missing/invalid vars         |
| Lint / format  | ESLint 9 (flat config) + Prettier                                |

## Getting started

```bash
# 1. Install dependencies (runs `prisma generate` via postinstall)
npm install

# 2. Configure environment
cp .env.example .env
#   then edit .env with real values

# 3. Create the database schema (needs a reachable Postgres)
npm run db:push

# 4. Run
npm run dev          # http://localhost:3000
```

## Environment variables

All variables are **required** and validated at startup by [`src/env.ts`](src/env.ts).
A missing or malformed value aborts boot with a clear, itemised error. See
[`.env.example`](.env.example) for the full list:

`DATABASE_URL`, `AUTH_SECRET`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
`NEXTAUTH_URL`, `ENCRYPTION_KEY` (base64 32 bytes — encrypts Strava tokens at
rest). Optional: `DIRECT_URL` (migrations behind a pooler),
`STRAVA_WEBHOOK_VERIFY_TOKEN`.

> `.env` is git-ignored — never commit real secrets.

## Strava account linking

OAuth 2.0 link to Strava, **separate from login** (see [src/lib/strava](src/lib/strava)).

- **Model**: `StravaConnection` (one per user). Access/refresh tokens are
  **encrypted at rest with AES-256-GCM** (`ENCRYPTION_KEY`) — never plaintext.
- **Flow**: `GET /api/strava/connect` redirects to Strava (`scope=read,activity:read`)
  with a **signed, session-bound `state`** (HMAC over `userId.nonce.issuedAt`,
  nonce mirrored in an httpOnly cookie). `GET /api/strava/callback` verifies the
  state, exchanges the code, and upserts the connection.
- **Auto-refresh**: `getValidStravaAccessToken(userId)` refreshes via Strava's
  token endpoint when expired and persists rotated tokens. It never throws —
  returns `null` on transient failure and **drops the connection on a revoked
  token**, so the app can't crash on a bad token.
- **Disconnect**: `POST /api/strava/disconnect` best-effort revokes on Strava,
  then deletes the row. A **"Connect/Disconnect" card** lives on the dashboard.
- **Webhook**: `GET /api/strava/webhook` answers the subscription handshake;
  `POST` handles athlete **de-authorization** (deletes the connection) and always
  returns 200.
- **Activity sync** — `POST /api/strava/sync` ("Sync now" on the dashboard):
  fetches recent activities (paginated, **429 backoff**), maps types
  (Swim→SWIM, Ride/VirtualRide→BIKE, Run/VirtualRun→RUN), buckets distance into
  Monday-start weeks, and writes STRAVA-sourced `WeeklyActual` rows for each
  covering plan. **Idempotent**: it replaces STRAVA actuals in a transaction
  (MANUAL ones untouched), keyed on `(planId, discipline, weekStartDate, source)`.
  `StravaConnection.lastSyncedAt` records the last run.

### Configuring the Strava API application

Create an app at <https://www.strava.com/settings/api> and copy its **Client ID**
and **Client Secret** into `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`.

- **Authorization Callback Domain**: your bare host — `training.richysdev.co.uk`
  in production, or `localhost` for local dev. Strava validates the redirect URI
  against this domain.
- **OAuth redirect URI** (where Strava sends the user back): `${NEXTAUTH_URL}/api/strava/callback`
  — e.g. `https://training.richysdev.co.uk/api/strava/callback`. It is derived from
  `NEXTAUTH_URL`, so set that to your public origin.
- **Scopes**: the connect flow requests `read,activity:read`.
- **Webhook (optional)**: point a Strava push subscription at
  `${NEXTAUTH_URL}/api/strava/webhook` and set `STRAVA_WEBHOOK_VERIFY_TOKEN` to the
  verify token you register — the `GET` handshake echoes Strava's challenge.

## Tracking dashboard (`/plans/:id`)

Server-rendered (scoped to the owner) target-vs-actual tracking, built from the
pure [computeProgress](src/lib/progress.ts) model:

- **Per discipline + a cross-discipline total**: a combined chart (target line +
  actual bars, actuals only through the current week) and a per-week table.
- **Per-week and cumulative** target vs actual, **% of target**, and a **status**
  (ahead / on track / behind) — both per week and a to-date summary.
- **Current week is highlighted** (chart marker + amber table row).
- **Edge states**: past weeks with no activity count as **0 / behind** (missed);
  future weeks show **target only** ("upcoming"); a not-yet-started plan shows a
  banner with targets only.

## Weekly actuals (manual + Strava)

Actual weekly distance can come from Strava sync (`source = STRAVA`) or be entered
by hand on the plan page (`POST /api/plans/:id/actuals`, `source = MANUAL`).

- **Validation**: the user must own the plan, the week must fall within the plan's
  date range (the date is normalized to the plan's week-start day), and distance
  must be a non-negative integer.
- **Precedence (documented choice)**: a **MANUAL entry overrides STRAVA** for the
  same (discipline, week) — they are **not summed** (summing would double-count a
  session that's both synced and entered by hand). Precedence is resolved at read
  time ([src/lib/actuals.ts](src/lib/actuals.ts)), so a manual override **survives
  future syncs** (sync only ever replaces STRAVA-sourced rows).
- The plan page shows an editable "Actual (m)" field per week (pre-filled with the
  manual value, labelled with the effective source) and overlays an actual line on
  the chart.

## Health check

`GET /api/health` returns **200** with `{ "status": "ok", "database": "connected" }`
when the app is up and Postgres is reachable, and **503** when the database
connectivity check fails.

## Authentication

Email + password authentication built on **Auth.js (NextAuth v5)** with the
Prisma adapter and a **database session strategy**.

- **Models** ([prisma/schema.prisma](prisma/schema.prisma)): `User`, `Account`,
  `Session`, `VerificationToken` per the Auth.js adapter spec, plus
  `User.passwordHash` (argon2id — plaintext is never stored).
- **Endpoints**: `POST /api/auth/signup`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `POST /api/auth/forgot-password`,
  `POST /api/auth/reset-password`. Auth.js's own handlers live at `/api/auth/[...nextauth]`.
- **Password reset** (`/forgot-password` → email link → `/reset-password/[token]`):
  the raw token is emailed but only its **SHA-256 hash** is stored (in the Auth.js
  `VerificationToken` table under a `pwreset:` identifier), so a DB leak yields no usable
  links. Tokens are **single-use** and expire after 60 minutes; a successful reset
  **revokes all of the user's sessions**. Forgot-password never reveals whether an account
  exists and is rate-limited per IP _and_ per email. Email goes out via optional SMTP
  ([src/lib/mailer.ts](src/lib/mailer.ts)); with SMTP unset the link is dev-logged so the
  flow stays testable.
- **Account self-service** (`/account`): screen name (`PATCH /api/account` —
  shown on the dashboard and in groups, email-derived fallback via
  `displayNameFor`), password change (`POST /api/account/password` — requires
  the current password, enforces the sign-up policy, and **revokes every other
  session** while keeping the one making the change, cookie or mobile bearer
  alike), and deletion (`DELETE /api/account`, typed confirmation — cascades
  plans, groups, sessions, connections).
- **Sessions**: secure, `httpOnly`, `sameSite=lax` cookie (`Secure` in
  production). The session token is stored in the `Session` table; `auth()`
  validates it. `signOut` deletes the row server-side.
- **Protected routes**: [`src/proxy.ts`](src/proxy.ts) gates `/dashboard` on the
  session cookie (cheap, no DB), and the page re-validates with `auth()` and
  redirects unauthenticated users to `/login`.

> **Why a custom login route?** Auth.js's Credentials provider only supports JWT
> sessions. To get credentials login _with_ database sessions, the login route
> validates the password and creates the session row directly in the adapter's
> `Session` table using the Auth.js cookie — so `auth()`/`signOut()` work
> unchanged and OAuth providers can be added later.

**Security properties:** no user enumeration (identical responses + constant-time
hashing for "wrong password" vs "no such user"), generic error messages,
per-IP-per-minute rate limiting on login/sign-up (in-memory — back with Redis for
multi-instance deployments), and CSRF protection (Sec-Fetch-Site / Origin checks
plus sameSite cookies).

## Training plan domain

Models live in [prisma/schema.prisma](prisma/schema.prisma): `TrainingPlan`
(scoped to a user via `userId`), `PlanDiscipline`, `WeeklyTarget`, `WeeklyActual`,
plus the `Discipline` (SWIM/BIKE/RUN) and `ActualSource` (MANUAL/STRAVA) enums.
Deleting a user cascades to their plans; deleting a plan cascades to all of its
children. Indexes cover `TrainingPlan(userId)`, `PlanDiscipline(planId, discipline)`
(unique), and `Weekly{Target,Actual}(planId, weekStartDate)`.

**User scoping (important):** all access goes through
[src/lib/training-plan.ts](src/lib/training-plan.ts), which derives the user id
from the session (`auth()`) and filters every query by it. A client-supplied
`userId` is never trusted — child records are gated by a `plan: { userId }`
relation filter or an explicit ownership assertion before any write.

See [Database](#database) below for migrations, integrity constraints, and backups.

## Weekly progression & adaptation

Weekly targets are generated by the pure engine
[computeWeeklyTargets](src/lib/weekly-targets.ts): week 1 starts at the chosen
starting volume and ramps at the gentlest constant rate (capped at 12%/week) that
reaches the peak, with a **de-load** on the last week of every 4-week block and a
hard **cap** of `capMultiple × eventDistance` (per-plan, default 1.5×).

- **Configurable week-start day.** Each plan sets the day its training weeks begin
  (`weekStartDay`, 0=Sun…6=Sat, default Monday). It re-bases every week boundary —
  target generation, manual actuals, progress classification, and Strava activity
  bucketing all align to that day. `startOfWeek(date, weekStartDay)` (and
  `firstWeekStartOnOrAfter`) are the shared helpers; existing plans default to
  Monday, matching their stored data.

- **Adaptive roll-forward.** On the **first view of a new training week** (guarded
  by `lastRecalcWeek`, so at most once per week), `maybeRecalculatePlan` re-ramps
  the current and future weeks from the **last completed week's actual** volume,
  per discipline, using the same engine. It **adapts both ways** — a strong week
  pushes the remaining plan up (still capped), a light one eases it down. Past
  weeks and the just-completed week keep their historical targets. A fully missed
  week (zero / no data) is treated as "no signal" and falls back to that week's
  original target, so a blank week never collapses the plan. The recompute is
  view-driven (no scheduler required).

  It deliberately does **not** require the view to land on the week-start day. It
  used to, which quietly made the whole engine a coin flip: open the plan on a
  Tuesday and a Thursday but not the Monday, and that week never rolled forward —
  `lastRecalcWeek` then locked it out for good and the week's actuals, check-in and
  Form were silently discarded. `lastRecalcWeek` alone answers the real question
  ("has this week rolled forward yet?") on any view.

- **The taper is never re-ramped.** Once the current week is inside the taper,
  `computeAdaptedFutureTargets` returns no rows and the taper stands as computed.
  That's the domain rule (adapting a taper week _upward_ because last week went
  well is backwards) and it closes a real defect: `computeWeeklyTargets` re-derives
  `weekCount` from the start it is handed, and the re-ramp hands it a _sliding_
  anchor — so near race day the taper clamp `min(taperWeeks, weekCount - 2)`
  collapsed and `peakIndex` walked onto the race week. A 2-week taper regenerated
  on race week produced `effectiveTaper = 0`, rewriting race day as a **+12% build
  off the peak** rather than 50% of it. Plans with `taperWeeks: 0` are unaffected
  and keep adapting to race day, which is what "no taper" means.

- **Which plan the dashboard leads with** ([src/lib/featured-plan.ts](src/lib/featured-plan.ts)).
  With several races on the calendar, `rankLivePlans` orders the live ones: plans
  already underway first, then by **priority** (A goal race → B → C tune-up), then
  by nearest race. The head is the featured plan; the rest are listed beside it,
  with the season Gantt below. This replaced a "nearest upcoming event" rule that
  featured the _least_ important plan — a June C-race would hide a September A-race
  — and that showed a finished plan as "active" at 0 weeks to go once every event
  had passed. Both the web dashboard and `/api/mobile/dashboard` rank through the
  same pure module, so the two can't disagree about what you're training for.

- **Life happens — pauses and the return ramp.** A week the athlete couldn't train
  can be marked as time off (`WeeklyPause`: ill / injured / away). Time off never
  counts against the athlete, anywhere: it's excluded from the readiness trend
  **and** adherence (so a fortnight sick never reads as "at risk" — without this the
  plan would tell someone to train _more_ on their way back from illness), and the
  consistency heatmap treats it as transparent — neither a hit nor a miss, and a
  streak survives it. `PlanForSeries.weeklyPauses` is deliberately **required**, so
  a reader can't silently forget to load it; that exact omission once had a shared
  link reporting "at risk" on a plan its owner's page called "on track". And on
  return, `maybeRecalculatePlan` skips
  back over the run of paused weeks to the last week actually **trained**, detrains
  that baseline via `returnToTrainingFactor` (10% per week off, floored at 50%), and
  restarts the ramp **at the current week** — so the first week back _is_ the reduced
  volume and the plan rebuilds from there, instead of resuming at the stale
  pre-illness target. One week off is a ~10% haircut the 12%/week ramp wins straight
  back; a long layoff starts meaningfully lower.

- **Two readiness signals ease the ramp.** On top of _how much_ you trained, the
  re-ramp folds in _how ready you are_ via a volume multiplier: a **subjective**
  one from the weekly wellness check-in (`checkinReadinessFactor` — fatigue /
  sleep / soreness), and an **objective** one from HR training load
  (`formLoadFactor` — current Form / TSB from the Performance Management Chart).
  Form only eases the ramp once it crosses into **overreaching** (deep negative
  TSB), so productive training stress isn't blunted; the two factors combine
  multiplicatively. The plan page also **cross-checks** them
  (`computeFormReadiness`): when the check-in says "fine" but Form shows fatigue
  outrunning fitness, it surfaces the objective override — the "you feel fresh,
  but your Form is −35" insight.

- **Intensity distribution** ([src/lib/zones.ts](src/lib/zones.ts)). Training load
  answers _how much_; this answers _how hard_. Activities are banded into Friel
  LTHR zones (Z1–Z5) off the same `thresholdHr`, then collapsed to the three bands
  the polarized-training model cares about — easy (Z1–Z2), grey/tempo (Z3), hard
  (Z4–Z5) — and shown on `/load` against the ~80/20 reference over a 28-day window.
  **Read it with its method in mind:** Strava gives us a session's _average_ HR,
  not its HR trace, so each activity is scored whole. Steady sessions score
  honestly; an interval session averages its warm-up and reps into Z3, which biases
  the distribution toward the middle. It's a read on where efforts sat, not true
  time-in-zone — the card says so, and the verdicts are worded as prompts rather
  than instructions. True time-in-zone would need per-activity HR streams. (Like
  hrTSS, it also uses one `thresholdHr` across all three sports.)

- **Training load is per-source, and reads use exactly one source.** `ActivityLoad`
  rows carry a `source` (Strava sync / Apple Health ingest; see
  [APPLE_HEALTH_PUSH_PLAN.md](APPLE_HEALTH_PUSH_PLAN.md)), each writer replaces only
  its own source's rows, and `readUserLoad` feeds CTL/ATL/TSB from **one** source —
  `STRAVA` when a connection exists, else `APPLE_HEALTH`. Same doctrine as weekly
  actuals: never summed, because a Watch workout that auto-uploads to Strava would
  otherwise count its TSS twice — into the Load page, the Form signal, and the
  re-ramp's easing.

- **Week planner** ([src/lib/week-planner.ts](src/lib/week-planner.ts) +
  [planner-data.ts](src/lib/planner-data.ts)): the current week's suggested
  sessions laid onto days — drag/arrow-move between days, manual ticks, and
  derived auto-ticks from same-day, same-sport HR-recorded activities
  (count-based, never stored). Sessions are share-based (fraction of the
  week's discipline target), so re-ramps rescale them; untouched weeks are
  computed defaults and only materialize (`PlannedSession`) when the athlete
  moves or ticks something (`PUT /api/plans/:id/sessions` replaces the whole
  week, validated for discipline coverage + share sums). Surfaces: the plan
  page board, the dashboard "Today" card, and `activePlan.today` in the
  mobile dashboard endpoint. Paused weeks prescribe nothing anywhere.

- **Race forecast** ([src/lib/forecast.ts](src/lib/forecast.ts) +
  [forecast-data.ts](src/lib/forecast-data.ts)): projects the same CTL/ATL/TSB
  fold forward through race day, assuming the featured plan's remaining weekly
  targets are executed (spread evenly per week; paused weeks project as rest).
  Meters→TSS rates are calibrated per discipline from the athlete's own recent
  completed weeks (effective actual meters vs the same weeks' hrTSS, clamped,
  ≥2 weeks required) with conservative defaults as fallback. Shown on `/load`:
  projected race-day Form/Fitness, the classic +10…+25 TSB race window as the
  verdict bands, and a solid-to-dashed PMC continuation chart.

## Database

Postgres via Prisma 7. For quick local iteration `npm run db:push` is fine; for any
shared or production database use **migrations** ([prisma/migrations](prisma/migrations)):

- **Develop**: `npm run db:migrate` — create + apply a migration.
- **Deploy**: `npm run db:deploy` — `prisma migrate deploy` applies pending
  migrations and **never resets**. Migrations use `DIRECT_URL` when set (a direct,
  non-pooled connection — required behind a transaction pooler such as Supabase).
- Inspect data with `npm run db:studio`.

**Integrity** (enforced in [the schema](prisma/schema.prisma)): every child table
(`PlanDiscipline`, `WeeklyTarget`, `WeeklyActual`, and the Auth.js tables) has a
foreign key to its parent with `onDelete: Cascade` — deleting a user removes their
plans and all descendant rows in one transaction. A unique constraint
**`@@unique([planId, discipline])`** prevents duplicate plan-discipline rows;
`WeeklyActual` is unique on `(planId, discipline, weekStartDate, source)` (the sync
idempotency key). Indexes cover `TrainingPlan(userId)`,
`Weekly{Target,Actual}(planId, weekStartDate)`, and `StravaConnection(athleteId)`.

**Backups**: the database is hosted on **Supabase**, which performs **automated
daily backups** (with **Point-in-Time Recovery** on Pro/larger compute). Confirm
the schedule and retention under _Supabase → Project → Database → Backups_ and set
the PITR window to your recovery target. For a self-hosted Postgres, schedule a
nightly `pg_dump` to off-box storage instead.

## Security headers

[`next.config.mjs`](next.config.mjs) applies the static headers to every route:
Strict-Transport-Security, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
and `Referrer-Policy: strict-origin-when-cross-origin`.

The Content-Security-Policy is set per-request in [`src/proxy.ts`](src/proxy.ts) so it can
carry a unique `nonce`. The nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`) is what
lets Next.js's inline RSC/bootstrap scripts execute under a strict policy — without it,
hydration is blocked. The root layout reads the nonce from the `x-nonce` request header and
stamps it onto its inline theme-bootstrap script.

## Weekly digest email

One email at the start of each athlete's training week ([src/lib/digest.ts](src/lib/digest.ts)):
last week's actual vs target per sport, this week's freshly re-ramped targets
(the digest triggers the same roll-forward the first dashboard view would),
Form, streak, and the race countdown — for the featured plan. Driven by a
daily scheduler hitting `POST /api/cron/weekly-digest` (bearer `CRON_SECRET`;
503 when unset). Idempotent via `User.lastDigestWeek` — at most one digest per
training week, with a one-day catch-up window for a missed cron run. On by
default; off via the Account-page toggle or the signed, session-free
unsubscribe link (RFC 8058 one-click headers) in every email. Requires SMTP.

## Rate limiting

A fixed-window limiter ([src/lib/rate-limit.ts](src/lib/rate-limit.ts), applied via
`enforceRateLimit` in [src/lib/security.ts](src/lib/security.ts)) guards **every
mutating and Strava endpoint** — login/sign-up, plan create/edit/delete, manual
actuals, and Strava connect/callback/sync/disconnect/webhook — keyed by client IP
(`X-Forwarded-For`; configure your proxy to set it). It is in-memory (per process);
back it with Redis/Upstash for multi-instance deployments.

## Logging & error handling

- **Structured logs** ([src/lib/logger.ts](src/lib/logger.ts)): one JSON object per
  line with **recursive redaction** of sensitive keys (passwords, tokens, secrets,
  cookies, session/auth material, email/PII), so request bodies and error objects
  can be logged safely. No secrets, tokens, or PII reach the logs.
- **Centralized API errors** ([src/lib/api.ts](src/lib/api.ts)): each route maps its
  known errors (auth / not-found / validation) to specific responses and falls
  through to `handleApiError`, which logs the full error server-side and returns a
  generic `500 { error: "Internal server error" }` — **never a stack trace or
  internal detail to the client**.
- **Error boundaries**: [`src/app/(app)/error.tsx`](<src/app/(app)/error.tsx>) and
  [`src/app/global-error.tsx`](src/app/global-error.tsx) catch render-time errors and
  show a friendly message with only a safe `digest` reference.

## Testing & CI

- **Unit tests** (Vitest, `npm test`): the pure domain (progression engine, progress
  model, actual precedence, plan shaping), **log redaction**, and **authorization
  scoping** — a foreign plan id resolves to nothing (404) and a missing session is
  rejected (401), proving one user cannot read or mutate another's plan.
- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)): every push and PR
  runs typecheck → lint → format check → tests → build, plus `npm audit` (fails on
  high/critical). Enable branch protection ("require status checks to pass") on the
  default branch so a red pipeline blocks merge.
- **Dependencies**: weekly [Dependabot](.github/dependabot.yml) PRs (npm + GitHub
  Actions); `npm run audit` runs the same scan locally.

## Legal & compliance (UK)

- **Privacy policy** ([/privacy](src/app/privacy/page.tsx)): UK-GDPR-oriented —
  what's stored (including heart-rate/training-load and wellbeing check-in data,
  treated as special-category health data processed on explicit consent), lawful
  bases, Strava and Apple Health handling, processors/hosting (EU), retention, the
  full rights list incl. ICO complaint, and deletion.
- **Terms of service** ([/terms](src/app/terms/page.tsx)): plain-language terms with
  a prominent **"not medical advice"** disclaimer for the training guidance,
  acceptable use, as-is availability, an England & Wales liability clause with the
  mandatory non-excludable carve-outs, and governing law.
- **Cookies**: only strictly necessary cookies (session + Strava OAuth state; theme
  lives in `localStorage`). **No analytics or tracking**, so no PECR consent banner
  is required — documented in the policy's Cookies section. If analytics are ever
  added, a consent banner must ship with them.
- **Account deletion** (`DELETE /api/account`, Account page): immediate cascade
  delete of all user data, plus best-effort **Strava deauthorization** on Strava's
  side (UK GDPR erasure + Strava API expectation + App Store 5.1.1(v)).
- Signup shows a terms/privacy agreement line; both pages are linked from the
  landing and about footers.

## Deployment

See **[DEPLOY.md](DEPLOY.md)** for production deployment (Hetzner managed Node /
Phusion Passenger, or any Node host): what to ship, build/run steps, the env-var
table, HTTPS, and post-deploy checks.

## Scripts

| Script                 | Description                      |
| ---------------------- | -------------------------------- |
| `npm run dev`          | Start the dev server             |
| `npm run build`        | Production build                 |
| `npm run start`        | Start the production server      |
| `npm run lint`         | ESLint                           |
| `npm run format`       | Prettier (write)                 |
| `npm run format:check` | Prettier (check only — CI)       |
| `npm run typecheck`    | `tsc --noEmit`                   |
| `npm test`             | Run the Vitest suite             |
| `npm run audit`        | Dependency scan (high/critical)  |
| `npm run db:push`      | Push the Prisma schema to the DB |
| `npm run db:migrate`   | Create/apply a dev migration     |
| `npm run db:deploy`    | Apply pending migrations (prod)  |
| `npm run db:studio`    | Open Prisma Studio               |
