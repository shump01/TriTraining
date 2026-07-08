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

/**
 * Map the common domain errors (auth / not-found / forbidden) to their status
 * codes, falling through to `handleApiError` for anything unexpected. Matched by
 * error name so this stays decoupled from the modules that define them.
 */
export function mapKnownApiError(error: unknown, context?: Record<string, unknown>): NextResponse {
  if (error instanceof Error) {
    if (error.name === "UnauthorizedError") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.name === "NotFoundError") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error.name === "ForbiddenError") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  return handleApiError(error, context);
}
