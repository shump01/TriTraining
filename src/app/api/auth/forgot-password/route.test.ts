import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  env: { NODE_ENV: "production", NEXTAUTH_URL: "https://www.richysdev.co.uk" },
  resetToken: vi.fn(),
  issue: vi.fn(),
  sendReset: vi.fn(),
  sendConfirm: vi.fn(),
  mailerConfigured: vi.fn(),
  budget: vi.fn(),
}));

vi.mock("@/env", () => ({ env: m.env }));
vi.mock("@/lib/password-reset", () => ({ createPasswordResetToken: m.resetToken }));
vi.mock("@/lib/signup-verification", () => ({ issueSignupToken: m.issue }));
vi.mock("@/lib/mailer", () => ({
  sendPasswordResetEmail: m.sendReset,
  sendSignupConfirmationEmail: m.sendConfirm,
  isMailerConfigured: m.mailerConfigured,
}));
vi.mock("@/lib/mail-budget", () => ({ spendMailBudget: m.budget }));
vi.mock("@/lib/security", async (orig) => ({
  ...(await orig<typeof import("@/lib/security")>()),
  enforceRateLimit: () => null,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "./route";

const EXPIRES = new Date("2026-09-30T12:00:00.000Z");

function forgot(email = "a@example.com") {
  return new NextRequest("http://localhost/api/auth/forgot-password", {
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
  m.mailerConfigured.mockReturnValue(true);
  m.budget.mockReturnValue(null);
  m.sendReset.mockResolvedValue(true);
  m.sendConfirm.mockResolvedValue("sent");
  m.resetToken.mockResolvedValue(null);
  m.issue.mockResolvedValue(null);
});

describe("POST /api/auth/forgot-password", () => {
  it("emails a reset link to an account, and never looks for a sign-up", async () => {
    m.resetToken.mockResolvedValue("reset-tok");

    await POST(forgot());

    expect(m.sendReset).toHaveBeenCalledWith(
      "a@example.com",
      "https://www.richysdev.co.uk/reset-password/reset-tok",
    );
    expect(m.issue).not.toHaveBeenCalled();
    expect(m.sendConfirm).not.toHaveBeenCalled();
  });

  it("re-sends a CONFIRMATION (recovery wording) for an address that never finished signing up", async () => {
    // "Forgot password?" is what someone who lost the confirmation presses —
    // and in the App Store build that predates verification, their only way back.
    m.issue.mockResolvedValue({ rawToken: "signup-tok", expires: EXPIRES });

    await POST(forgot());

    expect(m.sendConfirm).toHaveBeenCalledWith(
      "a@example.com",
      "https://www.richysdev.co.uk/verify-email/signup-tok",
      EXPIRES,
      "recovery",
    );
    expect(m.sendReset).not.toHaveBeenCalled();
  });

  it("answers identically for an account, an unfinished sign-up, and a stranger", async () => {
    m.resetToken.mockResolvedValue("reset-tok");
    const account = await outcome(await POST(forgot()));

    m.resetToken.mockResolvedValue(null);
    m.issue.mockResolvedValue({ rawToken: "signup-tok", expires: EXPIRES });
    const pending = await outcome(await POST(forgot()));

    m.issue.mockResolvedValue(null);
    const stranger = await outcome(await POST(forgot()));

    expect(account.status).toBe(200);
    expect(pending).toEqual(account);
    expect(stranger).toEqual(account);
    // The one message has to be true for the confirmation case too.
    expect(account.body.message).toMatch(/sign-up waiting to be confirmed/i);
  });

  it("shares the per-recipient budget with sign-up and resend", async () => {
    await POST(forgot("A@Example.com"));
    expect(m.budget).toHaveBeenCalledWith("a@example.com");

    m.budget.mockReturnValue(NextResponse.json({ error: "slow down" }, { status: 429 }));
    expect((await POST(forgot())).status).toBe(429);
    expect(m.resetToken).toHaveBeenCalledTimes(1);
  });
});
