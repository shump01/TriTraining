import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable env mock so each test can set the trusted-proxy depth.
const { envMock } = vi.hoisted(() => ({ envMock: { TRUSTED_PROXY_COUNT: 0 } }));
vi.mock("@/env", () => ({ env: envMock }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));

import { getClientIp } from "@/lib/security";

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/x", { headers });
}

beforeEach(() => {
  envMock.TRUSTED_PROXY_COUNT = 0;
});

describe("getClientIp — X-Forwarded-For spoof resistance", () => {
  it("ignores XFF entirely when no proxies are trusted (default)", () => {
    // Attacker-supplied XFF must not become the rate-limit key.
    const ip = getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" }));
    expect(ip).toBe("9.9.9.9");
  });

  it("falls back to a constant when nothing trustworthy is present", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4" }))).toBe("127.0.0.1");
  });

  it("with 1 trusted proxy, uses the right-most (proxy-appended) entry", () => {
    envMock.TRUSTED_PROXY_COUNT = 1;
    // Attacker prepends a fake IP; the real client is what our proxy appended.
    const ip = getClientIp(reqWith({ "x-forwarded-for": "5.5.5.5, 203.0.113.9" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("cannot be spoofed by injecting extra left-hand entries", () => {
    envMock.TRUSTED_PROXY_COUNT = 1;
    const a = getClientIp(reqWith({ "x-forwarded-for": "fake-a, 203.0.113.9" }));
    const b = getClientIp(reqWith({ "x-forwarded-for": "fake-b, 203.0.113.9" }));
    // Same real client → same bucket, regardless of the forged prefix.
    expect(a).toBe("203.0.113.9");
    expect(b).toBe("203.0.113.9");
  });

  it("with 2 trusted proxies, counts two hops back from the right", () => {
    envMock.TRUSTED_PROXY_COUNT = 2;
    const ip = getClientIp(reqWith({ "x-forwarded-for": "client, 198.51.100.7, 10.0.0.1" }));
    expect(ip).toBe("198.51.100.7");
  });

  it("clamps to the left-most entry when the header is shorter than configured depth", () => {
    envMock.TRUSTED_PROXY_COUNT = 5;
    expect(getClientIp(reqWith({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });
});
