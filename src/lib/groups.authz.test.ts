import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the session + database BEFORE importing the data layer, so we can assert
// exactly how access is gated without touching a real DB. Fns created via
// vi.hoisted so they exist when the hoisted vi.mock factories run.
const {
  authMock,
  groupFindFirst,
  groupFindUnique,
  groupUpdate,
  groupDelete,
  membershipFindMany,
  membershipDeleteMany,
  membershipUpsert,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  groupFindFirst: vi.fn(),
  groupFindUnique: vi.fn(),
  groupUpdate: vi.fn(),
  groupDelete: vi.fn(),
  membershipFindMany: vi.fn(),
  membershipDeleteMany: vi.fn(),
  membershipUpsert: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    group: {
      findFirst: groupFindFirst,
      findUnique: groupFindUnique,
      update: groupUpdate,
      delete: groupDelete,
    },
    groupMembership: {
      findMany: membershipFindMany,
      deleteMany: membershipDeleteMany,
      upsert: membershipUpsert,
    },
  },
}));

import { UnauthorizedError } from "@/lib/training-plan";

import {
  ForbiddenError,
  deleteGroup,
  getGroup,
  getGroupMemberStats,
  joinGroupByToken,
  leaveGroup,
  regenerateInviteToken,
  removeMember,
} from "@/lib/groups";

const asUserA = () => authMock.mockResolvedValue({ user: { id: "userA" } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("group access is gated on the session user's membership", () => {
  it("getGroup / getGroupMemberStats require a session", async () => {
    authMock.mockResolvedValue(null);
    await expect(getGroup("g1")).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(getGroupMemberStats("g1")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("a non-member cannot read a group (findFirst is scoped to their membership → null → 404)", async () => {
    asUserA();
    groupFindFirst.mockResolvedValue(null); // no group matches { id, members: { some: { userId } } }

    await expect(getGroup("g1")).rejects.toThrow(/not found/i);
    expect(groupFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "g1", members: { some: { userId: "userA" } } },
      }),
    );
    // No member data was fetched for a non-member.
    expect(membershipFindMany).not.toHaveBeenCalled();
  });

  it("a non-member cannot read member stats (the cross-user read is gated first)", async () => {
    asUserA();
    groupFindFirst.mockResolvedValue(null);

    await expect(getGroupMemberStats("g1")).rejects.toThrow(/not found/i);
    expect(membershipFindMany).not.toHaveBeenCalled(); // no other-user data loaded
  });

  it("getGroup exposes the invite token only to the owner", async () => {
    asUserA();
    groupFindFirst.mockResolvedValue({
      id: "g1",
      name: "Club",
      ownerId: "userB", // A is a member but NOT the owner
      inviteToken: "secret-token",
    });
    membershipFindMany.mockResolvedValue([{ userId: "userA", user: { email: "a@test.dev" } }]);

    const detail = await getGroup("g1");
    expect(detail.isOwner).toBe(false);
    expect(detail.inviteToken).toBeNull(); // hidden from non-owners
  });
});

describe("owner-only actions reject non-owners", () => {
  it("regenerateInviteToken throws ForbiddenError for a non-owner", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue({ id: "g1", ownerId: "userB" });
    await expect(regenerateInviteToken("g1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(groupUpdate).not.toHaveBeenCalled();
  });

  it("deleteGroup throws ForbiddenError for a non-owner", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue({ id: "g1", ownerId: "userB" });
    await expect(deleteGroup("g1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(groupDelete).not.toHaveBeenCalled();
  });

  it("removeMember throws ForbiddenError for a non-owner", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue({ id: "g1", ownerId: "userB" });
    await expect(removeMember("g1", "userC")).rejects.toBeInstanceOf(ForbiddenError);
    expect(membershipDeleteMany).not.toHaveBeenCalled();
  });

  it("the owner cannot remove themselves via removeMember", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue({ id: "g1", ownerId: "userA" });
    await expect(removeMember("g1", "userA")).rejects.toBeInstanceOf(ForbiddenError);
    expect(membershipDeleteMany).not.toHaveBeenCalled();
  });

  it("owner-only actions 404 when the group doesn't exist", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue(null);
    await expect(regenerateInviteToken("nope")).rejects.toThrow(/not found/i);
  });
});

describe("leaveGroup", () => {
  it("the owner cannot leave (must delete instead)", async () => {
    asUserA();
    groupFindFirst.mockResolvedValue({ ownerId: "userA" });
    await expect(leaveGroup("g1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(membershipDeleteMany).not.toHaveBeenCalled();
  });

  it("a non-member cannot leave (404)", async () => {
    asUserA();
    groupFindFirst.mockResolvedValue(null);
    await expect(leaveGroup("g1")).rejects.toThrow(/not found/i);
  });

  it("a non-owner member leaves successfully", async () => {
    asUserA();
    groupFindFirst.mockResolvedValue({ ownerId: "userB" });
    membershipDeleteMany.mockResolvedValue({ count: 1 });
    await expect(leaveGroup("g1")).resolves.toBeUndefined();
    expect(membershipDeleteMany).toHaveBeenCalledWith({
      where: { groupId: "g1", userId: "userA" },
    });
  });
});

describe("joinGroupByToken", () => {
  it("throws 404 for an unknown token", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue(null);
    await expect(joinGroupByToken("bad")).rejects.toThrow(/not found/i);
    expect(membershipUpsert).not.toHaveBeenCalled();
  });

  it("is idempotent — upserts the (group,user) membership so re-joining adds no duplicate", async () => {
    asUserA();
    groupFindUnique.mockResolvedValue({ id: "g1", name: "Club" });
    membershipUpsert.mockResolvedValue({ id: "m1" });

    const group = await joinGroupByToken("good-token");
    expect(group).toEqual({ id: "g1", name: "Club" });
    expect(membershipUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId_userId: { groupId: "g1", userId: "userA" } },
        create: { groupId: "g1", userId: "userA" },
        update: {},
      }),
    );
  });
});
