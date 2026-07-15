import type { Heatmap, HeatmapCell } from "@/lib/heatmap";
import { STATUS_META, translucent, type StatusKey } from "@/lib/ui/theme";

function cellStyle(cell: HeatmapCell): React.CSSProperties {
  if (cell.phase === "future") {
    return { background: "var(--card2)", border: "1px solid var(--border)" };
  }
  const key: StatusKey = cell.status ?? "behind";
  const color = STATUS_META[key].color;
  const current = cell.phase === "current";
  return {
    background: translucent(color, current ? 28 : 72),
    border: current ? `1.5px solid ${color}` : "1px solid transparent",
  };
}

/**
 * A contribution-grid of weekly adherence — one cell per week, colored by
 * status — plus the current and best streaks. Purely derived from the plan's
 * per-week progress (see buildHeatmap).
 */
export function ConsistencyCard({ heatmap }: { heatmap: Heatmap }) {
  if (heatmap.cells.length === 0 || heatmap.weeksCompleted === 0) return null;

  return (
    <div className="mb-5 max-w-[1100px] rounded-[18px] border border-border bg-card p-[22px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 font-display text-[16px] font-bold">Consistency</h3>
        {heatmap.currentStreak > 0 && (
          <span
            className="rounded-[20px] px-[10px] py-1 text-[12px] font-bold"
            style={{
              color: STATUS_META.onTrack.color,
              background: translucent(STATUS_META.onTrack.color, 14),
            }}
          >
            🔥 {heatmap.currentStreak}-week streak
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-[5px]">
        {heatmap.cells.map((c, i) => (
          <div
            key={c.ms}
            title={`Week ${i + 1}${c.pctOfTarget != null ? ` · ${c.pctOfTarget}% of target` : ""}`}
            className="h-[18px] w-[18px] rounded-[4px]"
            style={cellStyle(c)}
          />
        ))}
      </div>
      <div className="mt-3 text-[12.5px] text-muted">
        {heatmap.weeksHit} of {heatmap.weeksCompleted} weeks on target
        {heatmap.bestStreak > 0 ? ` · best streak ${heatmap.bestStreak}` : ""}
      </div>
    </div>
  );
}
