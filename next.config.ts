import type { NextConfig } from "next";

// Importing the env module here validates environment variables at build time
// and when the server starts — failing fast before any request is served.
import "./src/env";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy.
 * `'unsafe-eval'` is only allowed in development (Next.js dev tooling needs it);
 * `'unsafe-inline'` on styles covers Next's injected critical CSS.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self'${isDev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
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
