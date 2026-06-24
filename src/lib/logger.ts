/**
 * Minimal structured logger.
 *
 * Emits one JSON object per line to stdout/stderr (easy to ship to any log
 * aggregator). All context is run through {@link redact} so secrets, tokens,
 * and PII never reach the logs — even if a caller passes a whole request body
 * or error object by accident.
 *
 * No dependency: `console.*` is the transport. Log *lines* are server-side only;
 * nothing here is ever sent to a client.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Object keys whose values must never be logged. Matched case-insensitively as a
 * substring, so e.g. `accessToken`, `refresh_token`, `passwordHash`,
 * `STRAVA_CLIENT_SECRET`, `authorization`, `sessionToken` are all caught.
 */
const SENSITIVE_KEY =
  /(pass|token|secret|authorization|cookie|session|nonce|\bcode\b|\bstate\b|email|hash|credential|api[-_]?key|client[-_]?secret|encryption)/i;

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;

/**
 * Recursively copy `value`, replacing any property whose key looks sensitive
 * with `[redacted]`. Cycles and over-deep structures are collapsed safely.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }

  // Errors: keep name/message/stack (server-side only), redact any extra props.
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    message,
  };
  if (context && Object.keys(context).length > 0) {
    entry.context = redact(context);
  }

  const line = JSON.stringify(entry);
  // Route errors/warnings to stderr; everything else to stdout.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
