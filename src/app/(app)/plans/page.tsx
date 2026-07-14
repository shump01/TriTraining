import Link from "next/link";

import { listTrainingPlansWithProgress } from "@/lib/training-plan";
import { DISCIPLINE_META, STATUS_META, translucent, type StatusKey } from "@/lib/ui/theme";

import { SeasonTimeline, type SeasonPlan } from "./season-timeline";

export const dynamic = "force-dynamic";

function eventLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusKeyOf(p: { summary: { started: boolean; status: StatusKey | null } }): StatusKey {
  return p.summary.started ? (p.summary.status ?? "onTrack") : "upcoming";
}

export default async function PlansPage() {
  const plans = await listTrainingPlansWithProgress();

  const seasonPlans: SeasonPlan[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    startMs: p.startDateMs,
    eventMs: p.eventDate.getTime(),
    priority: p.priority,
    color: STATUS_META[statusKeyOf(p)].color,
  }));

  return (
    <div className="max-w-[980px]">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="m-0 font-display text-[32px] font-black tracking-[-0.025em]">Your plans</h1>
        <Link
          href="/plans/new"
          className="cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14.5px] font-bold text-white hover:brightness-110"
        >
          + New plan
        </Link>
      </div>

      <SeasonTimeline plans={seasonPlans} nowMs={new Date().getTime()} />

      {plans.length === 0 ? (
        <div className="rounded-[16px] border border-border bg-card p-8 text-center">
          <p className="m-0 mb-4 text-[15px] text-muted">No plans yet.</p>
          <Link
            href="/plans/new"
            className="cursor-pointer rounded-[11px] bg-brand px-[18px] py-[11px] font-display text-[14.5px] font-bold text-white hover:brightness-110"
          >
            Create your first plan
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {plans.map((p) => {
            const status = STATUS_META[statusKeyOf(p)];
            const pct = p.summary.pctOfTarget ?? 0;
            return (
              <Link
                key={p.id}
                href={`/plans/${p.id}`}
                className="rounded-[16px] border border-border bg-card p-5 hover:border-brand"
              >
                <div className="mb-3.5 flex items-center justify-between">
                  <span
                    className="rounded-[20px] px-[10px] py-1 text-[11px] font-bold"
                    style={{ color: status.color, background: translucent(status.color, 14) }}
                  >
                    {status.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-[6px] border border-border px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-muted"
                      title={`Priority ${p.priority}`}
                    >
                      {p.priority}
                    </span>
                    <span className="font-mono text-[12.5px] text-faint">
                      {eventLabel(p.eventDate)}
                    </span>
                  </div>
                </div>
                <div className="mb-1 font-display text-[20px] font-extrabold tracking-[-0.02em]">
                  {p.name}
                </div>
                <div className="mb-4 text-[13px] text-muted">
                  {p.disciplines.map((d) => DISCIPLINE_META[d].label).join(" · ")}
                </div>
                <div className="mb-2.5 h-2 overflow-hidden rounded-[6px] bg-card2">
                  <div
                    className="h-full rounded-[6px] bg-brand"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[12.5px] text-muted">
                  <span>{pct}% of target</span>
                  <span>{p.weeksToGo} wks to go</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
