import Link from "next/link";

import { listMyGroups } from "@/lib/groups";

import { CreateGroupForm } from "./create-group-form";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const groups = await listMyGroups();

  return (
    <div className="max-w-[980px]">
      <div className="mb-1.5">
        <h1 className="m-0 font-display text-[28px] font-black tracking-[-0.025em] app:text-[32px]">
          Groups
        </h1>
      </div>
      <p className="m-0 mb-5 text-[14px] text-muted">
        Train together — share a link and see each other&apos;s weekly progress.
      </p>

      <CreateGroupForm />

      {groups.length === 0 ? (
        <div className="mt-4 rounded-[16px] border border-border bg-card p-8 text-center text-[14px] text-muted">
          You&apos;re not in any groups yet. Create one above, or open an invite link a friend
          shared with you.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              className="rounded-[16px] border border-border bg-card p-5 hover:border-brand"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-display text-[18px] font-extrabold tracking-[-0.02em]">
                  {g.name}
                </span>
                {g.isOwner && (
                  <span className="rounded-[20px] bg-card2 px-[9px] py-1 text-[10.5px] font-bold text-muted">
                    Owner
                  </span>
                )}
              </div>
              <div className="text-[13px] text-muted">
                {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
