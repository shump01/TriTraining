import type { NextAuthConfig } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the config src/auth.ts hands NextAuth, and drive its callbacks and
// events the way @auth/core's OAuth callback does. The policy modules run for
// real; only the database, the request headers and pending sign-ups are stubbed.
const m = vi.hoisted(() => {
  const db = {
    session: { findMany: vi.fn(), deleteMany: vi.fn() },
    account: { deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    db,
    config: null as NextAuthConfig | null,
    cookie: "",
    clearPendingSignups: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  default: (config: NextAuthConfig) => {
    m.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/apple", () => ({ default: () => ({ id: "apple" }) }));
vi.mock("next-auth/providers/google", () => ({ default: () => ({ id: "google" }) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(m.cookie ? { cookie: m.cookie } : {}),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { ...m.db, $transaction: (fn: (tx: typeof m.db) => unknown) => fn(m.db) },
}));
vi.mock("@/lib/signup-verification", () => ({ clearPendingSignups: m.clearPendingSignups }));

import "./auth";

const LIVE = new Date(Date.now() + 86_400_000);

function config(): NextAuthConfig {
  if (!m.config) throw new Error("src/auth.ts did not call NextAuth");
  return m.config;
}

const googleAccount = {
  type: "oidc" as const,
  provider: "google",
  providerAccountId: "g-attacker",
};

/** What callbacks.signIn receives for a Google callback. */
function signIn(profile: Record<string, unknown>) {
  return config().callbacks!.signIn!({
    user: { id: "provider-user", email: profile.email as string },
    account: googleAccount,
    profile,
  } as never);
}

/** What events.linkAccount receives once Auth.js has linked the account. */
function linkAccount(userId: string, providerEmail: string) {
  return config().events!.linkAccount!({
    user: { id: userId },
    account: googleAccount,
    profile: { id: "provider-user", email: providerEmail },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.cookie = "";
  m.db.session.findMany.mockResolvedValue([]);
  m.db.session.deleteMany.mockResolvedValue({ count: 0 });
  m.db.account.deleteMany.mockResolvedValue({ count: 0 });
  m.db.user.update.mockResolvedValue({});
  m.clearPendingSignups.mockResolvedValue(undefined);
});

describe("callbacks.signIn", () => {
  it("refuses an unverified provider email", async () => {
    expect(await signIn({ email: "a@gmail.com", email_verified: false })).toBe(false);
  });

  it("lets a signed-out, verified sign-in through", async () => {
    expect(await signIn({ email: "a@gmail.com", email_verified: true })).toBe(true);
    expect(m.db.session.findMany).not.toHaveBeenCalled();
  });

  it("REFUSES while signed in as a different address — before Auth.js can link anything", async () => {
    // Signed in to the squatted victim@example.com, clicking "Continue with
    // Google" as attacker@gmail.com. Auth.js would link Google to the SESSION
    // user; a string (or false) from signIn aborts before that happens.
    m.cookie = "authjs.session-token=tok-victim";
    m.db.session.findMany.mockResolvedValue([
      { id: "s1", expires: LIVE, user: { email: "victim@example.com" } },
    ]);

    const result = await signIn({ email: "Attacker@Gmail.com", email_verified: true });

    expect(result).toBe("/login?error=SignedInElsewhere");
    expect(m.db.session.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionToken: { in: ["tok-victim"] } } }),
    );
    expect(m.db.session.deleteMany).not.toHaveBeenCalled();
    expect(m.db.account.deleteMany).not.toHaveBeenCalled();
    expect(m.db.user.update).not.toHaveBeenCalled();
  });

  it("signs a same-address session out first, so Auth.js mints a fresh one", async () => {
    m.cookie = "authjs.session-token=tok-owner";
    m.db.session.findMany.mockResolvedValue([
      { id: "s1", expires: LIVE, user: { email: "owner@example.com" } },
    ]);

    expect(await signIn({ email: "owner@example.com", email_verified: "true" })).toBe(true);
    expect(m.db.session.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s1"] } } });
  });
});

describe("events.linkAccount", () => {
  it("does NOT verify a row the provider didn't vouch for, and takes the link back off", async () => {
    // Defence in depth behind signIn: if a cross-address link ever happens,
    // the Gmail login proves nothing about victim@example.com.
    m.db.user.findUnique.mockResolvedValue({
      id: "u-victim",
      email: "victim@example.com",
      emailVerified: null,
    });

    await linkAccount("u-victim", "attacker@gmail.com");

    expect(m.db.user.update).not.toHaveBeenCalled();
    expect(m.db.session.deleteMany).not.toHaveBeenCalled();
    expect(m.db.account.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u-victim", provider: "google", providerAccountId: "g-attacker" },
    });
  });

  it("reclaims a never-verified row on an email-matched link: other links, all sessions, password", async () => {
    m.db.user.findUnique.mockResolvedValue({
      id: "u-owner",
      email: "owner@example.com",
      emailVerified: null,
    });

    await linkAccount("u-owner", "owner@example.com");

    expect(m.db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "u-owner" } });
    expect(m.db.account.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "u-owner",
        NOT: { provider: "google", providerAccountId: "g-attacker" },
      },
    });
    expect(m.db.user.update).toHaveBeenCalledWith({
      where: { id: "u-owner" },
      data: { passwordHash: null, emailVerified: expect.any(Date) },
    });
  });

  it("leaves a verified row as it is", async () => {
    m.db.user.findUnique.mockResolvedValue({
      id: "u-owner",
      email: "owner@example.com",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
    });

    await linkAccount("u-owner", "owner@example.com");

    expect(m.db.session.deleteMany).not.toHaveBeenCalled();
    expect(m.db.account.deleteMany).not.toHaveBeenCalled();
    expect(m.db.user.update).not.toHaveBeenCalled();
  });
});

describe("events.createUser", () => {
  it("retires pending password sign-ups for the address that just became an account", async () => {
    await config().events!.createUser!({ user: { id: "u-new", email: "new@example.com" } });

    expect(m.clearPendingSignups).toHaveBeenCalledWith("new@example.com");
  });
});
