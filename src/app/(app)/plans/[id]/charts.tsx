"use client";

import { linearTrend, trendAt } from "@/lib/trend";

/**
 * Bespoke SVG charts ported from the design handoff (replacing recharts).
 * Colors are passed as CSS-variable strings (e.g. "var(--swim)") and applied
 * via `style` so they resolve against the active theme — SVG presentation
 * attributes do not evaluate var().
 */

export interface WeekDatum {
  weekStartMs: number;
  target: number;
  actual: number | null;
  /** Week marked as time off — excluded from the trend fit (see fitPoints). */
  paused?: boolean;
}

const FONT_MONO = "var(--font-jetbrains)";

export function VolumeChart({
  rows,
  currentIndex,
  color,
  unit,
  startVol,
  labelOf,
}: {
  rows: WeekDatum[];
  currentIndex: number;
  color: string;
  unit: "m" | "km";
  startVol: number | null;
  labelOf: (ms: number) => string;
}) {
  const W = 860;
  const H = 280;
  const padL = 58;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = rows.length;
  const hasCurrent = currentIndex >= 0 && currentIndex < n;

  const vals: number[] = [];
  for (const r of rows) {
    vals.push(r.target);
    if (r.actual != null) vals.push(r.actual);
  }
  const maxY = Math.max(...vals, 1) * 1.18;
  const slot = innerW / Math.max(n, 1);
  const cx = (i: number) => padL + slot * (i + 0.5);
  const y = (v: number) => padT + innerH - (v / maxY) * innerH;
  // Keep any drawn point inside the plot area (a steep projection shouldn't
  // rescale the axis or spill outside the chart).
  const clampY = (py: number) => Math.max(padT, Math.min(padT + innerH, py));
  const fmtY = (gv: number) =>
    unit === "m" ? Math.round(gv).toLocaleString() : Math.round(gv / 1000).toLocaleString();
  const bw = Math.min(slot * 0.5, 26);
  const targetPath = rows.map((r, i) => `${i ? "L" : "M"}${cx(i)} ${y(r.target)}`).join(" ");

  // Trend line: least-squares fit over COMPLETED weeks' actuals (the in-progress
  // current week is partial, so it's excluded to avoid biasing the slope), then
  // projected across the remaining weeks to race day. Paused weeks are excluded
  // too, matching readiness (readiness.ts does the same) — otherwise two ill
  // weeks fit as zeros and the dashed line sags under a plan the readiness
  // panel on the same screen calls on track.
  const fitPoints: { x: number; y: number }[] = [];
  rows.forEach((r, i) => {
    const completed = hasCurrent ? i < currentIndex : true;
    if (r.actual != null && completed && !r.paused) fitPoints.push({ x: i, y: r.actual });
  });
  const trend = linearTrend(fitPoints);
  const trendFrom = fitPoints[0]?.x ?? 0;
  const trendTo = n - 1;
  const trendY = (i: number) => clampY(y(Math.max(0, trend ? trendAt(trend, i) : 0)));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {[0, 1, 2, 3, 4].map((t) => {
        const gv = (maxY * t) / 4;
        const gy = padT + innerH - (t / 4) * innerH;
        return (
          <g key={t}>
            <line
              x1={padL}
              x2={W - padR}
              y1={gy}
              y2={gy}
              strokeWidth={1}
              style={{ stroke: "var(--grid)" }}
            />
            <text
              x={padL - 8}
              y={gy + 4}
              textAnchor="end"
              fontSize={11}
              fontFamily={FONT_MONO}
              style={{ fill: "var(--faint)" }}
            >
              {fmtY(gv)}
            </text>
          </g>
        );
      })}
      <text
        x={padL - 8}
        y={padT - 7}
        textAnchor="end"
        fontSize={10}
        fontFamily={FONT_MONO}
        style={{ fill: "var(--faint)" }}
      >
        {unit}
      </text>

      {startVol != null && startVol < maxY && (
        <line
          x1={padL}
          x2={W - padR}
          y1={y(startVol)}
          y2={y(startVol)}
          strokeWidth={1}
          strokeDasharray="2 5"
          style={{ stroke: color, opacity: 0.5 }}
        />
      )}

      {hasCurrent && (
        <rect
          x={cx(currentIndex) - slot / 2}
          y={padT}
          width={slot}
          height={innerH}
          style={{ fill: color, opacity: 0.07 }}
        />
      )}

      {rows.map((r, i) =>
        r.actual == null ? null : (
          <rect
            key={i}
            x={cx(i) - bw / 2}
            y={y(r.actual)}
            width={bw}
            height={Math.max(padT + innerH - y(r.actual), 1)}
            rx={3}
            style={{
              fill: i === currentIndex ? color : `color-mix(in srgb, ${color} 58%, transparent)`,
            }}
          />
        ),
      )}

      <path
        d={targetPath}
        fill="none"
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ stroke: color }}
      />
      {rows.map((r, i) => (
        <circle
          key={i}
          cx={cx(i)}
          cy={y(r.target)}
          r={i === currentIndex ? 4 : 2.5}
          strokeWidth={2}
          style={{ fill: "var(--card)", stroke: color }}
        />
      ))}

      {trend && trendTo > trendFrom && (
        <g>
          <line
            x1={cx(trendFrom)}
            y1={trendY(trendFrom)}
            x2={cx(trendTo)}
            y2={trendY(trendTo)}
            strokeWidth={2}
            strokeDasharray="7 5"
            strokeLinecap="round"
            style={{ stroke: color, opacity: 0.85 }}
          />
          <circle cx={cx(trendTo)} cy={trendY(trendTo)} r={3} style={{ fill: color }} />
          <text
            x={cx(trendTo)}
            y={trendY(trendTo) - 8}
            textAnchor="end"
            fontSize={10}
            fontWeight={700}
            fontFamily={FONT_MONO}
            style={{ fill: color, opacity: 0.9 }}
          >
            trend
          </text>
        </g>
      )}

      {rows.map((r, i) =>
        i % 3 !== 0 && i !== n - 1 ? null : (
          <text
            key={i}
            x={cx(i)}
            y={H - 12}
            textAnchor="middle"
            fontSize={10.5}
            fontFamily={FONT_MONO}
            style={{ fill: "var(--faint)" }}
          >
            {labelOf(r.weekStartMs)}
          </text>
        ),
      )}

      {hasCurrent && (
        <text
          x={cx(currentIndex)}
          y={padT - 7}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          style={{ fill: color }}
        >
          now
        </text>
      )}
    </svg>
  );
}

export function ProgressRing({
  pct,
  color,
  size,
}: {
  /** Null renders an empty ring with a "—" label (no percentage to show). */
  pct: number | null;
  color: string;
  size: number;
}) {
  const r = (size - 16) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(pct ?? 0, 100));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={c} cy={c} r={r} fill="none" strokeWidth={9} style={{ stroke: "var(--border)" }} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - p / 100)}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ stroke: color }}
      />
      <text
        x={c}
        y={c - 1}
        textAnchor="middle"
        fontSize={size * 0.25}
        fontWeight={800}
        fontFamily="var(--font-archivo)"
        style={{ fill: "var(--text)" }}
      >
        {pct == null ? "—" : `${pct}%`}
      </text>
      <text
        x={c}
        y={c + size * 0.17}
        textAnchor="middle"
        fontSize={size * 0.1}
        fontFamily="var(--font-hanken)"
        style={{ fill: "var(--muted)" }}
      >
        of target
      </text>
    </svg>
  );
}

export function Sparkline({
  rows,
  color,
  currentIndex,
}: {
  rows: WeekDatum[];
  color: string;
  currentIndex: number;
}) {
  const W = 200;
  const H = 34;
  const n = rows.length;
  const vals: number[] = [];
  for (const r of rows) {
    vals.push(r.target);
    if (r.actual != null) vals.push(r.actual);
  }
  const maxY = Math.max(...vals, 1) * 1.1;
  const cx = (i: number) => 2 + ((W - 4) * i) / (n - 1 || 1);
  const y = (v: number) => H - 2 - (v / maxY) * (H - 4);
  const targetPath = rows.map((r, i) => `${i ? "L" : "M"}${cx(i)} ${y(r.target)}`).join(" ");

  let actualPath = "";
  let started = false;
  rows.forEach((r, i) => {
    if (r.actual == null) return;
    actualPath += `${started ? "L" : "M"}${cx(i)} ${y(r.actual)} `;
    started = true;
  });

  const ci = currentIndex >= 0 && currentIndex < n ? currentIndex : -1;
  const dotRow = ci >= 0 ? rows[ci] : undefined;
  const dotV = dotRow ? (dotRow.actual ?? dotRow.target) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <path
        d={targetPath}
        fill="none"
        strokeWidth={1.5}
        style={{ stroke: `color-mix(in srgb, ${color} 38%, transparent)` }}
      />
      {actualPath && (
        <path
          d={actualPath.trim()}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ stroke: color }}
        />
      )}
      {ci >= 0 && dotV != null && (
        <circle cx={cx(ci)} cy={y(dotV)} r={2.5} style={{ fill: color }} />
      )}
    </svg>
  );
}
