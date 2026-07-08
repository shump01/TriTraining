import Link from "next/link";

import { getGroupByToken } from "@/lib/groups";

import { JoinButton } from "./join-button";

export const dynamic = "force-dynamic";

export default async function JoinGroupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await getGroupByToken(token);

  return (
    <div className="mx-auto max-w-[480px] pt-6">
      <div className="rounded-[18px] border border-border bg-card p-6 text-center">
        {!info ? (
          <>
            <div className="font-display text-[20px] font-extrabold">Invite not found</div>
            <p className="mt-2 mb-4 text-[14px] text-muted">
              This invite link is invalid or has been reset.
            </p>
            <Link
              href="/groups"
              className="inline-block rounded-[11px] border border-border px-[18px] py-[11px] text-[14px] font-bold text-text hover:border-brand"
            >
              Go to your groups
            </Link>
          </>
        ) : info.alreadyMember ? (
          <>
            <div className="font-display text-[20px] font-extrabold">{info.name}</div>
            <p className="mt-2 mb-4 text-[14px] text-muted">You&apos;re already a member.</p>
            <Link
              href={`/groups/${info.id}`}
              className="inline-block rounded-[11px] bg-brand px-[18px] py-[11px] text-[14px] font-bold text-white hover:brightness-110"
            >
              Open group
            </Link>
          </>
        ) : (
          <>
            <div className="mb-1 font-mono text-[11px] tracking-[0.14em] text-brand uppercase">
              You&apos;re invited to join
            </div>
            <div className="font-display text-[24px] font-black tracking-[-0.02em]">
              {info.name}
            </div>
            <p className="mt-2 mb-5 text-[13.5px] text-muted">
              {info.memberCount} {info.memberCount === 1 ? "member" : "members"} · they&apos;ll be
              able to see your weekly progress per sport.
            </p>
            <JoinButton token={token} />
          </>
        )}
      </div>
    </div>
  );
}
