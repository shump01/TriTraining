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
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
