import { randomBytes } from "crypto";

import { displayNameFor } from "@/lib/display-name";
import { pickFeaturedPlan } from "@/lib/featured-plan";
import { buildMemberDisciplineStats, buildMemberWeekStats, rankByPct } from "@/lib/group-stats";
import { prisma } from "@/lib/prisma";
import { NotFoundError, requireUserId } from "@/lib/training-plan";
import { planStartWeek } from "@/lib/weekly-targets";

/**
 * User-scoped data access for training groups.
 *
 * A group is the ONLY place one user's data is visible to another, so every
 * read is gated on the requester's membership (a non-member sees a `NotFoundError`
 * — we never confirm a group exists to someone outside it). The cross-user read,
 * `getGroupMemberStats`, returns only aggregated per-sport current-week %s
 * (see src/lib/group-stats.ts) — never raw plans, targets, or actuals.
 *
 * Owner-only actions (rotate invite link, remove member, delete group) assert
 * `group.ownerId === userId` and throw `ForbiddenError` otherwise.
 */

/** Thrown when a member attempts an action reserved for the group's owner. */
export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden: not permitted");
    this.name = "ForbiddenError";
  }
}

function newInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Load a group only if the session user is a member; otherwise `NotFoundError`
 * (no existence leak to outsiders). The relation filter does the gating.
 */
async function loadGroupForMember(groupId: string, userId: string) {
  const group = await prisma.group.findFirst({
    where: { id: groupId, members: { some: { userId } } },
    select: { id: true, name: true, ownerId: true, inviteToken: true },
  });
  if (!group) throw new NotFoundError();
  return group;
}

/** Load a group and assert the session user owns it. */
async function requireOwnedGroup(groupId: string, userId: string) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, ownerId: true },
  });
  if (!group) throw new NotFoundError();
  if (group.ownerId !== userId) throw new ForbiddenError();
  return group;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface MyGroupSummary {
  id: string;
  name: string;
  memberCount: number;
  isOwner: boolean;
}

/** Groups the session user belongs to, with member counts. */
export async function listMyGroups(): Promise<MyGroupSummary[]> {
  const userId = await requireUserId();
  const memberships = await prisma.groupMembership.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    select: {
      group: {
        select: { id: true, name: true, ownerId: true, _count: { select: { members: true } } },
      },
    },
  });
  return memberships.map((m) => ({
    id: m.group.id,
    name: m.group.name,
    memberCount: m.group._count.members,
    isOwner: m.group.ownerId === userId,
  }));
}

export interface GroupDetail {
  id: string;
  name: string;
  isOwner: boolean;
  /** Present only to the owner — the shareable-link secret. */
  inviteToken: string | null;
  members: { userId: string; name: string; isOwner: boolean; isMe: boolean }[];
}

/** Group detail — membership-gated. `inviteToken` is exposed only to the owner. */
export async function getGroup(groupId: string): Promise<GroupDetail> {
  const userId = await requireUserId();
  const group = await loadGroupForMember(groupId, userId);
  const isOwner = group.ownerId === userId;

  const members = await prisma.groupMembership.findMany({
    where: { groupId },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, user: { select: { email: true, name: true } } },
  });

  return {
    id: group.id,
    name: group.name,
    isOwner,
    inviteToken: isOwner ? group.inviteToken : null,
    members: members.map((m) => ({
      userId: m.userId,
      name: displayNameFor(m.user),
      isOwner: m.userId === group.ownerId,
      isMe: m.userId === userId,
    })),
  };
}

export interface MemberStat {
  userId: string;
  name: string;
  isOwner: boolean;
  /**
   * Whether the member has a plan in progress — deliberately a BOOLEAN, not the
   * plan's name. The privacy policy tells members they see each other's screen
   * name and weekly progress "and nothing else", and a race name ("Ironman
   * Hamburg") is more than that.
   */
  hasActivePlan: boolean;
  disciplines: ReturnType<typeof buildMemberDisciplineStats>;
  /** Weekly standing (whole-plan %) — see buildMemberWeekStats. Null without a plan. */
  weekPct: number | null;
  lastWeekPct: number | null;
  streak: number;
  /** This week's rank within the group (competition ranking); null when unranked. */
  rank: number | null;
  /** The finished week's FINAL rank — what the Monday brief quotes once the week has rolled. */
  lastRank: number | null;
}

/**
 * Per-member high-level progress — the one place group members read each other's
 * data. Membership-gated. For each member we pick their active plan (nearest
 * upcoming, else most recent — the dashboard's rule) and expose ONLY the
 * per-sport current-week %; raw plan data never leaves this function.
 */
export async function getGroupMemberStats(groupId: string): Promise<MemberStat[]> {
  const userId = await requireUserId();
  const group = await loadGroupForMember(groupId, userId);
  const now = new Date();

  const members = await prisma.groupMembership.findMany({
    where: { groupId },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      user: {
        select: {
          email: true,
          name: true,
          trainingPlans: {
            orderBy: { eventDate: "asc" },
            select: {
              name: true,
              eventDate: true,
              weekStartDay: true,
              // Needed to rank with pickFeaturedPlan, exactly as the dashboard does.
              priority: true,
              startDate: true,
              createdAt: true,
              weeklyTargets: {
                select: { discipline: true, weekStartDate: true, targetMeters: true },
              },
              weeklyActuals: {
                select: { discipline: true, weekStartDate: true, actualMeters: true, source: true },
              },
              // Only the DATE — never the reason, which is health data. Feeds
              // the progress engine's paused flag; the shared per-week % is
              // unchanged by it today, but the shape contract requires every
              // reader to answer the pause question explicitly.
              weeklyPauses: { select: { weekStartDate: true } },
            },
          },
        },
      },
    },
  });

  const stats = members.map((m) => {
    // The same featured-plan rule the dashboard uses, from the shared module —
    // this used to carry its own copy of the retired "nearest upcoming event"
    // logic, so a group could show a member training for a C-race tune-up while
    // their own dashboard led with their A-race build.
    const active = pickFeaturedPlan(
      m.user.trainingPlans.map((p) => ({
        ...p,
        eventMs: p.eventDate.getTime(),
        startMs: planStartWeek(p).getTime(),
      })),
      now.getTime(),
    );
    const week = active ? buildMemberWeekStats(active, now) : null;
    return {
      userId: m.userId,
      name: displayNameFor(m.user),
      isOwner: m.userId === group.ownerId,
      hasActivePlan: Boolean(active),
      disciplines: active ? buildMemberDisciplineStats(active, now) : [],
      weekPct: week?.weekPct ?? null,
      lastWeekPct: week?.lastWeekPct ?? null,
      streak: week?.streak ?? 0,
    };
  });
  // Two standings across the whole group, ties shared: this week's (live)
  // and the finished week's (final).
  const ranks = rankByPct(stats, (s) => s.weekPct);
  const lastRanks = rankByPct(stats, (s) => s.lastWeekPct);
  return stats.map((s) => ({
    ...s,
    rank: ranks.get(s) ?? null,
    lastRank: lastRanks.get(s) ?? null,
  }));
}

/** Group name + member count for the join-confirmation page (auth required). */
export async function getGroupByToken(
  token: string,
): Promise<{ id: string; name: string; memberCount: number; alreadyMember: boolean } | null> {
  const userId = await requireUserId();
  const group = await prisma.group.findUnique({
    where: { inviteToken: token },
    select: {
      id: true,
      name: true,
      _count: { select: { members: true } },
      members: { where: { userId }, select: { id: true } },
    },
  });
  if (!group) return null;
  return {
    id: group.id,
    name: group.name,
    memberCount: group._count.members,
    alreadyMember: group.members.length > 0,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Create a group owned by the session user, plus the owner's membership. */
export async function createGroup(name: string) {
  const userId = await requireUserId();
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: { name, ownerId: userId, inviteToken: newInviteToken() },
    });
    await tx.groupMembership.create({ data: { groupId: group.id, userId } });
    return group;
  });
}

/** Join a group by its invite token. Idempotent (re-joining is a no-op). */
export async function joinGroupByToken(token: string): Promise<{ id: string; name: string }> {
  const userId = await requireUserId();
  const group = await prisma.group.findUnique({
    where: { inviteToken: token },
    select: { id: true, name: true },
  });
  if (!group) throw new NotFoundError();

  await prisma.groupMembership.upsert({
    where: { groupId_userId: { groupId: group.id, userId } },
    create: { groupId: group.id, userId },
    update: {},
  });
  return group;
}

/** Owner-only: rotate the invite link, invalidating any previously shared link. */
export async function regenerateInviteToken(groupId: string): Promise<string> {
  const userId = await requireUserId();
  await requireOwnedGroup(groupId, userId);
  const token = newInviteToken();
  await prisma.group.update({ where: { id: groupId }, data: { inviteToken: token } });
  return token;
}

/** Owner-only: remove a member (not the owner — the owner deletes the group instead). */
export async function removeMember(groupId: string, targetUserId: string): Promise<void> {
  const userId = await requireUserId();
  const group = await requireOwnedGroup(groupId, userId);
  if (targetUserId === group.ownerId) throw new ForbiddenError();
  await prisma.groupMembership.deleteMany({ where: { groupId, userId: targetUserId } });
}

/** Owner-only: delete the group (cascades all memberships). */
export async function deleteGroup(groupId: string): Promise<void> {
  const userId = await requireUserId();
  await requireOwnedGroup(groupId, userId);
  await prisma.group.delete({ where: { id: groupId } });
}

/** A non-owner leaves a group. The owner must delete the group instead. */
export async function leaveGroup(groupId: string): Promise<void> {
  const userId = await requireUserId();
  const group = await prisma.group.findFirst({
    where: { id: groupId, members: { some: { userId } } },
    select: { ownerId: true },
  });
  if (!group) throw new NotFoundError();
  if (group.ownerId === userId) throw new ForbiddenError();
  await prisma.groupMembership.deleteMany({ where: { groupId, userId } });
}
