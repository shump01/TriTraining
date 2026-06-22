# Deploying TriTrainer

TriTrainer is a **Next.js (App Router) server application** — server components, API
routes, `proxy.ts` middleware, Prisma, and database-backed auth. It is **not** a static
site: it must run as a long-lived **Node.js process**, fronted by HTTPS.

It targets the project's production host (Hetzner managed Node, which uses **Phusion
Passenger**), but the build/runtime steps apply to any Node host.

---

## 1. What to ship

Ship the **git-tracked source** and build on the server. The tracked tree already excludes
everything you must not copy (`node_modules/`, `.next/`, `.env`, `src/generated/`).

Easiest — one archive of exactly the right files:

```bash
git archive --format=tar.gz -o deploy.tar.gz HEAD
```

SFTP `deploy.tar.gz` to the app directory and `tar xzf deploy.tar.gz`.

Or copy these directly: `src/`, `prisma/`, `server.js`, `package.json`,
`package-lock.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`,
`prisma.config.ts`, `eslint.config.mjs`. (There is no `public/` directory.)

**Never copy** `node_modules/` or `.next/` from a dev machine — `@node-rs/argon2` is a
native binary and must be built on the target OS/arch. Build on the server.

---

## 2. Build on the server

From the app directory (the Passenger **working directory**, e.g. `~/Node`):

```bash
npm ci             # installs deps (incl. dev — needed to build) + prisma generate
npm run build      # produces .next/  (server.js serves this)
```

> `next build` can exceed 256 MB of memory. If it OOMs, raise the app's memory limit for
> the build (≈1 GB), then lower it again for runtime if desired.

---

## 3. Database migrations

The app uses Prisma against Postgres (Supabase). Apply pending migrations to the prod DB:

```bash
npx prisma migrate deploy
```

No-op if production already points at a database that's up to date. `migrate deploy` uses
`DIRECT_URL` when set (a direct, non-pooled connection — required for migrations).

---

## 4. Environment variables

Validated at boot by [`src/env.ts`](src/env.ts) — a missing/invalid value aborts startup
with a clear message. Set these on the server (a `.env` in the working directory is loaded
by `server.js`; or use the host's environment-variable settings). See
[`.env.example`](.env.example).

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection (Supabase pooler) |
| `DIRECT_URL` | Direct (non-pooled) connection — used by `migrate deploy` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://training.richysdev.co.uk` |
| `ENCRYPTION_KEY` | base64 32 bytes. **Must be the same key** that encrypted existing Strava tokens, or they can't be decrypted |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | from the Strava API application |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | only if using Strava webhooks |
| `NODE_ENV` | `production` (set the host's "Application mode" to production) |

---

## 5. Run it

### Phusion Passenger (Plesk / Hetzner managed Node)

Passenger runs a Node **entry script** — it does not call `next start`. This repo ships
[`server.js`](server.js), a minimal custom server that boots Next in production and listens
on the address Passenger provides (`process.env.PORT`, port or socket).

Panel settings:

- **Script path:** `server.js`
- **Working directory:** the folder containing the app (e.g. `Node` → `~/Node`)
- **Node version:** 24 (any modern LTS, ≥ 18.18, works)
- **Application mode:** production

After `npm ci` + `npm run build` + env are in place, **Restart** the app.

### Plain VPS (no Passenger)

Run the same custom server (or `next start`) under a process manager and reverse-proxy it:

```bash
node server.js          # or: npm start   (next start, :3000)
```

Keep it alive with `pm2` or a `systemd` unit, and put nginx/Apache in front (see §6).

---

## 6. HTTPS, domain, Strava

- **HTTPS is mandatory.** The app emits HSTS, `upgrade-insecure-requests`, and secure
  auth cookies — it will not work over plain HTTP. On managed hosting, enable the panel's
  Let's Encrypt cert for `training.richysdev.co.uk`. On a VPS, terminate TLS at nginx and
  proxy to the Node process.
- **Strava app:** set the Authorization Callback Domain to `training.richysdev.co.uk`
  (callback URL `https://training.richysdev.co.uk/api/strava/callback`).

---

## 7. Post-deploy checks

- Site loads over HTTPS and you can sign in.
- View-source shows `nonce="…"` on `<script>` tags and the browser console has **no CSP
  errors** — confirms `proxy.ts` runs and the app hydrates (the production CSP is set
  per-request there). If your host doesn't run Proxy, you'll simply get no CSP header; the
  app still works and auth stays enforced server-side, but consider re-adding a CSP.
- Creating a plan, editing, and a Strava sync all succeed.

---

## Redeploys

Repeat: upload new source → `npm ci` (if deps changed) → `npm run build` →
`npx prisma migrate deploy` (if new migrations) → **Restart**.
