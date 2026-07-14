import type { PlanReadiness, ReadinessStatus, SeriesReadiness } from "@/lib/readiness";
import {
  DISCIPLINE_META,
  STATUS_META,
  TOTAL_META,
  formatDistance,
  translucent,
  type DisciplineKey,
  type StatusKey,
} from "@/lib/ui/theme";

// Readiness statuses reuse the plan's status colors (atRisk → the "behind" red).
const STATUS_KEY: Record<ReadinessStatus, StatusKey> = {
  ahead: "ahead",
  onTrack: "onTrack",
  atRisk: "behind",
  insufficient: "upcoming",
};

const STATUS_LABEL: Record<ReadinessStatus, string> = {
  ahead: "Ahead of plan",
  onTrack: "On track",
  atRisk: "At risk",
  insufficient: "Not enough data",
};

function seriesColor(key: SeriesReadiness["key"]): string {
  return key === "TOTAL" ? TOTAL_META.color : DISCIPLINE_META[key as DisciplineKey].color;
}

function headline(o: SeriesReadiness): string {
  if (o.status === "insufficient") {
    return "Log a couple of weeks of training to see your race-day projection.";
  }
  if (o.basis === "projection") {
    const when = o.weeksToPeak ? ` in ${o.weeksToPeak} week${o.weeksToPeak === 1 ? "" : "s"}` : "";
    return `Projected to reach ${o.pct}% of your peak build${when}.`;
  }
  return `You've hit ${o.pct}% of your planned volume so far.`;
}

/**
 * "Am I on track?" — projects the current trajectory to the peak week and, when
 * a discipline is trending short, surfaces a concrete weekly correction.
 */
export function ReadinessPanel({ readiness }: { readiness: PlanReadiness }) {
  const overall = readiness.overall;
  if (!overall) return null;

  const meta = STATUS_META[STATUS_KEY[overall.status]];
  const showDisciplines = overall.key === "TOTAL" && readiness.disciplines.length > 0;

  // The single most useful correction: the at-risk discipline with the biggest gap.
  const topRec = (readiness.disciplines.length ? readiness.disciplines : [overall])
    .filter((d) => d.status === "atRisk" && d.recommendedPerWeekMeters != null)
    .sort((a, b) => (b.recommendedPerWeekMeters ?? 0) - (a.recommendedPerWeekMeters ?? 0))[0];

  return (
    <div className="mb-5 max-w-[1100px] rounded-[18px] border border-border bg-card p-[22px]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="m-0 font-display text-[16px] font-bold">Race readiness</h3>
        <span
          className="rounded-[20px] px-[10px] py-1 text-[12px] font-bold"
          style={{ color: meta.color, background: translucent(meta.color, 14) }}
        >
          {STATUS_LABEL[overall.status]}
        </span>
      </div>
      <p className="m-0 text-[14px] leading-[1.5] text-muted">{headline(overall)}</p>

      {showDisciplines && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {readiness.disciplines.map((d) => {
            const color = seriesColor(d.key);
            const dot = STATUS_META[STATUS_KEY[d.status]];
            return (
              <div
                key={d.key}
                className="flex items-center gap-2 rounded-[10px] border border-border bg-bg2 px-3 py-2"
                title={STATUS_LABEL[d.status]}
              >
                <span className="text-[13px] font-bold" style={{ color }}>
                  {d.label}
                </span>
                <span className="font-mono text-[12.5px] text-muted">
                  {d.status === "insufficient" ? "—" : `${d.pct}%`}
                </span>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot.color }} />
              </div>
            );
          })}
        </div>
      )}

      {topRec?.recommendedPerWeekMeters != null && (
        <p
          className="mt-3.5 mb-0 rounded-[11px] border px-3.5 py-2.5 text-[13px] font-semibold"
          style={{
            color: STATUS_META.behind.color,
            background: translucent(STATUS_META.behind.color, 10),
            borderColor: translucent(STATUS_META.behind.color, 24),
          }}
        >
          Add ~{formatDistance(topRec.recommendedPerWeekMeters, topRec.key)}/week to{" "}
          {topRec.label.toLowerCase()} to stay on track for your peak.
        </p>
      )}
    </div>
  );
}
