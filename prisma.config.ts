import "dotenv/config";

import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 configuration. The connection URL no longer lives in the schema's
 * datasource block — the Prisma CLI (generate / migrate / db push) reads it
 * from here. At application runtime the URL is supplied to PrismaClient via the
 * `@prisma/adapter-pg` driver adapter (see src/lib/prisma.ts).
 *
 * Migrations use DIRECT_URL when set, otherwise DATABASE_URL. With a hosted
 * Postgres (e.g. Supabase) the app can run against a transaction pooler via
 * DATABASE_URL, while migrations need a direct/session connection (DIRECT_URL),
 * because poolers don't support the DDL and advisory locks Migrate relies on.
 */
const migrationUrlKey = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env(migrationUrlKey),
  },
});
