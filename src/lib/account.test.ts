import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB + password hashing before importing the module under test.
const {
  userFindUnique,
  userUpdate,
  sessionDeleteMany,
  sessionCreate,
  tokenDeleteMany,
  txn,
  hashPasswordMock,
  verifyPasswordMock,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionCreate: vi.fn(),
  tokenDeleteMany: vi.fn(),
  txn: vi.fn(),
  hashPasswordMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    session: { deleteMany: sessionDeleteMany, create: sessionCreate },
    verificationToken: { deleteMany: tokenDeleteMany },
    // Run the interactive-transaction callback against the same mocks.
    $transaction: txn,
  },
}));
vi.mock("@/lib/password", () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
}));

import {
  WrongPasswordError,
  changePassword,
  updateScreenName,
  updateViewMode,
} from "@/lib/account";

beforeEach(() => {
  vi.clearAllMocks();
  hashPasswordMock.mockResolvedValue("argon2-new-hash");
  txn.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      user: { update: userUpdate },
      session: { deleteMany: sessionDeleteMany, create: sessionCreate },
      verificationToken: { deleteMany: tokenDeleteMany },
    }),
  );
});

describe("updateScreenName", () => {
  it("stores the trimmed name", async () => {
    await updateScreenName("u1", "  Richy  ");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: "Richy" } });
  });

  it("clears the name for empty/whitespace input (falls back to email-derived)", async () => {
    await updateScreenName("u1", "   ");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { name: null } });
    await updateScreenName("u1", null);
    expect(userUpdate).toHaveBeenLastCalledWith({ where: { id: "u1" }, data: { name: null } });
  });
});

describe("updateViewMode", () => {
  it("stores the chosen plan-view density", async () => {
    await updateViewMode("u1", "SIMPLE");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: "u1" }, data: { viewMode: "SIMPLE" } });
    await updateViewMode("u1", "DETAILED");
    expect(userUpdate).toHaveBeenLastCalledWith({
      where: { id: "u1" },
      data: { viewMode: "DETAILED" },
    });
  });
});

describe("changePassword", () => {
  const withHash = () => userFindUnique.mockResolvedValue({ passwordHash: "argon2-old" });

  it("rejects a wrong current password without writing anything", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(false);
    await expect(changePassword("u1", "wrong", "NewPassw0rd!!!")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects identically when the account has no password (no probing)", async () => {
    userFindUnique.mockResolvedValue({ passwordHash: null });
    await expect(changePassword("u1", "anything", "NewPassw0rd!!!")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    // verifyPassword is never even called — nothing to compare against.
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("hashes the new password and stores the hash, never the plaintext", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);
    await changePassword("u1", "current", "NewPassw0rd!!!");
    expect(hashPasswordMock).toHaveBeenCalledWith("NewPassw0rd!!!");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "argon2-new-hash" },
    });
    const written = JSON.stringify(userUpdate.mock.calls);
    expect(written).not.toContain("NewPassw0rd");
  });

  it("revokes EVERY session — no token survives the change", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);
    await changePassword("u1", "current", "NewPassw0rd!!!");
    // No `not:` exception: the caller's own token may be the compromised one.
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("rotates in a fresh session and returns it, so the caller stays signed in", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);

    const result = await changePassword("u1", "current", "NewPassw0rd!!!");

    expect(sessionCreate).toHaveBeenCalledTimes(1);
    const created = sessionCreate.mock.calls[0]![0] as {
      data: { sessionToken: string; userId: string; expires: Date };
    };
    expect(created.data.userId).toBe("u1");
    expect(created.data.sessionToken).toHaveLength(64); // 32 random bytes, hex
    // The returned token is exactly the one written — the route sets it as the
    // cookie / hands it to the mobile client.
    expect(result.sessionToken).toBe(created.data.sessionToken);
    expect(result.expires).toEqual(created.data.expires);
  });

  it("revokes then recreates — never leaves the account with no session", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);
    const order: string[] = [];
    sessionDeleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 3 };
    });
    sessionCreate.mockImplementation(async () => {
      order.push("create");
      return {};
    });

    await changePassword("u1", "current", "NewPassw0rd!!!");

    // Both inside the one transaction, delete first: no window where a stale
    // token is still valid, none where the user has nothing.
    expect(order).toEqual(["delete", "create"]);
  });

  it("invalidates outstanding password-reset links for the address", async () => {
    userFindUnique.mockResolvedValue({
      passwordHash: "argon2-old",
      email: "Athlete@Example.com",
    });
    verifyPasswordMock.mockResolvedValue(true);

    await changePassword("u1", "current", "NewPassw0rd!!!");

    expect(tokenDeleteMany).toHaveBeenCalledWith({
      where: { identifier: "pwreset:athlete@example.com" },
    });
  });
});
