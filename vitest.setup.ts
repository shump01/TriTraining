// Provide dummy env vars so modules that import `@/env` (which validates at load)
// can be imported under test. Real values are never needed for unit tests.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test";
process.env.AUTH_SECRET ??= "test-auth-secret-please-ignore";
process.env.STRAVA_CLIENT_ID ??= "test-client-id";
process.env.STRAVA_CLIENT_SECRET ??= "test-client-secret";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
