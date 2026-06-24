// NOTE: this config is plain ESM (not .ts) on purpose — Next loads .mjs/.js
// configs with Node directly, whereas a .ts config must be transpiled through
// SWC. Keeping it as .mjs means the server can boot even on hosts where Next's
// native SWC binary is unavailable.
//
// Content-Security-Policy is set per-request in src/proxy.ts so it can carry a
// unique nonce (required for Next's inline scripts under a strict policy). The
// headers below are static and apply to every route.
//
// Environment variables are validated fail-fast at server boot by
// src/instrumentation.ts (which imports src/env), so dropping the build-time
// import here does not weaken the runtime guarantee.

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native / driver packages out of the server bundle so they load as real
  // Node modules at runtime (argon2 native addon, Prisma pg driver adapter).
  serverExternalPackages: ["@node-rs/argon2", "@prisma/adapter-pg", "pg"],

  // Apply the security headers to every route.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
