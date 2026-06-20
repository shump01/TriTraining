import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 client singleton.
 *
 * v7 uses driver adapters: the `@prisma/adapter-pg` adapter talks to Postgres
 * directly (no Rust query engine). We keep a single client across hot reloads
 * in development to avoid exhausting the connection pool.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
