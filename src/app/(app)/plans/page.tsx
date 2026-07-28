import Link from "next/link";

import { SeasonTimeline, toSeasonPlans } from "@/components/season-timeline";
import { listTrainingPlansWithProgress } from "@/lib/training-plan";
import { DISCIPLINE_META, STATUS_META, planStatusKey, translucent } from "@/lib/ui/theme";

import { PlanCardPct } from "./plan-card-pct";

import "../surface.css";

export const dynamic = "force-dynamic";

function eventLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function PlansPage() {
  const plans = await listTrainingPlansWithProgress();
  const seasonPlans = toSeasonPlans(plans);

  return (
    <div className="mkpage">
      <div className="glows" />
      <div className="grain" />

      <div className="wrap max-w-[980px]">
        <div
          className="rise mb-7 flex flex-wrap items-end justify-between gap-4"
          style={{ animationDelay: "0.05s" }}
        >
          <div>
            <span className="eyebrow">
              <span className="pulse" />
              <span className="mono">
                {seasonPlans.length} {seasonPlans.length === 1 ? "plan" : "plans"}
              </span>
            </span>
            <h1 className="mk-h1">
              Your
              <br />
              <em>season.</em>
            </h1>
          </div>
          <Link href="/plans/new" className="btn">
            <span>+ New plan</span>
          </Link>
        </div>

        <div className="rise" style={{ animationDelay: "0.15s" }}>
          <SeasonTimeline plans={seasonPlans} nowMs={new Date().getTime()} />
        </div>

        {plans.length === 0 ? (
          <div className="rise rounded-[16px] border border-border bg-card p-8 text-center">
            <p className="lede mx-auto mb-5">
              No plans yet. Pick a race, and we&apos;ll build the weeks up to it.
            </p>
            <Link href="/plans/new" className="btn">
              <span>Create your first plan</span>
            </Link>
          </div>
        ) : (
          <div
            className="rise grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4"
            style={{ animationDelay: "0.22s" }}
          >
            {plans.map((p) => {
              const status = STATUS_META[planStatusKey(p.summary)];
              const pct = p.summary.pctOfTarget;
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
                      <span className="chip" title={`Priority ${p.priority}`}>
                        {p.priority}
                      </span>
                      <span className="font-mono text-[12.5px] text-faint">
                        {eventLabel(p.eventDate)}
                      </span>
                    </div>
                  </div>
                  <div className="mk-title mb-1.5 text-[20px]">{p.name}</div>
                  <div className="mb-4 text-[13px] text-muted">
                    {p.disciplines.map((d) => DISCIPLINE_META[d].label).join(" · ")}
                  </div>
                  <PlanCardPct pct={pct} pctBalanced={p.pctBalanced} weeksToGo={p.weeksToGo} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
