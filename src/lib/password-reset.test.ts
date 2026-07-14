import { createHash } from "crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB + password hashing before importing the module under test.
const {
  userFindUnique,
  userUpdate,
  vtDeleteMany,
  vtCreate,
  vtFindFirst,
  sessionDeleteMany,
  txn,
  hashPasswordMock,
} = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  vtDeleteMany: vi.fn(),
  vtCreate: vi.fn(),
  vtFindFirst: vi.fn(),
  sessionDeleteMany: vi.fn(),
  txn: vi.fn(),
  hashPasswordMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique, update: userUpdate },
    verificationToken: { deleteMany: vtDeleteMany, create: vtCreate, findFirst: vtFindFirst },
    session: { deleteMany: sessionDeleteMany },
    $transaction: txn,
  },
}));
vi.mock("@/lib/password", () => ({ hashPassword: hashPasswordMock }));

import {
  consumePasswordResetToken,
  createPasswordResetToken,
  resetPassword,
} from "@/lib/password-reset";

const sha256hex = (v: string) => createHash("sha256").update(v).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  vtDeleteMany.mockResolvedValue({ count: 0 });
  vtCreate.mockResolvedValue({});
  txn.mockResolvedValue([]);
  hashPasswordMock.mockResolvedValue("argon2-hash");
});

describe("createPasswordResetToken", () => {
  it("returns null and stores nothing for an unknown email (no enumeration)", async () => {
    userFindUnique.mockResolvedValue(null);
    const raw = await createPasswordResetToken("nobody@test.dev");
    expect(raw).toBeNull();
    expect(vtCreate).not.toHaveBeenCalled();
  });

  it("stores only the HASH of the token and returns the raw token", async () => {
    userFindUnique.mockResolvedValue({ id: "u1" });
    const raw = await createPasswordResetToken("Rider@Test.dev");

    expect(raw).toBeTruthy();
    // Prior tokens cleared first, then one created.
    expect(vtDeleteMany).toHaveBeenCalledWith({ where: { identifier: "pwreset:rider@test.dev" } });
    const created = vtCreate.mock.calls[0]![0].data;
    expect(created.identifier).toBe("pwreset:rider@test.dev"); // email lowercased
    expect(created.token).toBe(sha256hex(raw!)); // hashed at rest
    expect(created.token).not.toBe(raw); // never the raw value
    expect(created.expires.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("consumePasswordResetToken", () => {
  it("returns null for an unknown/expired token and deletes nothing", async () => {
    vtFindFirst.mockResolvedValue(null);
    expect(await consumePasswordResetToken("bad")).toBeNull();
    expect(vtDeleteMany).not.toHaveBeenCalled();
    // Lookup is by the HASH, scoped to reset tokens, and requires an unexpired row.
    const where = vtFindFirst.mock.calls[0]![0].where;
    expect(where.token).toBe(sha256hex("bad"));
    expect(where.identifier).toEqual({ startsWith: "pwreset:" });
    expect(where.expires.gt).toBeInstanceOf(Date);
  });

  it("returns the email and deletes the row (single-use) for a valid token", async () => {
    vtFindFirst.mockResolvedValue({
      identifier: "pwreset:rider@test.dev",
      token: sha256hex("good"),
    });
    const email = await consumePasswordResetToken("good");
    expect(email).toBe("rider@test.dev");
    expect(vtDeleteMany).toHaveBeenCalledWith({
      where: { identifier: "pwreset:rider@test.dev", token: sha256hex("good") },
    });
  });
});

describe("resetPassword", () => {
  it("fails (false) on an invalid token and never touches the password", async () => {
    vtFindFirst.mockResolvedValue(null);
    expect(await resetPassword("bad", "Whatever-123!")).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("sets the new hash AND revokes every session for the account", async () => {
    vtFindFirst.mockResolvedValue({
      identifier: "pwreset:rider@test.dev",
      token: sha256hex("good"),
    });
    userFindUnique.mockResolvedValue({ id: "u1" });

    const ok = await resetPassword("good", "New-Password-123!");

    expect(ok).toBe(true);
    expect(hashPasswordMock).toHaveBeenCalledWith("New-Password-123!");
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "argon2-hash" },
    });
    expect(sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(txn).toHaveBeenCalledTimes(1); // password change + session eviction are atomic
  });

  it("fails cleanly if the account was deleted after the token was issued", async () => {
    vtFindFirst.mockResolvedValue({
      identifier: "pwreset:rider@test.dev",
      token: sha256hex("good"),
    });
    userFindUnique.mockResolvedValue(null);
    expect(await resetPassword("good", "New-Password-123!")).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
