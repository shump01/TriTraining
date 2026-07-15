/**
 * The hero graphic: three sport builds (bike / run / swim) that ramp with 4-week
 * de-loads, peak, then taper into race day — the same shape the training engine
 * produces. Pure server component; the draw-in animation is pure CSS (a fixed
 * dash length longer than any path, so no client measurement is needed).
 */
const W = 520;
const H = 240;
const PADL = 8;
const PADR = 8;
const PADT = 16;
const PADB = 26;
const WEEKS = 16;
const TAPER = 2;
const MAX_Y = 108;
const DASH = 1800; // ≥ every path length, so the line fully draws in

function buildSeries(peak: number): number[] {
  const peakIdx = WEEKS - 1 - TAPER;
  const v = [peak * 0.42];
  for (let w = 1; w <= peakIdx; w++) {
    v.push(w % 4 === 3 ? v[w - 2]! : Math.min(v[w - 1]! * 1.11, peak));
  }
  const top = Math.max(...v);
  for (let t = 1; t <= TAPER; t++) v.push(top * (1 - 0.5 * (t / TAPER)));
  return v;
}

const SERIES = [
  { key: "bike", color: "var(--bike)", vals: buildSeries(100), width: 2.4, fill: 0.14, cls: "" },
  { key: "run", color: "var(--run)", vals: buildSeries(66), width: 2, fill: 0, cls: "s2" },
  { key: "swim", color: "var(--swim)", vals: buildSeries(40), width: 2, fill: 0, cls: "s3" },
];

const N = SERIES[0]!.vals.length;
const xAt = (i: number) => PADL + ((W - PADL - PADR) * i) / (N - 1);
const yAt = (val: number) => PADT + (H - PADT - PADB) * (1 - val / MAX_Y);
const line = (vals: number[]) =>
  vals.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");

const bike = SERIES[0]!.vals;
let peakI = 0;
bike.forEach((v, i) => {
  if (v >= bike[peakI]!) peakI = i;
});

export function HeroCurve() {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="A periodized training build that ramps, de-loads, peaks and tapers into race day"
    >
      {[0, 1, 2, 3].map((g) => {
        const gy = PADT + ((H - PADT - PADB) * g) / 3;
        return (
          <line key={g} x1={PADL} x2={W - PADR} y1={gy} y2={gy} stroke="rgba(243,237,225,0.06)" />
        );
      })}

      <line
        className="flag"
        x1={xAt(peakI)}
        x2={xAt(peakI)}
        y1={PADT}
        y2={H - PADB}
        stroke="rgba(243,237,225,0.18)"
        strokeDasharray="2 4"
      />
      <line
        className="flag"
        x1={xAt(N - 1)}
        x2={xAt(N - 1)}
        y1={PADT}
        y2={H - PADB}
        strokeDasharray="2 4"
        style={{ stroke: "var(--run)", opacity: 0.5 }}
      />

      {SERIES.map((s) =>
        s.fill ? (
          <path
            key={`${s.key}-fill`}
            d={`${line(s.vals)} L ${xAt(N - 1)} ${H - PADB} L ${PADL} ${H - PADB} Z`}
            style={{ fill: s.color, opacity: s.fill }}
          />
        ) : null,
      )}

      {SERIES.map((s) => (
        <path
          key={s.key}
          className={`draw ${s.cls}`}
          d={line(s.vals)}
          fill="none"
          strokeWidth={s.width}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ stroke: s.color, strokeDasharray: DASH, strokeDashoffset: DASH }}
        />
      ))}

      <circle
        className="flag"
        cx={xAt(peakI)}
        cy={yAt(bike[peakI]!)}
        r={4.5}
        strokeWidth={2}
        style={{ fill: "var(--void)", stroke: "var(--bike)" }}
      />
      <circle
        className="flag"
        cx={xAt(N - 1)}
        cy={yAt(bike[N - 1]!)}
        r={4.5}
        style={{ fill: "var(--run)" }}
      />
      <text
        className="flag"
        x={xAt(peakI)}
        y={PADT - 4}
        textAnchor="middle"
        fontSize={9}
        letterSpacing={1}
        style={{ fill: "var(--ink-dim)", fontFamily: "var(--font-jetbrains), monospace" }}
      >
        PEAK
      </text>
      <text
        className="flag"
        x={xAt(N - 1)}
        y={H - 8}
        textAnchor="end"
        fontSize={9}
        letterSpacing={1}
        style={{ fill: "var(--run)", fontFamily: "var(--font-jetbrains), monospace" }}
      >
        RACE DAY
      </text>
    </svg>
  );
}
