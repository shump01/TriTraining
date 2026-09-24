import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderIdentity } from "./oauth-identity";

const {
  accountFindUnique,
  accountCreate,
  userFindUnique,
  userCreate,
  userUpdate,
  sessionDeleteMany,
} = vi.hoisted(() => ({
  accountFindUnique: vi.fn(),
  accountCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  sessionDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    account: { findUnique: accountFindUnique, create: accountCreate },
    user: { findUnique: userFindUnique, create: userCreate, update: userUpdate },
    session: { deleteMany: sessionDeleteMany },
  };
  return { prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { EmailInUseError, MissingEmailError, signInWithProviderIdentity } from "./oauth-account";

const apple = (over: Partial<ProviderIdentity> = {}): ProviderIdentity => ({
  provider: "apple",
  subject: "apple-sub",
  email: "athlete@example.com",
  emailVerified: true,
  name: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  accountFindUnique.mockResolvedValue(null);
  userFindUnique.mockResolvedValue(null);
  accountCreate.mockResolvedValue({});
  userUpdate.mockResolvedValue({});
  userCreate.mockResolvedValue({ id: "new-user" });
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
      name: "Alex",
      emailVerified: null,
      passwordHash: null,
    });

    const result = await signInWithProviderIdentity(apple());

    expect(result).toEqual({ userId: "u2", created: false, linked: true });
    expect(accountCreate).toHaveBeenCalledWith({
      data: { provider: "apple", providerAccountId: "apple-sub", type: "oidc", userId: "u2" },
    });
    // The provider vouched for the address, so the account becomes verified.
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { emailVerified: expect.any(Date) },
    });
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("drops a never-verified password, and its sessions, when a provider takes the row", async () => {
    // A squatter registered the owner's address with a password; the owner
    // now arrives through Apple. The squatter's password must not survive.
    userFindUnique.mockResolvedValue({
      id: "u2",
      name: "Alex",
      emailVerified: null,
      passwordHash: "argon2-of-the-squatters-password",
    });

    await signInWithProviderIdentity(apple());

    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u2" } });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { passwordHash: null, emailVerified: expect.any(Date) },
    });
  });

  it("keeps the password of an account whose email was verified", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2",
      name: "Alex",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      passwordHash: "argon2-of-the-owners-password",
    });

    await signInWithProviderIdentity(apple());

    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("never links on an UNVERIFIED email that matches an account", async () => {
    userFindUnique.mockResolvedValue({
      id: "u2",
      name: "Alex",
      emailVerified: new Date(),
      passwordHash: null,
    });

    await expect(
      signInWithProviderIdentity(apple({ emailVerified: false })),
    ).rejects.toBeInstanceOf(EmailInUseError);
    expect(accountCreate).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("creates a password-less user with the provider account attached", async () => {
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

  it("creates the user unverified when the provider did not vouch for the email", async () => {
    await signInWithProviderIdentity(apple({ emailVerified: false }));

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ emailVerified: null }) }),
    );
  });

  it("refuses to create an account without an email", async () => {
    await expect(signInWithProviderIdentity(apple({ email: null }))).rejects.toBeInstanceOf(
      MissingEmailError,
    );
    expect(userCreate).not.toHaveBeenCalled();
  });
});
