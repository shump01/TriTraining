import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, headersMock, sessionFindFirst, userDelete, userFindUnique, tokenDeleteMany } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    headersMock: vi.fn(),
    sessionFindFirst: vi.fn(),
    userDelete: vi.fn(),
    userFindUnique: vi.fn(),
    tokenDeleteMany: vi.fn(),
  }));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findFirst: sessionFindFirst },
    user: { delete: userDelete, findUnique: userFindUnique },
    verificationToken: { deleteMany: tokenDeleteMany },
  },
}));
// Deletion best-effort revokes the Strava grant; not what these tests assert.
vi.mock("@/lib/strava/connection", () => ({
  disconnectStrava: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE } from "./route";

function deleteRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/account", { method: "DELETE", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockResolvedValue(new Headers());
  userDelete.mockResolvedValue({ id: "whatever" });
  userFindUnique.mockResolvedValue({ email: "Athlete@Example.com" });
  tokenDeleteMany.mockResolvedValue({ count: 0 });
});

describe("DELETE /api/account", () => {
  it("deletes exactly the session user (cookie session)", async () => {
    authMock.mockResolvedValue({ user: { id: "userA" } });

    const res = await DELETE(deleteRequest());

    expect(res.status).toBe(200);
    expect(userDelete).toHaveBeenCalledWith({ where: { id: "userA" } });
  });

  it("deletes exactly the bearer-token user (mobile session)", async () => {
    authMock.mockResolvedValue(null);
    headersMock.mockResolvedValue(new Headers({ authorization: "Bearer tok-123" }));
    sessionFindFirst.mockResolvedValue({ userId: "userB" });

    const res = await DELETE(deleteRequest({ authorization: "Bearer tok-123" }));

    expect(res.status).toBe(200);
    expect(userDelete).toHaveBeenCalledWith({ where: { id: "userB" } });
  });

  it("401s without any session and deletes nothing", async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(deleteRequest());

    expect(res.status).toBe(401);
    expect(userDelete).not.toHaveBeenCalled();
    expect(tokenDeleteMany).not.toHaveBeenCalled();
  });

  it("also clears the user's password-reset tokens — they outlive the cascade", async () => {
    // VerificationToken rows are keyed by EMAIL, not by a userId FK, so no
    // cascade reaches them: without this the address survives erasure.
    authMock.mockResolvedValue({ user: { id: "userA" } });

    await DELETE(deleteRequest());

    expect(tokenDeleteMany).toHaveBeenCalledWith({
      where: { identifier: "pwreset:athlete@example.com" },
    });
  });

  it("clears the session cookie with Secure so the __Secure- prefix is honored", async () => {
    authMock.mockResolvedValue({ user: { id: "userA" } });

    const res = await DELETE(deleteRequest());

    // A bare cookies.delete() omits `secure`, and browsers reject a
    // __Secure--prefixed cookie set without it — the clear would silently fail.
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/authjs\.session-token=/);
    expect(cookie.toLowerCase()).toMatch(/max-age=0|expires=/);
  });
});
