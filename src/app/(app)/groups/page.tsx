import Link from "next/link";
import type { CSSProperties } from "react";

import { listMyGroups } from "@/lib/groups";

import { CreateGroupForm } from "./create-group-form";
import "./groups.css";

export const dynamic = "force-dynamic";

/** The accent triad cycles across cards — the same swim/bike/run motif as the dots. */
const ACCENTS = ["var(--swim)", "var(--bike)", "var(--run)"];

export default async function GroupsPage() {
  const groups = await listMyGroups();

  return (
    <div className="groupspage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap">
        <header className="rise" style={{ animationDelay: "0.05s" }}>
          <span className="eyebrow">
            <span className="pulse" />
            <span className="mono">Train together</span>
          </span>
          <h1 className="gp-h1">
            Nobody trains
            <br />
            <em>alone.</em>
          </h1>
          <p className="lede">
            Share one link and the people you train with see how each other&apos;s week is landing —{" "}
            <b>swim, bike and run</b>, side by side.
          </p>
        </header>

        <div className="mt-9 rise" style={{ animationDelay: "0.15s" }}>
          <CreateGroupForm />
        </div>

        {groups.length === 0 ? (
          <div
            className="card mt-4 rise"
            style={{ animationDelay: "0.25s", textAlign: "center", padding: "44px 24px" }}
          >
            <span className="dot3" style={{ marginBottom: 14 }}>
              <i />
              <i />
              <i />
            </span>
            <p className="lede" style={{ margin: "0 auto", maxWidth: "38ch" }}>
              No groups yet. Start one above, or open an invite link a training partner sent you.
            </p>
          </div>
        ) : (
          <>
            <div className="section-label">
              {groups.length} {groups.length === 1 ? "group" : "groups"}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
              {groups.map((g, i) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="card rise"
                  style={
                    {
                      "--accent": ACCENTS[i % ACCENTS.length],
                      animationDelay: `${0.25 + i * 0.06}s`,
                    } as CSSProperties
                  }
                >
                  <div className="mb-3.5 flex items-start justify-between gap-3">
                    <span className="card-name">{g.name}</span>
                    {g.isOwner && <span className="chip">Owner</span>}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: ACCENTS[i % ACCENTS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em" }}>
                      {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
