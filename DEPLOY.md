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
`package-lock.json`, `next.config.mjs`, `tsconfig.json`, `postcss.config.mjs`,
`prisma.config.ts`, `eslint.config.mjs`. (There is no `public/` directory.)

**Never copy** `node_modules/` or `.next/` from a dev machine — `@node-rs/argon2` is a
native binary and must be built on the target OS/arch. Build on the server.

---

## 2. Build on the server

From the app directory (the Passenger **working directory**, e.g. `~/Node`):

```bash
npm ci             # installs deps (incl. dev — needed to build) + prisma generate
npm run build      # prisma generate + next build -> .next/  (server.js serves this)
```

> `npm run build` regenerates the Prisma client itself, so a schema change can never be
> built against a stale one. Worth knowing what that used to look like, because the error
> points away from the cause: the build compiles, then the **typecheck** fails on a line
> that is perfectly correct — `'viewMode' does not exist in type 'UserSelect'`. The column
> exists and the schema declares it; only the generated client (`src/generated/`, never
> committed) was old.

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

| Variable                                    | Notes                                                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Postgres connection (Supabase pooler)                                                                                                                                                                                |
| `DIRECT_URL`                                | Direct (non-pooled) connection — used by `migrate deploy`                                                                                                                                                            |
| `AUTH_SECRET`                               | `openssl rand -base64 32`                                                                                                                                                                                            |
| `NEXTAUTH_URL`                              | `https://www.richysdev.co.uk`                                                                                                                                                                                        |
| `ENCRYPTION_KEY`                            | base64 32 bytes. **Must be the same key** that encrypted existing Strava tokens, or they can't be decrypted                                                                                                          |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | from the Strava API application                                                                                                                                                                                      |
| `STRAVA_WEBHOOK_VERIFY_TOKEN`               | only if using Strava webhooks                                                                                                                                                                                        |
| `SMTP_HOST` / `SMTP_PORT`                   | mail server for password-reset emails (port 587 STARTTLS). Optional — reset emails are skipped if unset                                                                                                              |
| `SMTP_USER` / `SMTP_PASS`                   | mailbox credentials. On Hetzner, create a mailbox (e.g. `noreply@richysdev.co.uk`) in KonsoleH                                                                                                                       |
| `MAIL_FROM`                                 | from address, e.g. `TriTrainer <noreply@richysdev.co.uk>`                                                                                                                                                            |
| `TRUSTED_PROXY_COUNT`                       | number of reverse proxies that append to `X-Forwarded-For`. Set to `1` behind Passenger/nginx so rate-limit IPs can't be spoofed. Default `0` (throttles fall back to a shared bucket)                               |
| `APPLE_TEAM_ID`                             | Apple Developer Team ID (10 chars) — enables `/.well-known/apple-app-site-association` so group-invite links open the iOS app. Optional; the route 404s until set                                                    |
| `CRON_SECRET`                               | bearer secret for `POST /api/cron/weekly-digest` — the daily tick: digest emails, scheduled Strava sync, expired-row sweep. Optional; the route answers 503 and none of it runs until set. `openssl rand -base64 32` |
| `NODE_ENV`                                  | `production` (set the host's "Application mode" to production)                                                                                                                                                       |

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
  auth cookies — it will not work over plain HTTP. On a VPS, terminate TLS at nginx and
  proxy to the Node process.

  On the Hetzner host, TLS terminates at the panel's front proxy (not in Passenger, so a
  certificate change never needs an app restart). The live certificate is a **Let's
  Encrypt wildcard** (`*.richysdev.co.uk` + apex) issued from KonsoleH → SSL. Two things
  about it that are not obvious from the panel:

  - **Renewal is manual.** A wildcard can only be validated by DNS-01, and the domain's
    DNS is hosted at **IONOS**, not Hetzner — so the panel cannot publish the challenge
    itself. When the order sits at _Authentication needed_, click its key icon for the
    `_acme-challenge.richysdev.co.uk` TXT values (there are two — one for the wildcard,
    one for the apex), add both at IONOS, then re-trigger. Certificates last 90 days;
    the first one was issued 2026-09-16.
  - **Issued is not served.** After the panel shows the certificate active, the proxy can
    take several minutes to swap it in. Confirm from outside rather than trusting green:

    ```bash
    openssl s_client -connect www.richysdev.co.uk:443 -servername www.richysdev.co.uk </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
    ```

  A lapse here takes down the website, every mobile client (the app's origin is this
  host and iOS rejects an expired certificate before any request is made), the daily
  cron, and Strava's webhook deliveries — all at once, with no error in the app's own
  logs. Set an external expiry monitor; the cron cannot watch this because it fails
  with it.

- **Strava app:** set the Authorization Callback Domain to `www.richysdev.co.uk`
  (callback URL `https://www.richysdev.co.uk/api/strava/callback`).
- **Daily cron (strongly recommended):** with `CRON_SECRET` set, add a daily cron job
  (KonsoleH → cron, or any scheduler). Despite the route's name it is the daily
  maintenance tick and does three things:

  ```
  15 6 * * *  curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://www.richysdev.co.uk/api/cron/weekly-digest
  ```

  1. **Prunes expired sessions and password-reset tokens**, which nothing else deletes.
     Without it dead rows accumulate forever, and a database leak then exposes every
     token ever issued rather than the 30 days' worth that are actually live.
  2. **Syncs connected Strava accounts.** This is the only unattended path there is —
     otherwise activities arrive only when an athlete presses "Sync now", and the
     webhook covers deauthorization only. An athlete who stops pressing the button
     silently stops having Strava data, and because Strava outranks Apple Health and
     Garmin, that quietly changes the numbers they see.
  3. **Sends any digests that are due** (the route decides who, so daily is correct;
     needs SMTP too), after the sync so the emails quote today's distances.

  Nothing here needs a second cron entry, and none of it is safe to skip. Daily is the
  right cadence: the sync batch declines to re-sync anyone touched in the last 6 hours,
  so scheduling it more often costs Strava API quota without gaining freshness.

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

Repeat: upload new source → `npm ci` (if deps changed) → `npx prisma migrate deploy`
(if new migrations) → `npm run build` → **Restart**.

Migrations run **before** the build, not after: new code that selects a column the
database doesn't have yet compiles fine and then 500s at runtime, so the window between
build and migrate is a window of live errors.

`npm run build` covers `prisma generate`, so a `prisma/schema.prisma` change needs no
separate step. Before that was wired in, skipping `npm ci` on a deploy whose
dependencies hadn't changed left the generated client stale and broke the build's
typecheck — the trap being that a schema change is neither a dependency change nor
necessarily a migration.
