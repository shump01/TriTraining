import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyMock, signInMock, createSessionMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  signInMock: vi.fn(),
  createSessionMock: vi.fn(),
}));

// Keep the real error classes (the route matches on instanceof); stub the work.
vi.mock("@/lib/oauth-identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oauth-identity")>()),
  verifyProviderIdToken: verifyMock,
}));
vi.mock("@/lib/oauth-account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oauth-account")>()),
  signInWithProviderIdentity: signInMock,
}));
vi.mock("@/lib/session", () => ({ createDatabaseSession: createSessionMock }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));

import { MissingEmailError } from "@/lib/oauth-account";
import { OAuthNotConfiguredError, OAuthTokenError } from "@/lib/oauth-identity";

import { POST } from "./route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/oauth", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const EXPIRES = new Date("2026-10-12T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue({
    provider: "apple",
    subject: "sub",
    email: "a@example.com",
    emailVerified: true,
    name: null,
  });
  signInMock.mockResolvedValue({ userId: "u1", created: false, linked: false });
  createSessionMock.mockResolvedValue({ sessionToken: "tok-1", expires: EXPIRES });
});

describe("POST /api/auth/oauth", () => {
  it("hands the mobile client a session token and the created flag", async () => {
    signInMock.mockResolvedValue({ userId: "u1", created: true, linked: false });

    const res = await POST(
      post({ provider: "apple", idToken: "jwt", name: "Alex" }, { "x-client": "mobile" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      sessionToken: "tok-1",
      expires: EXPIRES.toISOString(),
      created: true,
    });
    expect(verifyMock).toHaveBeenCalledWith("apple", "jwt");
    expect(signInMock).toHaveBeenCalledWith(expect.objectContaining({ subject: "sub" }), {
      name: "Alex",
    });
    expect(createSessionMock).toHaveBeenCalledWith("u1");
    expect(res.headers.get("set-cookie")).toContain("tok-1");
  });

  it("keeps the token out of the body for web callers (cookie only)", async () => {
    const res = await POST(post({ provider: "google", idToken: "jwt" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, created: false });
    expect(res.headers.get("set-cookie")).toContain("tok-1");
  });

  it("400s a body that is not a sign-in request", async () => {
    expect((await POST(post({ provider: "facebook", idToken: "jwt" }))).status).toBe(400);
    expect((await POST(post({ provider: "apple" }))).status).toBe(400);
    expect((await POST(post("not json"))).status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("401s a token the provider did not sign for us", async () => {
    verifyMock.mockRejectedValue(new OAuthTokenError());

    const res = await POST(post({ provider: "apple", idToken: "jwt" }));

    expect(res.status).toBe(401);
    expect(signInMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("503s when the provider is not configured on this server", async () => {
    verifyMock.mockRejectedValue(new OAuthNotConfiguredError("google"));

    const res = await POST(post({ provider: "google", idToken: "jwt" }));

    expect(res.status).toBe(503);
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("409s with the provider-specific guidance when no email was shared", async () => {
    signInMock.mockRejectedValue(new MissingEmailError("apple"));

    const res = await POST(post({ provider: "apple", idToken: "jwt" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Sign in with Apple");
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
