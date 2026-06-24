import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";

/**
 * Centralized fallback for unexpected API errors.
 *
 * Logs the full error server-side (structured, redacted) and returns a generic
 * 500 — never a stack trace or any internal detail. Routes should map their
 * known/expected errors (auth, not-found, validation, …) to specific responses
 * BEFORE falling through to this.
 */
export function handleApiError(error: unknown, context?: Record<string, unknown>): NextResponse {
  logger.error("Unhandled API error", { ...context, error });
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
