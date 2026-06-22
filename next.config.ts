import type { NextConfig } from "next";

// Importing the env module here validates environment variables at build time
// and when the server starts — failing fast before any request is served.
import "./src/env";

// NOTE: Content-Security-Policy is set per-request in src/proxy.ts so it can
// carry a unique nonce (required for Next's inline scripts to run under a strict
// policy). The headers below are static and apply to every route.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
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
