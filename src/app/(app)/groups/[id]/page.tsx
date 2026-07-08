import Link from "next/link";
import { notFound } from "next/navigation";

import { getGroup, getGroupMemberStats } from "@/lib/groups";
import { translucent } from "@/lib/ui/theme";

import { InvitePanel, LeaveOrDeleteButton, RemoveMemberButton } from "./group-actions";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let group;
  try {
    group = await getGroup(id);
  } catch (error) {
    // Non-members (and missing groups) get a 404 — no existence leak.
    if (error instanceof Error && error.name === "NotFoundError") notFound();
    throw error;
  }

  const stats = await getGroupMemberStats(id);
  const isMeById = new Map(group.members.map((m) => [m.userId, m.isMe]));

  return (
    <div className="max-w-[880px]">
      <Link href="/groups" className="text-[13px] text-muted hover:text-text">
        ← All groups
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-[26px] font-black tracking-[-0.025em] app:text-[30px]">
          {group.name}
        </h1>
        {group.isOwner && (
          <span className="rounded-[20px] bg-card2 px-[10px] py-1 text-[11px] font-bold text-muted">
            Owner
          </span>
        )}
        <span className="text-[13px] text-faint">
          {stats.length} {stats.length === 1 ? "member" : "members"}
        </span>
      </div>

      {group.isOwner && group.inviteToken && (
        <div className="mb-5">
          <InvitePanel groupId={group.id} token={group.inviteToken} />
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {stats.map((m) => {
          const isMe = isMeById.get(m.userId) ?? false;
          return (
            <div key={m.userId} className="rounded-[14px] border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#15b8e6] to-[#5b6cff] font-display text-[13px] font-bold text-white">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <span className="font-display text-[15px] font-bold">{m.name}</span>
                {m.isOwner && (
                  <span className="rounded-[20px] bg-card2 px-2 py-0.5 text-[10px] font-bold text-muted">
                    Owner
                  </span>
                )}
                {isMe && (
                  <span className="rounded-[20px] px-2 py-0.5 text-[10px] font-bold text-brand">
                    You
                  </span>
                )}
                {group.isOwner && !m.isOwner && (
                  <div className="ml-auto">
                    <RemoveMemberButton groupId={group.id} userId={m.userId} name={m.name} />
                  </div>
                )}
              </div>

              <div className="mt-3">
                {m.hasActivePlan && m.disciplines.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {m.disciplines.map((d) => (
                      <div
                        key={d.key}
                        className="rounded-[11px] px-3 py-2"
                        style={{ background: translucent(d.color, 12) }}
                      >
                        <div
                          className="text-[10px] font-bold tracking-[0.05em] uppercase"
                          style={{ color: d.color }}
                        >
                          {d.label}
                        </div>
                        <div className="font-display text-[18px] leading-none font-extrabold">
                          {d.pct == null ? "—" : `${d.pct}%`}
                        </div>
                        <div className="mt-0.5 text-[10px] text-faint">this week</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-faint">No active plan</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <LeaveOrDeleteButton groupId={group.id} isOwner={group.isOwner} />
      </div>
    </div>
  );
}
