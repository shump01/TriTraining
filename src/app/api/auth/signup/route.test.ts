import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  env: { NODE_ENV: "production", NEXTAUTH_URL: "https://www.richysdev.co.uk" },
  mailerConfigured: vi.fn(),
  sendConfirm: vi.fn(),
  sendExisting: vi.fn(),
  hashPassword: vi.fn(),
  startSignup: vi.fn(),
  discardAttempt: vi.fn(),
  trimAttempts: vi.fn(),
  mailBudget: vi.fn(),
  userCreate: vi.fn(),
}));

vi.mock("@/env", () => ({ env: m.env }));
vi.mock("@/lib/mailer", () => ({
  isMailerConfigured: m.mailerConfigured,
  sendSignupConfirmationEmail: m.sendConfirm,
  sendAlreadyRegisteredEmail: m.sendExisting,
}));
vi.mock("@/lib/password", () => ({ hashPassword: m.hashPassword }));
vi.mock("@/lib/signup-verification", () => ({
  startSignup: m.startSignup,
  discardSignupAttempt: m.discardAttempt,
  trimSignupAttempts: m.trimAttempts,
}));
vi.mock("@/lib/mail-budget", () => ({ spendMailBudget: m.mailBudget }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }) }));
// If anything in the route tried to create an account directly, this would see it.
vi.mock("@/lib/prisma", () => ({ prisma: { user: { create: m.userCreate } } }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "./route";

const PASSWORD = "Str0ng!Passw0rd";
const EXPIRES = new Date("2026-09-30T12:00:00.000Z");
const PENDING = { kind: "pending", rawToken: "raw-tok", expires: EXPIRES, attemptId: "att-1" };

function signup(email = "new@example.com") {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.env.NODE_ENV = "production";
  m.mailerConfigured.mockReturnValue(true);
  m.sendConfirm.mockResolvedValue("sent");
  m.sendExisting.mockResolvedValue("sent");
  m.hashPassword.mockResolvedValue("argon2-hash");
  m.startSignup.mockResolvedValue(PENDING);
  m.discardAttempt.mockResolvedValue(undefined);
  m.trimAttempts.mockResolvedValue(undefined);
  m.mailBudget.mockReturnValue(null);
});

describe("POST /api/auth/signup", () => {
  it("creates no account — it emails a confirmation link instead", async () => {
    const res = await POST(signup());

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ ok: true, pendingVerification: true });
    expect(m.userCreate).not.toHaveBeenCalled();
    expect(m.sendConfirm).toHaveBeenCalledWith(
      "new@example.com",
      "https://www.richysdev.co.uk/verify-email/raw-tok",
      EXPIRES,
    );
  });

  it("takes the attempt back out when its email fails to send", async () => {
    // Left in place, the login screen would tell this person "we sent you a
    // link" about an email that never went out.
    m.sendConfirm.mockResolvedValue("failed");

    await POST(signup());

    expect(m.discardAttempt).toHaveBeenCalledWith("new@example.com", PENDING);
  });

  it("keeps the attempt when the email DID go out, and only then trims", async () => {
    await POST(signup());
    expect(m.discardAttempt).not.toHaveBeenCalled();
    expect(m.trimAttempts).toHaveBeenCalledWith("new@example.com");
  });

  it("KEEPS the attempt on a timeout — the email may still arrive, and its link must work", async () => {
    // The deadline doesn't abort the send. Rolling back here left a
    // late-delivered email carrying a link to an attempt that no longer existed.
    m.sendConfirm.mockResolvedValue("timed_out");

    const res = await POST(signup());

    expect(res.status).toBe(503);
    expect(m.discardAttempt).not.toHaveBeenCalled();
    expect(m.trimAttempts).toHaveBeenCalled();
  });

  it("never trims when the attempt is being discarded", async () => {
    m.sendConfirm.mockResolvedValue("failed");
    await POST(signup());
    expect(m.trimAttempts).not.toHaveBeenCalled();
  });

  it("answers a timeout the same on both branches", async () => {
    m.sendConfirm.mockResolvedValue("timed_out");
    const fresh = await POST(signup());

    m.startSignup.mockResolvedValue({ kind: "existing" });
    m.sendExisting.mockResolvedValue("timed_out");
    const known = await POST(signup("owner@example.com"));

    expect(known.status).toBe(fresh.status);
    await expect(known.json()).resolves.toEqual(await fresh.json());
  });

  it("answers an address that already has an account identically, and tells its owner", async () => {
    const fresh = await (await POST(signup())).json();

    m.startSignup.mockResolvedValue({ kind: "existing" });
    const known = await POST(signup("owner@example.com"));

    expect(known.status).toBe(201);
    await expect(known.json()).resolves.toEqual(fresh);
    expect(m.sendExisting).toHaveBeenCalledWith(
      "owner@example.com",
      "https://www.richysdev.co.uk/login",
      "https://www.richysdev.co.uk/forgot-password",
    );
  });

  it("hashes the password on BOTH branches, so timing can't reveal an existing account", async () => {
    m.startSignup.mockResolvedValue({ kind: "existing" });
    await POST(signup("owner@example.com"));
    expect(m.hashPassword).toHaveBeenCalledWith(PASSWORD);
  });

  it("503s when the confirmation email can't be sent — never a false 'check your inbox'", async () => {
    m.sendConfirm.mockResolvedValue("failed");

    const res = await POST(signup());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/couldn't confirm your email was sent/i);
  });

  it("fails identically on the existing-account branch, so a 503 reveals nothing", async () => {
    m.sendConfirm.mockResolvedValue("failed");
    const fresh = await POST(signup());

    m.startSignup.mockResolvedValue({ kind: "existing" });
    m.sendExisting.mockResolvedValue("failed");
    const known = await POST(signup("owner@example.com"));

    expect(known.status).toBe(fresh.status);
    await expect(known.json()).resolves.toEqual(await fresh.json());
  });

  it("refuses up front in production without a mailer, storing no attempt", async () => {
    m.mailerConfigured.mockReturnValue(false);

    const res = await POST(signup());

    expect(res.status).toBe(503);
    expect(m.startSignup).not.toHaveBeenCalled();
    expect(m.hashPassword).not.toHaveBeenCalled();
  });

  it("in development without a mailer, proceeds and treats the logged link as sent", async () => {
    m.env.NODE_ENV = "development";
    m.mailerConfigured.mockReturnValue(false);
    m.sendConfirm.mockResolvedValue("failed");

    const res = await POST(signup());

    expect(res.status).toBe(201);
  });

  it("spends the recipient's mail budget before any work", async () => {
    const { NextResponse } = await import("next/server");
    m.mailBudget.mockReturnValue(NextResponse.json({ error: "slow down" }, { status: 429 }));

    const res = await POST(signup("Victim@Example.com"));

    expect(res.status).toBe(429);
    expect(m.mailBudget).toHaveBeenCalledWith("victim@example.com");
    expect(m.hashPassword).not.toHaveBeenCalled();
    expect(m.sendConfirm).not.toHaveBeenCalled();
  });

  it("still enforces the password policy", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com", password: "short" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(m.startSignup).not.toHaveBeenCalled();
  });
});
