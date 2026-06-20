import { NextResponse, type NextRequest } from "next/server";

import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, isCrossSiteRequest } from "@/lib/security";
import { signupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Allow a few sign-ups per IP per minute.
const SIGNUP_LIMIT = 5;
const WINDOW_MS = 60_000;

export async function POST(req: NextRequest) {
  // CSRF: reject cross-site requests.
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit BEFORE doing any work so abuse is cheap to reject.
  const limit = rateLimit(`signup:${getClientIp(req)}`, SIGNUP_LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    // Input-rule messages (email format / password policy) are safe to return —
    // they reveal nothing about which accounts exist.
    const message = parsed.error.issues[0]?.message ?? "Invalid input.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const password = parsed.data.password;

  // No user enumeration: the response is identical whether or not the email is
  // already registered. We simply don't create a duplicate.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await hashPassword(password);
    try {
      await prisma.user.create({ data: { email, passwordHash } });
    } catch {
      // Unique-constraint race: ignore so we don't leak existence.
    }
  }

  return NextResponse.json(
    { ok: true, message: "Account created. You can now log in." },
    { status: 201 },
  );
}
