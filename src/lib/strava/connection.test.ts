import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connFindUnique,
  connFindMany,
  connDelete,
  connDeleteMany,
  connUpdate,
  loadDeleteMany,
  deauthorize,
  refreshTokens,
  decrypt,
} = vi.hoisted(() => ({
  connFindUnique: vi.fn(),
  connFindMany: vi.fn(),
  connDelete: vi.fn(),
  connDeleteMany: vi.fn(),
  connUpdate: vi.fn(),
  loadDeleteMany: vi.fn(),
  deauthorize: vi.fn(),
  refreshTokens: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stravaConnection: {
      findUnique: connFindUnique,
      findMany: connFindMany,
      delete: connDelete,
      deleteMany: connDeleteMany,
      update: connUpdate,
    },
    activityLoad: { deleteMany: loadDeleteMany },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  deauthorizeStrava: deauthorize,
  refreshStravaTokens: refreshTokens,
}));
vi.mock("./crypto", () => ({ decryptSecret: decrypt, encryptSecret: (v: string) => v }));

import { deleteStravaConnectionByAthleteId, disconnectStrava } from "@/lib/strava/connection";

/** A connection with a token that is still valid, so no refresh is attempted. */
function liveConnection(userId = "user-1") {
  return {
    userId,
    athleteId: "athlete-9",
    accessToken: "enc",
    refreshToken: "enc",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scope: "activity:read",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  connDelete.mockResolvedValue({});
  connDeleteMany.mockResolvedValue({ count: 1 });
  loadDeleteMany.mockResolvedValue({ count: 0 });
  deauthorize.mockResolvedValue(undefined);
  decrypt.mockReturnValue("access-token");
});

describe("disconnectStrava", () => {
  it("deletes the Strava-sourced training-load rows, scoped to that user and source", async () => {
    connFindUnique.mockResolvedValue(liveConnection());

    await disconnectStrava("user-1");

    // Scope matters more than the call itself: the same table holds Apple
    // Health and Garmin rows for this user, and other users' Strava rows.
    expect(loadDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", source: "STRAVA" },
    });
  });

  it("does nothing at all when there is no connection", async () => {
    connFindUnique.mockResolvedValue(null);

    await disconnectStrava("user-1");

    expect(loadDeleteMany).not.toHaveBeenCalled();
    expect(connDelete).not.toHaveBeenCalled();
  });

  it("still clears the data when Strava's deauthorize call fails", async () => {
    connFindUnique.mockResolvedValue(liveConnection());
    deauthorize.mockRejectedValue(new Error("strava is down"));

    await disconnectStrava("user-1");

    expect(connDelete).toHaveBeenCalled();
    expect(loadDeleteMany).toHaveBeenCalled();
  });

  it("does not throw when the load delete fails — erasure must not be blocked", async () => {
    connFindUnique.mockResolvedValue(liveConnection());
    loadDeleteMany.mockRejectedValue(new Error("db blip"));

    await expect(disconnectStrava("user-1")).resolves.toBeUndefined();
    expect(connDelete).toHaveBeenCalled();
  });
});

describe("deleteStravaConnectionByAthleteId (deauthorization webhook)", () => {
  it("clears the same derived data as an in-app disconnect", async () => {
    connFindMany.mockResolvedValue([{ userId: "user-1" }]);

    await deleteStravaConnectionByAthleteId("athlete-9");

    expect(connDeleteMany).toHaveBeenCalledWith({ where: { athleteId: "athlete-9" } });
    expect(loadDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", source: "STRAVA" },
    });
  });

  it("handles an unknown athlete without touching any load rows", async () => {
    connFindMany.mockResolvedValue([]);

    await deleteStravaConnectionByAthleteId("nobody");

    expect(loadDeleteMany).not.toHaveBeenCalled();
  });

  it("reads the affected users BEFORE deleting the connections", async () => {
    // Order is the whole correctness argument: once the rows are gone there is
    // no way back from athleteId to userId, and the load rows would be orphaned.
    const order: string[] = [];
    connFindMany.mockImplementation(async () => {
      order.push("find");
      return [{ userId: "user-1" }];
    });
    connDeleteMany.mockImplementation(async () => {
      order.push("delete");
      return { count: 1 };
    });

    await deleteStravaConnectionByAthleteId("athlete-9");

    expect(order).toEqual(["find", "delete"]);
  });
});
