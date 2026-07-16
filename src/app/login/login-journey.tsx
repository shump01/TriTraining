"use client";

// The login brand-panel animation — "The Journey" (exported from Claude
// design). One glowing athlete-dot travels through Dawn → Swim → Bike → Run →
// Race Day, then loops. Ported to a self-contained client component: a small
// requestAnimationFrame clock replaces the design runtime's SceneStage, the
// 960×1200 portrait stage is scaled to *cover* the panel, and the editor
// tooling is dropped. Decorative (aria-hidden); respects reduced motion by
// holding a settled Dawn frame. Fonts come from next/font (see layout.tsx).

import {
  createContext,
  type CSSProperties,
  type ReactElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// Palette: [void, ink, swim, bike, run] — the design's default "The Journey".
const PAL = ["#0A1322", "#EFF4F6", "#56CFE1", "#FFC24B", "#FF6F61"] as const;
const W = 960;
const H = 1200;
const DISPLAY = "var(--font-space-grotesk), 'Space Grotesk', sans-serif";
const MONO = "var(--font-ibm-plex-mono), 'IBM Plex Mono', monospace";

const SCENES = [
  { name: "Dawn", dur: 2.5 },
  { name: "Swim", dur: 3 },
  { name: "Bike", dur: 3 },
  { name: "Run", dur: 3 },
  { name: "Race Day", dur: 3 },
] as const;
const TOTAL = SCENES.reduce((s, x) => s + x.dur, 0);
// Cumulative scene start times, so a clock value maps to (scene, localTime).
const STARTS = SCENES.reduce<number[]>((acc, s, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1]! + SCENES[i - 1]!.dur);
  return acc;
}, []);
// A settled Dawn frame to hold when the user prefers reduced motion.
const STILL_CLOCK = 2.0;

// ── Easing + helpers (from the design runtime) ────────────────────────────
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const Ease = {
  linear: (t: number) => t,
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => {
    const u = t - 1;
    return u * u * u + 1;
  },
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

// eased 0..1 over [a,b] of t
function seg(t: number, a: number, b: number, ease: (t: number) => number = Ease.easeInOutCubic) {
  return ease(clamp((t - a) / (b - a), 0, 1));
}

// ── Scene clock context ───────────────────────────────────────────────────
type SceneState = { localTime: number; progress: number; dur: number; name: string };
const SceneCtx = createContext<SceneState>({ localTime: 0, progress: 0, dur: 1, name: "Dawn" });
const useScene = () => useContext(SceneCtx);

// Dip-to-dark wrapper: every scene fades from/to the stage bg so the cuts read
// as deliberate beats.
function SceneFade({
  inT = 0.35,
  outT = 0.3,
  children,
}: {
  inT?: number;
  outT?: number;
  children: React.ReactNode;
}) {
  const { localTime, dur } = useScene();
  const o = Math.min(clamp(localTime / inT, 0, 1), clamp((dur - localTime) / outT, 0, 1));
  return (
    <div style={{ position: "absolute", inset: 0, background: PAL[0] }}>
      <div style={{ position: "absolute", inset: 0, opacity: o }}>{children}</div>
    </div>
  );
}

function GhostWord({ text, y, color }: { text: string; y: number; color: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: y,
        transform: "translateX(-50%)",
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: 190,
        letterSpacing: "0.02em",
        color,
        opacity: 0.07,
        whiteSpace: "pre",
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );
}

function SportTag({
  num,
  name,
  accent,
  t,
}: {
  num: string;
  name: string;
  accent: string;
  t: number;
}) {
  const slide = seg(t, 0.15, 0.65, Ease.easeOutCubic);
  return (
    <div
      style={{
        position: "absolute",
        left: 84,
        top: 180,
        display: "flex",
        alignItems: "baseline",
        gap: 18,
        transform: `translateY(${(1 - slide) * 24}px)`,
        opacity: slide,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 22, color: accent, letterSpacing: "0.2em" }}>
        {num}
      </span>
      <span
        style={{
          fontFamily: DISPLAY,
          fontWeight: 700,
          fontSize: 76,
          color: "currentColor",
          letterSpacing: "-0.01em",
        }}
      >
        {name}
      </span>
      <div
        style={{
          width: 120,
          height: 3,
          background: accent,
          alignSelf: "center",
          transform: `scaleX(${slide})`,
          transformOrigin: "left",
        }}
      />
    </div>
  );
}

function Dot({
  x,
  y,
  accent,
  r = 13,
  glow = 1,
}: {
  x: number;
  y: number;
  accent: string;
  r?: number;
  glow?: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        background: accent,
        boxShadow: `0 0 ${18 * glow}px ${accent}, 0 0 ${52 * glow}px ${accent}66`,
      }}
    />
  );
}

// ── Scene 1: Dawn / opener ────────────────────────────────────────────────
function DawnScene() {
  const { localTime, dur } = useScene();
  const ink = PAL[1];
  const line = seg(localTime, 0.3, 1.3, Ease.easeInOutCubic);
  const rise = seg(localTime, 0.5, dur - 0.4, Ease.easeInOutSine);
  const sunY = 720 - rise * 120;
  const clipPx = Math.max(0, sunY + 60 - 700);
  const head = seg(localTime, 0.5, 1.2, Ease.easeOutCubic);
  return (
    <SceneFade>
      <div style={{ position: "absolute", inset: 0, color: ink }}>
        <div
          style={{
            position: "absolute",
            left: 84,
            top: 96,
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: "0.34em",
            opacity: 0.7,
          }}
        >
          TRITRAINER
        </div>
        {/* rising sun */}
        <div
          style={{
            position: "absolute",
            left: W / 2 - 60,
            top: sunY - 60,
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: PAL[3],
            opacity: 0.9,
            boxShadow: clipPx > 0 ? "none" : `0 0 90px ${PAL[3]}55`,
            clipPath: clipPx > 0 ? `inset(0 0 ${clipPx}px 0)` : "none",
          }}
        />
        {/* horizon */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 700,
            width: 700,
            height: 2,
            background: ink,
            opacity: 0.5,
            transform: `translateX(-50%) scaleX(${line})`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 84,
            top: 320,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 96,
            lineHeight: 1.02,
            letterSpacing: "-0.02em",
            opacity: head,
            transform: `translateY(${(1 - head) * 20}px)`,
          }}
        >
          Back to
          <br />
          the <em style={{ fontStyle: "italic", color: PAL[2] }}>build.</em>
        </div>
        <div
          style={{
            position: "absolute",
            left: 84,
            top: 860,
            fontFamily: MONO,
            fontSize: 21,
            letterSpacing: "0.12em",
            opacity: 0.55 * seg(localTime, 1.0, 1.6),
          }}
        >
          PLAN THE BUILD · ARRIVE FRESH
        </div>
      </div>
    </SceneFade>
  );
}

// ── Scene 2: Swim ─────────────────────────────────────────────────────────
function wavePoints(midY: number, amp: number, cycles: number, phase: number) {
  const pts: string[] = [];
  for (let x = 0; x <= W; x += 12) {
    const y = midY + amp * Math.sin((x / W) * cycles * Math.PI * 2 + phase);
    pts.push(x + "," + y.toFixed(1));
  }
  return pts.join(" ");
}

function SwimScene() {
  const { localTime, progress } = useScene();
  const ink = PAL[1];
  const swim = PAL[2];
  const ph = localTime * 1.6;
  const xN = seg(progress, 0.06, 0.96, Ease.easeInOutSine);
  const x = 70 + xN * (W - 150);
  const y = 660 + 34 * Math.sin((x / W) * 3 * Math.PI * 2 + ph);
  return (
    <SceneFade>
      <div style={{ position: "absolute", inset: 0, color: ink }}>
        <GhostWord text="SWIM" y={430} color={swim} />
        <SportTag num="01" name="Swim" accent={swim} t={progress} />
        <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
          <polyline
            points={wavePoints(600, 24, 3, ph + 1.4)}
            fill="none"
            stroke={swim}
            strokeWidth="2"
            opacity="0.2"
          />
          <polyline
            points={wavePoints(660, 34, 3, ph)}
            fill="none"
            stroke={swim}
            strokeWidth="3"
            opacity="0.55"
          />
          <polyline
            points={wavePoints(724, 26, 3, ph - 1.1)}
            fill="none"
            stroke={swim}
            strokeWidth="2"
            opacity="0.15"
          />
        </svg>
        {/* wake trail */}
        {[1, 2, 3, 4].map((i) => (
          <Dot
            key={i}
            x={x - i * 26}
            y={660 + 34 * Math.sin(((x - i * 26) / W) * 3 * Math.PI * 2 + ph)}
            accent={swim}
            r={Math.max(2, 8 - i * 1.8)}
            glow={0.3}
          />
        ))}
        <Dot x={x} y={y} accent={swim} />
        <div
          style={{
            position: "absolute",
            left: 84,
            bottom: 150,
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: "0.14em",
            opacity: 0.5,
          }}
        >
          {String(Math.round(clamp(progress, 0, 1) * 1500)).padStart(4, "0")} M
        </div>
      </div>
    </SceneFade>
  );
}

// ── Scene 3: Bike ─────────────────────────────────────────────────────────
function BikeScene() {
  const { localTime, progress } = useScene();
  const ink = PAL[1];
  const bike = PAL[3];
  const scroll = (localTime * 560) % 128;
  const x = 180 + seg(progress, 0.05, 0.95, Ease.easeInOutSine) * 560;
  const bob = Math.sin(localTime * 7) * 3;
  return (
    <SceneFade>
      <div style={{ position: "absolute", inset: 0, color: ink }}>
        <GhostWord text="BIKE" y={430} color={bike} />
        <SportTag num="02" name="Bike" accent={bike} t={progress} />
        {/* rolling hills — big soft circles */}
        <div
          style={{
            position: "absolute",
            left: -300 - scroll * 0.6,
            top: 560,
            width: 800,
            height: 800,
            borderRadius: "50%",
            background: ink,
            opacity: 0.05,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 420 - scroll * 0.6,
            top: 620,
            width: 900,
            height: 900,
            borderRadius: "50%",
            background: ink,
            opacity: 0.04,
          }}
        />
        {/* road */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 706,
            width: W,
            height: 2,
            background: ink,
            opacity: 0.5,
          }}
        />
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 736,
              left: i * 128 - scroll,
              width: 56,
              height: 4,
              background: ink,
              opacity: 0.25,
              borderRadius: 2,
            }}
          />
        ))}
        {/* speed lines */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - 100 - i * 34,
              top: 668 + i * 10 + bob,
              width: 64 - i * 14,
              height: 3,
              background: bike,
              opacity: 0.5 - i * 0.14,
              borderRadius: 2,
            }}
          />
        ))}
        <Dot x={x} y={676 + bob} accent={bike} />
        <div
          style={{
            position: "absolute",
            left: 84,
            bottom: 150,
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: "0.14em",
            opacity: 0.5,
          }}
        >
          {(clamp(progress, 0, 1) * 40).toFixed(1)} KM
        </div>
      </div>
    </SceneFade>
  );
}

// ── Scene 4: Run ──────────────────────────────────────────────────────────
function RunScene() {
  const { progress } = useScene();
  const ink = PAL[1];
  const run = PAL[4];
  const p = seg(progress, 0.05, 0.95, Ease.linear);
  const x = 90 + p * (W - 180);
  const hop = Math.abs(Math.sin(p * Math.PI * 7));
  const y = 700 - hop * 74;
  return (
    <SceneFade>
      <div style={{ position: "absolute", inset: 0, color: ink }}>
        <GhostWord text="RUN" y={430} color={run} />
        <SportTag num="03" name="Run" accent={run} t={progress} />
        {/* track lanes */}
        {[700, 748, 796].map((ly, i) => (
          <div
            key={ly}
            style={{
              position: "absolute",
              left: 0,
              top: ly + 14,
              width: W,
              height: 2,
              background: ink,
              opacity: 0.4 - i * 0.13,
            }}
          />
        ))}
        {/* contact shadow */}
        <div
          style={{
            position: "absolute",
            left: x - 20,
            top: 706,
            width: 40,
            height: 8,
            borderRadius: "50%",
            background: run,
            opacity: 0.35 * (1 - hop),
            filter: "blur(2px)",
          }}
        />
        {/* stride trail */}
        {[1, 2, 3].map((i) => {
          const px = clamp(p - i * 0.045, 0, 1);
          return (
            <Dot
              key={i}
              x={90 + px * (W - 180)}
              y={700 - Math.abs(Math.sin(px * Math.PI * 7)) * 74}
              accent={run}
              r={Math.max(2, 8 - i * 2.4)}
              glow={0.25}
            />
          );
        })}
        <Dot x={x} y={y} accent={run} />
        <div
          style={{
            position: "absolute",
            left: 84,
            bottom: 150,
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: "0.14em",
            opacity: 0.5,
          }}
        >
          {(clamp(progress, 0, 1) * 10).toFixed(2)} KM
        </div>
      </div>
    </SceneFade>
  );
}

// ── Scene 5: Race day ─────────────────────────────────────────────────────
function RaceDayScene() {
  const { progress } = useScene();
  const ink = PAL[1];
  const swim = PAL[2];
  const bike = PAL[3];
  const run = PAL[4];
  const gateX = 660;
  const x = 60 + seg(progress, 0.02, 0.5, Ease.easeInCubic) * (W - 60);
  const crossed = progress > 0.34;
  const burst = seg(progress, 0.34, 0.72, Ease.easeOutCubic);
  const cells: [number, number][] = [];
  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 2; c++) {
      if ((r + c) % 2 === 0) cells.push([r, c]);
    }
  }
  return (
    <SceneFade outT={0.5}>
      <div style={{ position: "absolute", inset: 0, color: ink }}>
        {/* finish gate */}
        <div style={{ position: "absolute", left: gateX, top: 560, width: 36, height: 252 }}>
          {cells.map(([r, c]) => (
            <div
              key={r + "-" + c}
              style={{
                position: "absolute",
                left: c * 18,
                top: r * 18,
                width: 18,
                height: 18,
                background: ink,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        {/* athlete streaks through */}
        {!crossed &&
          [0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x - 120 - i * 30,
                top: 676 + (i - 1) * 9,
                width: 90 - i * 22,
                height: 3,
                background: run,
                opacity: 0.55 - i * 0.15,
                borderRadius: 2,
              }}
            />
          ))}
        {!crossed && <Dot x={x} y={680} accent={run} glow={1.4} />}
        {/* burst */}
        {crossed &&
          burst < 1 &&
          Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            const d = 30 + burst * 190;
            const col = [swim, bike, run][i % 3];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: gateX + 18 + Math.cos(a) * d,
                  top: 680 + Math.sin(a) * d,
                  width: 12,
                  height: 4,
                  borderRadius: 2,
                  background: col,
                  opacity: 1 - burst,
                  transform: `rotate(${a}rad)`,
                }}
              />
            );
          })}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 320,
            transform: `translateX(-50%) scale(${0.86 + 0.14 * seg(progress, 0.4, 0.62, Ease.easeOutBack)})`,
            fontFamily: DISPLAY,
            fontWeight: 700,
            fontSize: 118,
            letterSpacing: "-0.01em",
            opacity: seg(progress, 0.4, 0.58, Ease.easeOutCubic),
            whiteSpace: "pre",
            textAlign: "center",
          }}
        >
          RACE DAY
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 470,
            transform: "translateX(-50%)",
            fontFamily: MONO,
            fontSize: 21,
            letterSpacing: "0.2em",
            opacity: 0.6 * seg(progress, 0.55, 0.72),
            display: "flex",
            gap: 26,
            alignItems: "center",
          }}
        >
          <span style={{ color: swim }}>SWIM</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ color: bike }}>BIKE</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ color: run }}>RUN</span>
        </div>
      </div>
    </SceneFade>
  );
}

const SCENE_COMPONENTS: Record<string, () => ReactElement> = {
  Dawn: DawnScene,
  Swim: SwimScene,
  Bike: BikeScene,
  Run: RunScene,
  "Race Day": RaceDayScene,
};

// ── Stage runner ──────────────────────────────────────────────────────────
export function LoginJourney() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [clock, setClock] = useState(0);

  // Prefers-reduced-motion.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Scale the fixed 960×1200 stage to *cover* the panel; also track whether the
  // panel is on-screen (it's display:none below the 900px breakpoint) so the
  // clock can pause when hidden.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setVisible(w > 0 && h > 0);
      if (w > 0 && h > 0) setScale(Math.max(w / W, h / H));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The clock: advance while on-screen and motion is allowed; loop over TOTAL.
  useEffect(() => {
    if (!visible || reduced) return;
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last == null) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      setClock((prev) => (prev + dt) % TOTAL);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [visible, reduced]);

  const t = reduced ? STILL_CLOCK : clock;
  let idx = SCENES.length - 1;
  for (let i = 0; i < SCENES.length; i++) {
    if (t < STARTS[i]! + SCENES[i]!.dur) {
      idx = i;
      break;
    }
  }
  const scene = SCENES[idx]!;
  const localTime = clamp(t - STARTS[idx]!, 0, scene.dur);
  const progress = scene.dur > 0 ? localTime / scene.dur : 0;
  const Scene = SCENE_COMPONENTS[scene.name]!;

  const canvasStyle: CSSProperties = {
    position: "relative",
    flexShrink: 0,
    width: W,
    height: H,
    transform: `scale(${scale})`,
    transformOrigin: "center",
  };

  return (
    <div ref={wrapRef} className="journey-stage" aria-hidden>
      <div style={canvasStyle}>
        <SceneCtx.Provider value={{ localTime, progress, dur: scene.dur, name: scene.name }}>
          <Scene />
        </SceneCtx.Provider>
      </div>
    </div>
  );
}
