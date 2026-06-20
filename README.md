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
