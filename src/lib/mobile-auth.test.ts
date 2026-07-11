import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session, request headers, and database BEFORE importing the data
// layer — same pattern as groups.authz.test.ts.
const { authMock, headersMock, sessionFindFirst } = vi.hoisted(() => ({
  authMock: vi.fn(),
  headersMock: vi.fn(),
  sessionFindFirst: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { session: { findFirst: sessionFindFirst } },
}));

import { UnauthorizedError, requireUserId } from "@/lib/training-plan";

const withAuthorization = (value: string | null) =>
  headersMock.mockResolvedValue(new Headers(value ? { authorization: value } : {}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireUserId bearer fallback (mobile auth)", () => {
  it("uses the cookie session when present — no bearer lookup", async () => {
    authMock.mockResolvedValue({ user: { id: "userA" } });

    await expect(requireUserId()).resolves.toBe("userA");
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });

  it("resolves the user from a valid Bearer token when there is no cookie session", async () => {
    authMock.mockResolvedValue(null);
    withAuthorization("Bearer tok-123");
    sessionFindFirst.mockResolvedValue({ userId: "userB" });

    await expect(requireUserId()).resolves.toBe("userB");
    expect(sessionFindFirst).toHaveBeenCalledWith({
      where: { sessionToken: "tok-123", expires: { gt: expect.any(Date) } },
      select: { userId: true },
    });
  });

  it("accepts a lowercase 'bearer' scheme", async () => {
    authMock.mockResolvedValue(null);
    withAuthorization("bearer tok-123");
    sessionFindFirst.mockResolvedValue({ userId: "userB" });

    await expect(requireUserId()).resolves.toBe("userB");
  });

  it("rejects an unknown or expired token (the lookup filters expires > now)", async () => {
    authMock.mockResolvedValue(null);
    withAuthorization("Bearer expired-or-unknown");
    sessionFindFirst.mockResolvedValue(null);

    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects when there is no Authorization header, without touching the DB", async () => {
    authMock.mockResolvedValue(null);
    withAuthorization(null);

    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer Authorization scheme, without touching the DB", async () => {
    authMock.mockResolvedValue(null);
    withAuthorization("Basic dXNlcjpwYXNz");

    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });

  it("rejects an empty Bearer token, without touching the DB", async () => {
    authMock.mockResolvedValue(null);
    withAuthorization("Bearer   ");

    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });

  it("degrades to Unauthorized when headers() is unavailable (outside a request scope)", async () => {
    authMock.mockResolvedValue(null);
    headersMock.mockRejectedValue(new Error("headers was called outside a request scope"));

    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(sessionFindFirst).not.toHaveBeenCalled();
  });
});
