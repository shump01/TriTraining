import { z } from "zod";

/**
 * Centralised, validated environment configuration.
 *
 * The schema is parsed once, at module load. It is imported at server boot via
 * `src/instrumentation.ts` (and again by `src/lib/prisma.ts` on first use), so a
 * missing or malformed variable causes the process to throw immediately with a
 * clear, actionable message — i.e. we fail fast rather than crashing later with
 * a cryptic runtime error.
 */
const envSchema = z.object({
  DATABASE_URL: z.url({
    message:
      "DATABASE_URL must be a valid connection URL, e.g. postgresql://user:pass@host:5432/db",
  }),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  STRAVA_CLIENT_ID: z.string().min(1, "STRAVA_CLIENT_ID is required"),
  STRAVA_CLIENT_SECRET: z.string().min(1, "STRAVA_CLIENT_SECRET is required"),
  NEXTAUTH_URL: z.url({ message: "NEXTAUTH_URL must be a valid URL, e.g. http://localhost:3000" }),
  // Symmetric key for encrypting Strava tokens at rest (AES-256-GCM).
  // Must be base64-encoded 32 bytes. Generate with: openssl rand -base64 32
  ENCRYPTION_KEY: z.string().refine((v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  }, "ENCRYPTION_KEY must be base64-encoded 32 bytes (generate: openssl rand -base64 32)"),
  // Optional: token used to validate the Strava webhook subscription handshake.
  STRAVA_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  // Optional Garmin Connect Developer Program credentials. Dormant until the
  // program grants access (see GARMIN_INTEGRATION_PLAN.md); the Garmin connect
  // UI and routes only activate when both are set.
  GARMIN_CLIENT_ID: z.string().optional(),
  GARMIN_CLIENT_SECRET: z.string().optional(),
  // Optional bearer secret for the scheduled-job route (weekly digest emails).
  // Unset = the cron route is disabled (503). Generate: openssl rand -base64 32
  CRON_SECRET: z.string().optional(),
  // Optional SMTP config for transactional email (password-reset links). All
  // optional so the app boots without a mail server; when unset, reset emails
  // are skipped (see src/lib/mailer.ts). Hetzner Webhosting provides a mailbox.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // "From" address for outbound mail, e.g. "TriTrainer <noreply@richysdev.co.uk>".
  MAIL_FROM: z.string().optional(),
  // Number of trusted reverse proxies in front of the app that APPEND to
  // X-Forwarded-For. Used to pick the real client IP from the correct hop for
  // rate limiting (see src/lib/security.ts). Default 0 = don't trust XFF at all
  // (safe: everyone shares a bucket). Set to 1 for a standard single reverse
  // proxy (e.g. Hetzner/Passenger, nginx); raise it only if you add more hops.
  TRUSTED_PROXY_COUNT: z.coerce.number().int().nonnegative().default(0),
  // Fail CLOSED: an unset NODE_ENV is treated as production, so a host that
  // forgets to set it can never accidentally enable development-only
  // behaviour (e.g. logging password-reset links — see the forgot-password
  // route). `next dev` and the test runner both set this explicitly.
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  // Throwing here aborts boot. The message lists every offending variable.
  throw new Error(
    `\n❌ Invalid or missing environment variables — fix the following and restart:\n${details}\n\n` +
      `See .env.example for the full list of required variables.\n`,
  );
}

export const env = parsed.data;

export type Env = typeof env;
