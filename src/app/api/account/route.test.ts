import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, headersMock, sessionFindFirst, userDelete } = vi.hoisted(() => ({
  authMock: vi.fn(),
  headersMock: vi.fn(),
  sessionFindFirst: vi.fn(),
  userDelete: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("next/headers", () => ({ headers: () => headersMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findFirst: sessionFindFirst },
    user: { delete: userDelete },
  },
}));

import { DELETE } from "./route";

function deleteRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/account", { method: "DELETE", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockResolvedValue(new Headers());
  userDelete.mockResolvedValue({ id: "whatever" });
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
  });
});
