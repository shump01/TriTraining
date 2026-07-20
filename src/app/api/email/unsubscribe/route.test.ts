import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, enforceRateLimit } = vi.hoisted(() => ({
  prisma: { user: { updateMany: vi.fn() } },
  enforceRateLimit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/security", () => ({ enforceRateLimit }));
// digest.ts transitively imports the auth stack via training-plan/load-data;
// neither is exercised by this route, so stub them out (as digest.test.ts does).
vi.mock("@/lib/training-plan", () => ({ maybeRecalculatePlanForUser: vi.fn() }));
vi.mock("@/lib/load-data", () => ({ getUserFormTsb: vi.fn() }));

import { createUnsubscribeToken } from "@/lib/digest";

import { GET, POST } from "./route";

function request(method: "GET" | "POST", token: string | null): NextRequest {
  const url = new URL("http://localhost/api/email/unsubscribe");
  if (token !== null) url.searchParams.set("token", token);
  return new NextRequest(url, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockReturnValue(null);
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
});

describe("GET /api/email/unsubscribe", () => {
  it("NEVER writes — mail-scanner link fetches must not unsubscribe anyone", async () => {
    const res = await GET(request("GET", createUnsubscribeToken("user-1")));

    expect(res.status).toBe(200);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    const html = await res.text();
    // It renders the confirmation form whose button POSTs back.
    expect(html).toContain('method="post"');
    expect(html).toContain("Unsubscribe");
  });

  it("rejects an invalid token without a write", async () => {
    const res = await GET(request("GET", "user-1.forged-mac"));
    expect(res.status).toBe(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/unsubscribe", () => {
  it("performs the unsubscribe for a valid token", async () => {
    const res = await POST(request("POST", createUnsubscribeToken("user-1")));

    expect(res.status).toBe(200);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { digestEnabled: false },
    });
    expect(await res.text()).toContain("unsubscribed");
  });

  it("rejects a missing or invalid token without a write", async () => {
    expect((await POST(request("POST", null))).status).toBe(400);
    expect((await POST(request("POST", "garbage"))).status).toBe(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
