import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB + password hashing before importing the module under test.
const { userFindUnique, userUpdate, sessionDeleteMany, txn, hashPasswordMock, verifyPasswordMock } =
  vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    userUpdate: vi.fn(),
    sessionDeleteMany: vi.fn(),
    txn: vi.fn(),
    hashPasswordMock: vi.fn(),
    verifyPasswordMock: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    session: { deleteMany: sessionDeleteMany },
    // Run the interactive-transaction callback against the same mocks.
    $transaction: txn,
  },
}));
vi.mock("@/lib/password", () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
}));

import { WrongPasswordError, changePassword, updateScreenName } from "@/lib/account";

beforeEach(() => {
  vi.clearAllMocks();
  hashPasswordMock.mockResolvedValue("argon2-new-hash");
  txn.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ user: { update: userUpdate }, session: { deleteMany: sessionDeleteMany } }),
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

describe("changePassword", () => {
  const withHash = () => userFindUnique.mockResolvedValue({ passwordHash: "argon2-old" });

  it("rejects a wrong current password without writing anything", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(false);
    await expect(changePassword("u1", "wrong", "NewPassw0rd!!!", "tok")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects identically when the account has no password (no probing)", async () => {
    userFindUnique.mockResolvedValue({ passwordHash: null });
    await expect(changePassword("u1", "anything", "NewPassw0rd!!!", "tok")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    // verifyPassword is never even called — nothing to compare against.
    expect(verifyPasswordMock).not.toHaveBeenCalled();
  });

  it("hashes the new password and stores the hash, never the plaintext", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);
    await changePassword("u1", "current", "NewPassw0rd!!!", "tok");
    expect(hashPasswordMock).toHaveBeenCalledWith("NewPassw0rd!!!");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "argon2-new-hash" },
    });
    const written = JSON.stringify(userUpdate.mock.calls);
    expect(written).not.toContain("NewPassw0rd");
  });

  it("revokes every OTHER session but keeps the one making the change", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);
    await changePassword("u1", "current", "NewPassw0rd!!!", "keep-me");
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", sessionToken: { not: "keep-me" } },
    });
  });

  it("revokes ALL sessions when no current token is known", async () => {
    withHash();
    verifyPasswordMock.mockResolvedValue(true);
    await changePassword("u1", "current", "NewPassw0rd!!!", null);
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});
