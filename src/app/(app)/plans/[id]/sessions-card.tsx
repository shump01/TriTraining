import { suggestSessions, type SessionDiscipline } from "@/lib/sessions";
import { formatDistance, type DisciplineKey } from "@/lib/ui/theme";

/**
 * This-week suggested workouts for one sport — the weekly volume target split
 * into long / tempo / easy sessions (see suggestSessions).
 */
export function SessionsCard({
  discipline,
  weekMeters,
  color,
}: {
  discipline: SessionDiscipline;
  weekMeters: number;
  color: string;
}) {
  const sessions = suggestSessions(discipline, weekMeters);
  if (sessions.length === 0) return null;

  return (
    <div className="mt-[18px] rounded-[16px] border border-border bg-card p-[22px]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 font-display text-[16px] font-bold">This week&apos;s sessions</h3>
        <span className="font-mono text-[12px] text-faint">suggested split</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {sessions.map((s, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-[11px] border border-border bg-bg2 px-[14px] py-2.5"
          >
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] font-display text-[13px] font-bold text-white"
              style={{ background: color }}
            >
              {i + 1}
            </span>
            <span className="flex-1 text-[14px] font-semibold text-text">{s.label}</span>
            <span className="font-mono text-[13.5px] text-muted">
              {formatDistance(s.meters, discipline as DisciplineKey)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
