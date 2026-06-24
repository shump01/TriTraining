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
  date range (the date is normalized to its Monday), and distance must be a
  non-negative integer.
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
  `POST /api/auth/logout`. Auth.js's own handlers live at `/api/auth/[...nextauth]`.
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
