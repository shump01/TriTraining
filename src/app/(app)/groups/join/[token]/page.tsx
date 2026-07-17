import Link from "next/link";
import type { CSSProperties } from "react";

import { getGroupByToken } from "@/lib/groups";

import "../../groups.css";
import { JoinButton } from "./join-button";

export const dynamic = "force-dynamic";

export default async function JoinGroupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await getGroupByToken(token);

  return (
    <div className="groupspage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap" style={{ maxWidth: 560, margin: "0 auto" }}>
        <div
          className="card lit rise"
          style={
            {
              "--accent": "var(--swim)",
              animationDelay: "0.05s",
              textAlign: "center",
              padding: "44px 28px",
            } as CSSProperties
          }
        >
          <span className="dot3" style={{ marginBottom: 20 }}>
            <i />
            <i />
            <i />
          </span>

          {!info ? (
            <>
              <h1 className="gp-title" style={{ fontSize: "clamp(1.8rem, 5vw, 2.4rem)" }}>
                Invite not found
              </h1>
              <p className="lede" style={{ margin: "14px auto 26px", maxWidth: "32ch" }}>
                This link is invalid, or it&apos;s been reset by the group owner.
              </p>
              <Link href="/groups" className="btn ghost">
                <span>Go to your groups</span>
              </Link>
            </>
          ) : info.alreadyMember ? (
            <>
              <div className="mono" style={{ marginBottom: 12 }}>
                Already in
              </div>
              <h1 className="gp-title" style={{ fontSize: "clamp(1.8rem, 5vw, 2.6rem)" }}>
                {info.name}
              </h1>
              <p className="lede" style={{ margin: "14px auto 26px", maxWidth: "32ch" }}>
                You&apos;re already a member of this group.
              </p>
              <Link href={`/groups/${info.id}`} className="btn">
                <span>Open group</span>
              </Link>
            </>
          ) : (
            <>
              <div className="mono" style={{ marginBottom: 12 }}>
                You&apos;re invited to join
              </div>
              <h1 className="gp-title" style={{ fontSize: "clamp(1.9rem, 5.5vw, 2.8rem)" }}>
                {info.name}
              </h1>
              <p className="lede" style={{ margin: "14px auto 26px", maxWidth: "36ch" }}>
                {info.memberCount} {info.memberCount === 1 ? "member" : "members"}. Joining lets
                them see your <b>weekly progress per sport</b> — nothing more.
              </p>
              <JoinButton token={token} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
