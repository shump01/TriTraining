import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindUnique, pendingHashMock, verifyPasswordMock, createSessionMock } = vi.hoisted(
  () => ({
    userFindUnique: vi.fn(),
    pendingHashMock: vi.fn(),
    verifyPasswordMock: vi.fn(),
    createSessionMock: vi.fn(),
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: userFindUnique } },
}));
vi.mock("@/lib/signup-verification", () => ({ newestPendingSignupHash: pendingHashMock }));
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
  pendingHashMock.mockResolvedValue(null);
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

describe("POST /api/auth/login — a sign-up that was never confirmed", () => {
  beforeEach(() => {
    userFindUnique.mockResolvedValue(null);
    pendingHashMock.mockResolvedValue("pending-hash");
  });

  it("answers 403 EMAIL_UNVERIFIED to the person who knows the chosen password", async () => {
    const res = await POST(loginRequest({ "x-client": "mobile" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("EMAIL_UNVERIFIED");
    // The App Store build predating verification shows `error` verbatim, so it
    // must read as a next step — and must never carry a session.
    expect(body.error).toMatch(/confirm your email/i);
    expect(body).not.toHaveProperty("sessionToken");
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(verifyPasswordMock).toHaveBeenCalledWith("pending-hash", "correct horse");
  });

  it("gives anyone else the same generic 401 as an address with no account", async () => {
    verifyPasswordMock.mockResolvedValue(false);

    const res = await POST(loginRequest());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid email or password." });
  });

  it("runs exactly one argon2 verification on every path", async () => {
    // Pending sign-up, wrong password.
    verifyPasswordMock.mockResolvedValue(false);
    await POST(loginRequest());
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);

    // No account and nothing pending: the dummy verification.
    vi.clearAllMocks();
    userFindUnique.mockResolvedValue(null);
    pendingHashMock.mockResolvedValue(null);
    verifyPasswordMock.mockResolvedValue(false);
    await POST(loginRequest());
    expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
    expect(verifyPasswordMock).toHaveBeenCalledWith(undefined, "correct horse");
  });

  it("looks up the pending sign-up even when the account exists", async () => {
    // Skipping it on the account path would add a query to exactly the
    // no-account path, and the timing would tell them apart.
    userFindUnique.mockResolvedValue({ id: "userA", passwordHash: "hash" });
    pendingHashMock.mockResolvedValue(null);

    await POST(loginRequest());

    expect(pendingHashMock).toHaveBeenCalledWith("a@test.dev");
  });
});

describe("POST /api/auth/login — every (account, pending sign-up) combination", () => {
  // Both can exist for one address briefly (an Apple/Google sign-up racing a
  // password sign-up). The account must always win, and the pending hash must
  // never be consulted for it — else a real account holder could be told to
  // "confirm your email", or let in by the wrong password.
  const USER = { id: "userA", passwordHash: "hash" };

  it.each([
    // user,  pending,   verify, status, verifiedAgainst
    [USER, "pending-hash", true, 200, "hash"],
    [USER, "pending-hash", false, 401, "hash"],
    [USER, null, true, 200, "hash"],
    [USER, null, false, 401, "hash"],
    [null, "pending-hash", true, 403, "pending-hash"],
    [null, "pending-hash", false, 401, "pending-hash"],
    [null, null, true, 401, undefined],
    [null, null, false, 401, undefined],
  ] as const)(
    "user=%o pending=%s verify=%s -> %i",
    async (user, pending, verifies, status, against) => {
      userFindUnique.mockResolvedValue(user);
      pendingHashMock.mockResolvedValue(pending);
      verifyPasswordMock.mockResolvedValue(verifies);

      const res = await POST(loginRequest());

      expect(res.status).toBe(status);
      // Exactly one argon2 verification, always — so timing can't tell these apart.
      expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
      expect(verifyPasswordMock).toHaveBeenCalledWith(against, "correct horse");
      if (status !== 200) expect(createSessionMock).not.toHaveBeenCalled();
    },
  );
});
