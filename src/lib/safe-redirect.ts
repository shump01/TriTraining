/**
 * Sanitize a post-auth `callbackUrl` (or any user-supplied "return to" value)
 * down to a **same-origin, relative path** — never an absolute or
 * protocol-relative URL, and never a `javascript:`/`data:` scheme.
 *
 * Why: values like `?callbackUrl=https://evil.com` would otherwise let an
 * attacker send a victim a link on the *real* site that bounces them to a
 * phishing page after login (open redirect), and `javascript:…` could escalate
 * to script execution when assigned to `window.location`.
 *
 * Accepts only a single leading `/` followed by a path. Rejects:
 *  - anything not starting with `/`               → schemes (`https:`, `javascript:`)
 *  - `//host` and `/\host`                        → protocol-relative → off-site
 *  - back-slashes and ASCII control chars/spaces  → browser normalization tricks
 * Anything rejected falls back to `fallback` (default `/dashboard`).
 *
 * Pure and dependency-free so it is safe to import from client components.
 */
const UNSAFE_CHARS = /[\\\s\x00-\x1F\x7F]/;

export function safeCallbackPath(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!value || typeof value !== "string") return fallback;
  // Must be an absolute path rooted at our origin.
  if (!value.startsWith("/")) return fallback;
  // Reject protocol-relative ("//evil.com") and the "/\evil.com" variant that
  // some browsers normalize to protocol-relative.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Reject any back-slash (treated as "/" by some parsers) and any whitespace or
  // control character (can be stripped by browsers to smuggle a scheme).
  if (UNSAFE_CHARS.test(value)) return fallback;
  return value;
}
