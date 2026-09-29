import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  env: { NODE_ENV: "production", NEXTAUTH_URL: "https://www.richysdev.co.uk" },
  issue: vi.fn(),
  send: vi.fn(),
  mailerConfigured: vi.fn(),
  budget: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/env", () => ({ env: m.env }));
vi.mock("@/lib/signup-verification", () => ({ issueSignupToken: m.issue }));
vi.mock("@/lib/mailer", () => ({
  sendSignupConfirmationEmail: m.send,
  isMailerConfigured: m.mailerConfigured,
}));
vi.mock("@/lib/mail-budget", () => ({ spendMailBudget: m.budget }));
vi.mock("@/lib/security", async (orig) => ({
  ...(await orig<typeof import("@/lib/security")>()),
  enforceRateLimit: () => null,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: m.logInfo, warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "./route";

const EXPIRES = new Date("2026-09-30T12:00:00.000Z");

function resend(email = "a@example.com") {
  return new NextRequest("http://localhost/api/auth/resend-verification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

async function outcome(res: Response) {
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.env.NODE_ENV = "production";
  m.mailerConfigured.mockReturnValue(true);
  m.budget.mockReturnValue(null);
  m.send.mockResolvedValue("sent");
});

describe("POST /api/auth/resend-verification", () => {
  it("answers byte-identically whether or not a sign-up is pending — even when the send FAILS", async () => {
    m.issue.mockResolvedValue(null);
    const nothingPending = await outcome(await POST(resend()));

    m.issue.mockResolvedValue({ rawToken: "tok", expires: EXPIRES });
    const sent = await outcome(await POST(resend()));

    m.send.mockResolvedValue("failed");
    const sendFailed = await outcome(await POST(resend()));

    // A 503 on a failed send (as sign-up rightly gives) would announce that
    // someone is mid-sign-up with this address: here only one branch sends.
    expect(nothingPending.status).toBe(200);
    expect(sent).toEqual(nothingPending);
    expect(sendFailed).toEqual(nothingPending);
  });

  it("emails the link with the deadline the sign-up really has", async () => {
    m.issue.mockResolvedValue({ rawToken: "tok", expires: EXPIRES });

    await POST(resend("A@Example.com"));

    expect(m.send).toHaveBeenCalledWith(
      "a@example.com",
      "https://www.richysdev.co.uk/verify-email/tok",
      EXPIRES,
    );
  });

  it("spends the recipient's budget on EVERY request, before any lookup", async () => {
    m.issue.mockResolvedValue(null);
    await POST(resend("A@Example.com"));
    expect(m.budget).toHaveBeenCalledWith("a@example.com");

    m.budget.mockReturnValue(NextResponse.json({ error: "slow down" }, { status: 429 }));
    const res = await POST(resend());
    expect(res.status).toBe(429);
    expect(m.issue).toHaveBeenCalledTimes(1);
  });

  it("logs the link only in development without a mailer", async () => {
    m.issue.mockResolvedValue({ rawToken: "tok", expires: EXPIRES });
    m.send.mockResolvedValue("failed");

    await POST(resend());
    expect(m.logInfo).not.toHaveBeenCalled();

    m.env.NODE_ENV = "development";
    m.mailerConfigured.mockReturnValue(false);
    await POST(resend());
    expect(m.logInfo).toHaveBeenCalledOnce();
  });
});
