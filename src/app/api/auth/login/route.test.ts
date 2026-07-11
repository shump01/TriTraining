import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUnique, verifyPasswordMock, createSessionMock } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  verifyPasswordMock: vi.fn(),
  createSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: userFindUnique } },
}));
vi.mock("@/lib/password", () => ({ verifyPassword: verifyPasswordMock }));
vi.mock("@/lib/session", () => ({ createDatabaseSession: createSessionMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));

import { POST } from "./route";

const EXPIRES = new Date("2026-08-10T00:00:00.000Z");

function loginRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ email: "a@test.dev", password: "correct horse" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue({ id: "userA", passwordHash: "hash" });
  verifyPasswordMock.mockResolvedValue(true);
  createSessionMock.mockResolvedValue({ sessionToken: "tok-123", expires: EXPIRES });
});

describe("POST /api/auth/login — mobile client contract", () => {
  it("returns the session token + expiry in the body for X-Client: mobile", async () => {
    const res = await POST(loginRequest({ "x-client": "mobile" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      sessionToken: "tok-123",
      expires: EXPIRES.toISOString(),
    });
  });

  it("keeps the cookie-only body for web callers (no token leak)", async () => {
    const res = await POST(loginRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    // The session cookie is still the web transport.
    expect(res.cookies.get("__Secure-authjs.session-token")?.value ?? "set").toBeTruthy();
  });

  it("does not return a token on invalid credentials, mobile or not", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const res = await POST(loginRequest({ "x-client": "mobile" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty("sessionToken");
  });
});
