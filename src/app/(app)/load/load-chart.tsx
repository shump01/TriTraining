import type { LoadPoint } from "@/lib/training-load";

const FONT_MONO = "var(--font-jetbrains)";

/**
 * The Performance Management Chart: Fitness (CTL, filled), Fatigue (ATL), and
 * Form (TSB, can go negative). Bespoke SVG; colors come from the app theme.
 */
export function LoadChart({ series }: { series: LoadPoint[] }) {
  const W = 880;
  const H = 300;
  const padL = 44;
  const padR = 14;
  const padT = 18;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;
  if (n < 2) return null;

  const ctls = series.map((p) => p.ctl);
  const atls = series.map((p) => p.atl);
  const tsbs = series.map((p) => p.tsb);

  const maxY = Math.max(...ctls, ...atls, 1) * 1.12;
  const minY = Math.min(0, ...tsbs) * 1.15;
  const range = maxY - minY || 1;
  const x = (i: number) => padL + (innerW * i) / (n - 1);
  const y = (v: number) => padT + innerH - ((v - minY) / range) * innerH;

  const path = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const baseY = y(Math.max(minY, 0));
  const ctlArea = `${path(ctls)} L ${x(n - 1).toFixed(1)} ${baseY.toFixed(1)} L ${padL} ${baseY.toFixed(1)} Z`;

  const ticks = 4;
  const gridVals = Array.from({ length: ticks + 1 }, (_, i) => minY + (range * i) / ticks);
  // dateMs values are UTC midnights — pin the zone so a server west of UTC
  // doesn't shift every label a day early.
  const dateStr = (ms: number) =>
    new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {gridVals.map((gv, i) => {
        const gy = y(gv);
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={gy}
              y2={gy}
              strokeWidth={1}
              style={{ stroke: "var(--grid)" }}
            />
            <text
              x={padL - 7}
              y={gy + 4}
              textAnchor="end"
              fontSize={10.5}
              fontFamily={FONT_MONO}
              style={{ fill: "var(--faint)" }}
            >
              {Math.round(gv)}
            </text>
          </g>
        );
      })}

      {/* Zero reference for Form. */}
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

      {/* Fitness (CTL) — filled area + line. */}
      <path d={ctlArea} style={{ fill: "var(--on-track)", opacity: 0.12 }} />
      {/* Form (TSB). */}
      <path d={path(tsbs)} fill="none" strokeWidth={2} style={{ stroke: "var(--bike)" }} />
      {/* Fatigue (ATL). */}
      <path
        d={path(atls)}
        fill="none"
        strokeWidth={2}
        strokeDasharray="5 4"
        style={{ stroke: "var(--behind)" }}
      />
      {/* Fitness (CTL) line on top. */}
      <path
        d={path(ctls)}
        fill="none"
        strokeWidth={2.5}
        strokeLinejoin="round"
        style={{ stroke: "var(--on-track)" }}
      />
      <circle cx={x(n - 1)} cy={y(ctls[n - 1]!)} r={3.5} style={{ fill: "var(--on-track)" }} />

      {series.map((p, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
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
