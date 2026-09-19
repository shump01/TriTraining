import Link from "next/link";

import type { PlanWithProgress } from "@/lib/training-plan";
import { STATUS_META, planStatusKey } from "@/lib/ui/theme";

import { RaceCountdownLabel } from "./race-countdown";

function eventLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The athlete's other live plans, listed beside the featured one so a multi-race
 * season isn't invisible from the dashboard. Deliberately status + timing only —
 * the hero card's percentages are *current-week*, and a plan-to-date % here would
 * read as the same measure. Renders nothing for a single-plan athlete.
 */
export function OtherPlans({ plans }: { plans: PlanWithProgress[] }) {
  if (plans.length === 0) return null;

  return (
    <div className="mt-[18px]">
      <h2 className="mb-2.5 font-display text-[13px] font-bold text-muted">Also training for</h2>
      <div className="-mx-[14px] flex gap-2.5 overflow-x-auto px-[14px] [scrollbar-width:none] app:mx-0 app:flex-wrap app:px-0">
        {plans.map((p) => {
          const status = STATUS_META[planStatusKey(p.summary)];
          return (
            <Link
              key={p.id}
              href={`/plans/${p.id}`}
              className="w-[210px] shrink-0 rounded-[12px] border border-border bg-card px-3.5 py-3 hover:border-brand"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className="shrink-0 rounded-[6px] border border-border px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted"
                  title={`Priority ${p.priority}`}
                >
                  {p.priority}
                </span>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: status.color }}
                  title={status.label}
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{p.name}</span>
              </div>
              <div className="font-mono text-[11.5px] text-faint">
                <RaceCountdownLabel eventDate={p.eventDate.toISOString()} weeksToGo={p.weeksToGo} />{" "}
                · {eventLabel(p.eventDate)}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
