import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimiterForTests } from "@/lib/rate-limit";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const m = vi.hoisted(() => ({
  confirmSignup: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/lib/signup-verification", () => ({ confirmSignup: m.confirmSignup }));
vi.mock("@/lib/session", () => ({ createDatabaseSession: m.createSession }));
// NB the REAL rate limiter: the throttle's check and its spend must agree on
// key and limit, and only exercising the real thing proves that.

import { POST } from "./route";

const EXPIRES = new Date("2026-10-29T00:00:00.000Z");
const FAILURE_LIMIT = 10;

function confirm(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ token: "raw-tok", password: "Str0ng!Passw0rd" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  __resetRateLimiterForTests();
  m.createSession.mockResolvedValue({ sessionToken: "sess-1", expires: EXPIRES });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/auth/verify-email", () => {
  it("signs the confirmer straight in with an httpOnly session cookie", async () => {
    m.confirmSignup.mockResolvedValue({ status: "created", userId: "u1" });

    const res = await POST(confirm());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, status: "created" });
    expect(m.createSession).toHaveBeenCalledWith("u1");
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("sess-1");
    expect(cookie?.httpOnly).toBe(true);
    // Passes both the link and the password through — the password is the point.
    expect(m.confirmSignup).toHaveBeenCalledWith("raw-tok", "Str0ng!Passw0rd");
  });

  it("returns the token in the body only for the mobile client", async () => {
    m.confirmSignup.mockResolvedValue({ status: "created", userId: "u1" });

    const res = await POST(confirm({ "x-client": "mobile" }));

    await expect(res.json()).resolves.toEqual({
      ok: true,
      status: "created",
      sessionToken: "sess-1",
      expires: EXPIRES.toISOString(),
    });
  });

  it.each([
    ["wrong_password", 400, "WRONG_PASSWORD"],
    ["invalid_token", 400, "INVALID_LINK"],
  ] as const)("creates no session on %s", async (status, http, code) => {
    m.confirmSignup.mockResolvedValue({ status });

    const res = await POST(confirm());

    expect(res.status).toBe(http);
    await expect(res.json()).resolves.toMatchObject({ code });
    expect(m.createSession).not.toHaveBeenCalled();
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("never signs anyone into an account that already existed", async () => {
    m.confirmSignup.mockResolvedValue({ status: "already_registered" });

    const res = await POST(confirm());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "already_registered" });
    expect(m.createSession).not.toHaveBeenCalled();
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("explains a used or expired link, pointing at sign-in", async () => {
    m.confirmSignup.mockResolvedValue({ status: "invalid_token" });

    const body = await (await POST(confirm())).json();

    expect(body.error).toMatch(/already confirmed, just sign in/i);
  });

  it("allows exactly the failure limit, then 429s WITHOUT doing the work", async () => {
    m.confirmSignup.mockResolvedValue({ status: "wrong_password" });

    for (let i = 0; i < FAILURE_LIMIT; i++) {
      expect((await POST(confirm())).status).toBe(400);
    }
    const blocked = await POST(confirm());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(m.confirmSignup).toHaveBeenCalledTimes(FAILURE_LIMIT);
  });

  it("counts invalid links and wrong passwords against the same budget", async () => {
    for (let i = 0; i < FAILURE_LIMIT; i++) {
      m.confirmSignup.mockResolvedValueOnce({
        status: i % 2 ? "invalid_token" : "wrong_password",
      });
      await POST(confirm());
    }
    expect((await POST(confirm())).status).toBe(429);
  });

  it("refunds successes, so real confirmations never lock anyone out", async () => {
    m.confirmSignup.mockResolvedValue({ status: "created", userId: "u1" });
    for (let i = 0; i < FAILURE_LIMIT * 3; i++) {
      expect((await POST(confirm())).status).toBe(200);
    }

    // Still the whole failure budget left.
    m.confirmSignup.mockResolvedValue({ status: "wrong_password" });
    for (let i = 0; i < FAILURE_LIMIT; i++) {
      expect((await POST(confirm())).status).toBe(400);
    }
    expect((await POST(confirm())).status).toBe(429);
  });

  it("caps work IN FLIGHT: a concurrent burst can't all pass the check first", async () => {
    // The bug this replaced: the budget was only spent after a failure had
    // finished, so every request in a burst passed the check before any failed
    // — each buying up to five argon2 verifications.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    m.confirmSignup.mockImplementation(async () => {
      await gate;
      return { status: "wrong_password" };
    });

    const burst = Array.from({ length: FAILURE_LIMIT + 5 }, () => POST(confirm()));
    // Let every request get as far as it can before any confirm finishes.
    await vi.advanceTimersByTimeAsync(0);
    expect(m.confirmSignup).toHaveBeenCalledTimes(FAILURE_LIMIT);

    release();
    const statuses = (await Promise.all(burst)).map((r) => r.status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(statuses.filter((s) => s === 400)).toHaveLength(FAILURE_LIMIT);
  });

  it("does no work at all for a malformed body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "t" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(m.confirmSignup).not.toHaveBeenCalled();
  });

  it("rejects a cross-site POST", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/auth/verify-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify({ token: "t", password: "p" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(m.confirmSignup).not.toHaveBeenCalled();
  });
});
