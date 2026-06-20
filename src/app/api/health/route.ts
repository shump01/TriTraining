import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// Always evaluate at request time — a health check must never be cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Liveness + readiness probe. Returns 200 when the app is up AND the database
 * is reachable; 503 when the database connectivity check fails.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    // Cheapest possible round-trip that proves the connection is live.
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[health] database connectivity check failed:", error);

    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
