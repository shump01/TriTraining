import type { LoadPoint } from "@/lib/training-load";

const FONT_MONO = "var(--font-jetbrains)";

/**
 * The race forecast chart: recent real Fitness/Form (solid) continuing into
 * the projection (dashed) through race day. Same bespoke-SVG language as
 * [LoadChart](src/app/(app)/load/load-chart.tsx); Fatigue is omitted — the
 * story here is the taper's Form upswing against the Fitness it spends.
 */
export function ForecastChart({
  past,
  projection,
}: {
  /** Recent real points, ending today (the projection's anchor). */
  past: LoadPoint[];
  /** Projected points, strictly after today, ending on race day. */
  projection: LoadPoint[];
}) {
  const W = 880;
  const H = 280;
  const padL = 44;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const all = [...past, ...projection];
  const n = all.length;
  if (past.length < 1 || projection.length < 1 || n < 3) return null;

  const ctls = all.map((p) => p.ctl);
  const tsbs = all.map((p) => p.tsb);
  const maxY = Math.max(...ctls, 1) * 1.12;
  const minY = Math.min(0, ...tsbs) * 1.15;
  const range = maxY - minY || 1;
  const x = (i: number) => padL + (innerW * i) / (n - 1);
  const y = (v: number) => padT + innerH - ((v - minY) / range) * innerH;

  // Both projected paths start from the last REAL point so the lines connect.
  const splitAt = past.length - 1;
  const path = (vals: number[], from: number, to: number) =>
    vals
      .slice(from, to + 1)
      .map((v, i) => `${i ? "L" : "M"}${x(from + i).toFixed(1)} ${y(v).toFixed(1)}`)
      .join(" ");

  const todayX = x(splitAt);
  const raceX = x(n - 1);
  const race = all[n - 1]!;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => minY + (range * i) / ticks);
  // dateMs values are UTC midnights; without an explicit zone a server west of
  // UTC would label the athlete's known race date as the day before.
  const dateStr = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  // Keep "today" out of "race day"'s way when the race is only days off.
  const showTodayLabel = raceX - todayX >= 60;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {gridVals.map((gv, i) => (
        <g key={i}>
          <line
            x1={padL}
            x2={W - padR}
            y1={y(gv)}
            y2={y(gv)}
            strokeWidth={1}
            style={{ stroke: "var(--grid)" }}
          />
          <text
            x={padL - 7}
            y={y(gv) + 4}
            textAnchor="end"
            fontSize={10.5}
            fontFamily={FONT_MONO}
            style={{ fill: "var(--faint)" }}
          >
            {Math.round(gv)}
          </text>
        </g>
      ))}

      {minY < 0 && (
        <line
          x1={padL}
          x2={W - padR}
          y1={y(0)}
          y2={y(0)}
          strokeWidth={1}
          strokeDasharray="3 3"
          style={{ stroke: "var(--faint)", opacity: 0.55 }}
        />
      )}

      {/* Today divider — everything right of this line is the projection. */}
      <line
        x1={todayX}
        x2={todayX}
        y1={padT}
        y2={padT + innerH}
        strokeWidth={1}
        strokeDasharray="4 4"
        style={{ stroke: "var(--faint)", opacity: 0.7 }}
      />
      {showTodayLabel && (
        <text
          x={todayX}
          y={padT - 5}
          textAnchor="middle"
          fontSize={10}
          fontFamily={FONT_MONO}
          style={{ fill: "var(--faint)" }}
        >
          today
        </text>
      )}

      {/* Form (TSB): real then projected. */}
      <path
        d={path(tsbs, 0, splitAt)}
        fill="none"
        strokeWidth={2}
        style={{ stroke: "var(--bike)" }}
      />
      <path
        d={path(tsbs, splitAt, n - 1)}
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 4"
        style={{ stroke: "var(--bike)" }}
      />

      {/* Fitness (CTL): real then projected. */}
      <path
        d={path(ctls, 0, splitAt)}
        fill="none"
        strokeWidth={2.5}
        strokeLinejoin="round"
        style={{ stroke: "var(--on-track)" }}
      />
      <path
        d={path(ctls, splitAt, n - 1)}
        fill="none"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeDasharray="5 4"
        style={{ stroke: "var(--on-track)" }}
      />

      {/* Race day. */}
      <circle cx={raceX} cy={y(race.ctl)} r={4} style={{ fill: "var(--on-track)" }} />
      <circle cx={raceX} cy={y(race.tsb)} r={4} style={{ fill: "var(--bike)" }} />
      <text
        x={raceX - 4}
        y={padT - 5}
        textAnchor="end"
        fontSize={10}
        fontFamily={FONT_MONO}
        style={{ fill: "var(--text)", fontWeight: 700 }}
      >
        race day
      </text>

      {all.map((p, i) =>
        // The final (race-day) label always renders; a periodic label too close
        // to it is dropped so the two never collide.
        (i % labelEvery === 0 && n - 1 - i >= Math.ceil(labelEvery / 2)) || i === n - 1 ? (
          <text
            key={i}
            x={x(i)}
            y={H - 9}
            textAnchor="middle"
            fontSize={10}
            fontFamily={FONT_MONO}
            style={{ fill: "var(--faint)" }}
          >
            {dateStr(p.dateMs)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
