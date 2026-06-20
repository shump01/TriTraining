import "dotenv/config";

import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 configuration. The connection URL no longer lives in the schema's
 * datasource block — the Prisma CLI (generate / migrate / db push) reads it
 * from here. At application runtime the URL is supplied to PrismaClient via the
 * `@prisma/adapter-pg` driver adapter (see src/lib/prisma.ts).
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
