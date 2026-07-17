import Link from "next/link";

import { STATUS_META, planStatusKey, type StatusKey } from "@/lib/ui/theme";

/**
 * A compact season Gantt: every plan as a bar on a shared time axis, from its
 * start to its event date. Bar color follows the plan's status; height/opacity
 * encode its priority (A goal race → tallest, C tune-up → slightest). Purely
 * presentational — rendered by the server plans page and the dashboard.
 */
export interface SeasonPlan {
  id: string;
  name: string;
  startMs: number;
  eventMs: number;
  priority: string;
  /** Status color (CSS var string). */
  color: string;
}

/** Shape plans-with-progress into timeline bars. Structural, so any caller fits. */
export function toSeasonPlans(
  plans: {
    id: string;
    name: string;
    startDateMs: number;
    eventDate: Date;
    priority: string;
    summary: { started: boolean; status: StatusKey | null };
  }[],
): SeasonPlan[] {
  return plans.map((p) => ({
    id: p.id,
    name: p.name,
    startMs: p.startDateMs,
    eventMs: p.eventDate.getTime(),
    priority: p.priority,
    color: STATUS_META[planStatusKey(p.summary)].color,
  }));
}

const DEFAULT_STYLE = { height: 11, opacity: 0.62 };
const PRIORITY_STYLE: Record<string, { height: number; opacity: number }> = {
  A: { height: 22, opacity: 1 },
  B: { height: 16, opacity: 0.82 },
  C: DEFAULT_STYLE,
};

const ROW_H = 30;

function monthTicks(startMs: number, endMs: number): { ms: number; label: string }[] {
  const ticks: { ms: number; label: string }[] = [];
  const d = new Date(startMs);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1); // first of the next month
  while (d.getTime() < endMs && ticks.length < 36) {
    ticks.push({ ms: d.getTime(), label: d.toLocaleDateString("en-US", { month: "short" }) });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return ticks;
}

export function SeasonTimeline({ plans, nowMs }: { plans: SeasonPlan[]; nowMs: number }) {
  // A "season" needs at least two events to be worth plotting.
  if (plans.length < 2) return null;

  const minMs = Math.min(nowMs, ...plans.map((p) => p.startMs));
  const maxMs = Math.max(nowMs, ...plans.map((p) => p.eventMs));
  const range = Math.max(maxMs - minMs, 1);
  const pct = (ms: number) => ((ms - minMs) / range) * 100;

  return (
    <div className="mb-8 rounded-[16px] border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="m-0 font-display text-[15px] font-bold text-muted">Season</h2>
        <div className="flex gap-3 font-mono text-[10.5px] text-faint">
          <span>A goal</span>
          <span>B secondary</span>
          <span>C tune-up</span>
        </div>
      </div>
      <div className="relative" style={{ height: plans.length * ROW_H + 20 }}>
        {monthTicks(minMs, maxMs).map((t) => (
          <div
            key={t.ms}
            className="absolute top-0 bottom-[16px] border-l border-border"
            style={{ left: `${pct(t.ms)}%` }}
          >
            <span className="absolute -bottom-[15px] -translate-x-1/2 font-mono text-[10px] text-faint">
              {t.label}
            </span>
          </div>
        ))}

        {/* Today marker. */}
        <div
          className="absolute top-0 bottom-[16px] border-l-2 border-brand"
          style={{ left: `${pct(nowMs)}%` }}
          title="Today"
        />

        {plans.map((p, i) => {
          const left = pct(p.startMs);
          const width = Math.max(pct(p.eventMs) - left, 1.5);
          const style = PRIORITY_STYLE[p.priority] ?? DEFAULT_STYLE;
          return (
            <Link
              key={p.id}
              href={`/plans/${p.id}`}
              title={`${p.name} — ${p.priority} race`}
              className="absolute flex items-center overflow-hidden rounded-[6px] px-2 text-[11px] font-bold text-white hover:brightness-110"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                top: i * ROW_H,
                height: style.height,
                background: p.color,
                opacity: style.opacity,
              }}
            >
              <span className="truncate">
                {p.priority} · {p.name}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
