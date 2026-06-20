# TriTrainer

Next.js 16 (App Router) + TypeScript starter with Prisma/PostgreSQL, validated
environment configuration, and hardened HTTP security headers.

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

`DATABASE_URL`, `AUTH_SECRET`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `NEXTAUTH_URL`

> `.env` is git-ignored — never commit real secrets.

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

Migrations live in [prisma/migrations](prisma/migrations). Use `npm run db:migrate`
to create/apply a migration in development. Inspect data with `npx prisma studio`.

## Security headers

[`next.config.ts`](next.config.ts) applies the following to every route:
Content-Security-Policy, Strict-Transport-Security, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.

## Scripts

| Script               | Description                      |
| -------------------- | -------------------------------- |
| `npm run dev`        | Start the dev server             |
| `npm run build`      | Production build                 |
| `npm run start`      | Start the production server      |
| `npm run lint`       | ESLint                           |
| `npm run format`     | Prettier (write)                 |
| `npm run typecheck`  | `tsc --noEmit`                   |
| `npm run db:push`    | Push the Prisma schema to the DB |
| `npm run db:migrate` | Create/apply a dev migration     |
