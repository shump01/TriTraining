import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";

import { getGroup, getGroupMemberStats } from "@/lib/groups";
import { translucent } from "@/lib/ui/theme";

import "../groups.css";
import { InvitePanel, LeaveOrDeleteButton, RemoveMemberButton } from "./group-actions";

export const dynamic = "force-dynamic";

/** The accent triad cycles down the member list — the swim/bike/run motif again. */
const ACCENTS = ["var(--swim)", "var(--bike)", "var(--run)"];

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
    <div className="groupspage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap">
        <Link href="/groups" className="backlink">
          ← All groups
        </Link>

        <header className="rise" style={{ animationDelay: "0.05s" }}>
          <span className="eyebrow">
            <span className="dot3">
              <i />
              <i />
              <i />
            </span>
            <span className="mono">
              {stats.length} {stats.length === 1 ? "member" : "members"}
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-3.5">
            <h1 className="gp-title">{group.name}</h1>
            {group.isOwner && <span className="chip">Owner</span>}
          </div>
        </header>

        {group.isOwner && group.inviteToken && (
          <div className="mt-7 rise" style={{ animationDelay: "0.15s" }}>
            <InvitePanel groupId={group.id} token={group.inviteToken} />
          </div>
        )}

        <div className="section-label">This week</div>

        <div className="flex flex-col gap-2.5">
          {stats.map((m, i) => {
            const isMe = isMeById.get(m.userId) ?? false;
            return (
              <div
                key={m.userId}
                className={`card rise${isMe ? " lit" : ""}`}
                style={
                  {
                    "--accent": ACCENTS[i % ACCENTS.length],
                    animationDelay: `${0.2 + i * 0.05}s`,
                  } as CSSProperties
                }
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="avatar">{m.name.charAt(0).toUpperCase()}</div>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{m.name}</span>
                  {m.isOwner && <span className="chip">Owner</span>}
                  {isMe && <span className="chip me">You</span>}
                  {group.isOwner && !m.isOwner && (
                    <div className="ml-auto">
                      <RemoveMemberButton groupId={group.id} userId={m.userId} name={m.name} />
                    </div>
                  )}
                </div>

                <div className="mt-3.5">
                  {m.hasActivePlan && m.disciplines.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {/* d.color resolves var(--swim|--bike|--run) — re-pointed at the
                          marketing accents by .groupspage, so these re-tint for free. */}
                      {m.disciplines.map((d) => (
                        <div
                          key={d.key}
                          className="rounded-[12px] px-3.5 py-2.5"
                          style={{
                            background: translucent(d.color, 12),
                            border: `1px solid ${translucent(d.color, 22)}`,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "var(--font-jetbrains), monospace",
                              fontSize: 10,
                              letterSpacing: "0.14em",
                              textTransform: "uppercase",
                              color: d.color,
                            }}
                          >
                            {d.label}
                          </div>
                          <div
                            style={{
                              fontFamily: "var(--font-anton), sans-serif",
                              fontSize: 24,
                              lineHeight: 1.05,
                              marginTop: 4,
                            }}
                          >
                            {d.pct == null ? "—" : `${d.pct}%`}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mono" style={{ fontSize: 11 }}>
                      No active plan
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <hr className="rule" />
        <div className="mt-5">
          <LeaveOrDeleteButton groupId={group.id} isOwner={group.isOwner} />
        </div>
      </div>
    </div>
  );
}
