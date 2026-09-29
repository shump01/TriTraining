import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderIdentity } from "./oauth-identity";

const {
  accountFindUnique,
  accountCreate,
  accountDeleteMany,
  userFindUnique,
  userCreate,
  userUpdate,
  sessionDeleteMany,
  clearPendingSignups,
  tx,
} = vi.hoisted(() => {
  const m = {
    accountFindUnique: vi.fn(),
    accountCreate: vi.fn(),
    accountDeleteMany: vi.fn(),
    userFindUnique: vi.fn(),
    userCreate: vi.fn(),
    userUpdate: vi.fn(),
    sessionDeleteMany: vi.fn(),
    clearPendingSignups: vi.fn(),
  };
  const tx = {
    account: {
      findUnique: m.accountFindUnique,
      create: m.accountCreate,
      deleteMany: m.accountDeleteMany,
    },
    user: { findUnique: m.userFindUnique, create: m.userCreate, update: m.userUpdate },
    session: { deleteMany: m.sessionDeleteMany },
  };
  return { ...m, tx };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));
vi.mock("@/lib/signup-verification", () => ({ clearPendingSignups }));

import {
  hardenLinkedAccount,
  MissingEmailError,
  signInWithProviderIdentity,
  UnverifiedEmailError,
} from "./oauth-account";

const apple = (over: Partial<ProviderIdentity> = {}): ProviderIdentity => ({
  provider: "apple",
  subject: "apple-sub",
  email: "athlete@example.com",
  emailVerified: true,
  name: null,
  ...over,
});

const THIS_LINK = { provider: "apple", providerAccountId: "apple-sub" };

beforeEach(() => {
  vi.clearAllMocks();
  accountFindUnique.mockResolvedValue(null);
  userFindUnique.mockResolvedValue(null);
  accountCreate.mockResolvedValue({});
  accountDeleteMany.mockResolvedValue({ count: 0 });
  sessionDeleteMany.mockResolvedValue({ count: 0 });
  userUpdate.mockResolvedValue({});
  userCreate.mockResolvedValue({ id: "new-user" });
  clearPendingSignups.mockResolvedValue(undefined);
});

describe("signInWithProviderIdentity", () => {
  it("returns the linked user when the provider account is already known", async () => {
    accountFindUnique.mockResolvedValue({ userId: "u1", user: { name: "Alex" } });

    const result = await signInWithProviderIdentity(apple({ email: null }));

    expect(result).toEqual({ userId: "u1", created: false, linked: false });
    expect(accountFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerAccountId: { provider: "apple", providerAccountId: "apple-sub" },
        },
      }),
    );
    expect(userCreate).not.toHaveBeenCalled();
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it("backfills a missing name on a known account from the app's hint", async () => {
    accountFindUnique.mockResolvedValue({ userId: "u1", user: { name: null } });

    await signInWithProviderIdentity(apple(), { name: "  Alex Rider  " });

    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: "Alex Rider" } });
  });

  it("links to the existing account with the same VERIFIED email", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2",
      email: "athlete@example.com",
      name: "Alex",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await signInWithProviderIdentity(apple());

    expect(result).toEqual({ userId: "u2", created: false, linked: true });
    expect(accountCreate).toHaveBeenCalledWith({
      data: { provider: "apple", providerAccountId: "apple-sub", type: "oidc", userId: "u2" },
    });
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("strips a never-verified row when a provider takes it: password, ALL sessions, other links", async () => {
    // A squatter registered the owner's address with a password (and may have
    // attached a Google login of their own); the owner now arrives through
    // Apple. Nothing the squatter attached may survive.
    userFindUnique.mockResolvedValue({
      id: "u2",
      email: "athlete@example.com",
      name: "Alex",
      emailVerified: null,
    });

    await signInWithProviderIdentity(apple());

    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u2" } });
    expect(accountDeleteMany).toHaveBeenCalledWith({
      where: { userId: "u2", NOT: THIS_LINK },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { passwordHash: null, emailVerified: expect.any(Date) },
    });
    // Only after the link it keeps exists.
    expect(accountCreate.mock.invocationCallOrder[0]).toBeLessThan(
      accountDeleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps everything on an account whose email was verified", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2",
      email: "athlete@example.com",
      name: "Alex",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
    });

    await signInWithProviderIdentity(apple());

    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(accountDeleteMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("never links on an UNVERIFIED email that matches an account", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2",
      email: "athlete@example.com",
      name: "Alex",
      emailVerified: new Date(),
    });

    await expect(
      signInWithProviderIdentity(apple({ emailVerified: false })),
    ).rejects.toBeInstanceOf(UnverifiedEmailError);
    expect(accountCreate).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("retries once when the account appears mid-flight, taking the link path", async () => {
    const { Prisma } = await import("@/generated/prisma/client");
    // First pass: no account yet, but the create collides with a confirmation
    // that just made one. Second pass: the account is there to link into.
    userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "u9",
      email: "athlete@example.com",
      name: null,
      emailVerified: new Date(),
    });
    userCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const result = await signInWithProviderIdentity(apple());

    expect(result).toMatchObject({ userId: "u9", created: false, linked: true });
  });

  it("refuses an unverified email identically whether or not an account exists", async () => {
    // Refusing differently for "exists" and "doesn't" answered, for anyone
    // holding an unverified-email token, which addresses have accounts.
    userFindUnique.mockResolvedValue({
      id: "u2",
      email: "athlete@example.com",
      name: null,
      emailVerified: null,
    });
    const withAccount = await signInWithProviderIdentity(apple({ emailVerified: false })).catch(
      (e: Error) => e,
    );

    userFindUnique.mockResolvedValue(null);
    const withoutAccount = await signInWithProviderIdentity(apple({ emailVerified: false })).catch(
      (e: Error) => e,
    );

    expect(withAccount).toBeInstanceOf(UnverifiedEmailError);
    expect(withoutAccount).toBeInstanceOf(UnverifiedEmailError);
    expect((withAccount as Error).message).toBe((withoutAccount as Error).message);
  });

  it("creates a verified, password-less user with the provider account attached", async () => {
    const result = await signInWithProviderIdentity(
      apple({ provider: "google", subject: "g-sub", name: "Token Name" }),
      { name: "Hint Name" },
    );

    expect(result).toEqual({ userId: "new-user", created: true, linked: false });
    expect(userCreate).toHaveBeenCalledWith({
      data: {
        email: "athlete@example.com",
        // The app's hint wins over the token's name (Apple only ever has the hint).
        name: "Hint Name",
        emailVerified: expect.any(Date),
        accounts: { create: { provider: "google", providerAccountId: "g-sub", type: "oidc" } },
      },
      select: { id: true },
    });
  });

  it("retires any pending password sign-up for the address, in the same transaction", async () => {
    await signInWithProviderIdentity(apple());

    expect(clearPendingSignups).toHaveBeenCalledWith("athlete@example.com", tx);
  });

  it("creates no account at all for an UNVERIFIED email", async () => {
    // Before, this made an unverified row — one a later verified link would
    // have to reclaim. Now nobody gets an account for an address unproven.
    await expect(
      signInWithProviderIdentity(apple({ provider: "google", emailVerified: false })),
    ).rejects.toThrow(UnverifiedEmailError);
    await expect(signInWithProviderIdentity(apple({ emailVerified: false }))).rejects.toThrow(
      /Apple hasn't verified this email/,
    );

    expect(userCreate).not.toHaveBeenCalled();
    expect(accountCreate).not.toHaveBeenCalled();
    expect(clearPendingSignups).not.toHaveBeenCalled();
  });

  it("refuses to create an account without an email", async () => {
    await expect(signInWithProviderIdentity(apple({ email: null }))).rejects.toBeInstanceOf(
      MissingEmailError,
    );
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe("hardenLinkedAccount", () => {
  const run = (
    user: { email: string; emailVerified: Date | null },
    verifiedEmail: string | null | undefined,
  ) => hardenLinkedAccount(tx as never, { id: "u9", ...user }, { ...THIS_LINK, verifiedEmail });

  it("does not verify a row for a provider that vouched for a DIFFERENT address, and undoes the link", async () => {
    // Auth.js's signed-in branch: the squatter's session, the squatter's Gmail.
    await run({ email: "victim@example.com", emailVerified: null }, "attacker@gmail.com");

    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(accountDeleteMany).toHaveBeenCalledTimes(1);
    expect(accountDeleteMany).toHaveBeenCalledWith({ where: { userId: "u9", ...THIS_LINK } });
  });

  it("revokes sessions even when the never-verified row has no password", async () => {
    // e.g. an account the app used to create from an unverified Google email.
    await run({ email: "owner@example.com", emailVerified: null }, "Owner@Example.com");

    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u9" } });
    expect(accountDeleteMany).toHaveBeenCalledWith({ where: { userId: "u9", NOT: THIS_LINK } });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u9" },
      data: { passwordHash: null, emailVerified: expect.any(Date) },
    });
  });
});
