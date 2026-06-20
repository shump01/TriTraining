/**
 * Next.js instrumentation hook. `register()` runs once when the server process
 * starts (both `next dev` and `next start`). Importing `./env` here validates
 * the environment at boot so the server refuses to start with bad config.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run in the Node.js runtime (skip the Edge runtime, where these
  // server-only secrets are neither present nor relevant).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./env");
  }
}
