"use client";

// ── Divergence edge row — ISOLATED brand prototype ──────────────────────────
// Standalone experiment for the Diamond Mind signature primitive + motion:
// the market as a single cool line, the model as a warm distribution that RISES
// out of that line and SLIDES to where the model prices the edge, while the edge
// number counts up. Self-contained (own palette, no design-system tokens) so it
// can be judged in the real stack without touching any shipped page.
// See memory: frontend_redesign_direction. Not wired into the app.

import { useEffect, useRef, useState } from "react";

const C = {
  graphite: "#7C8B9C", // the market — cool, certain
  amber: "#D99A34",    // the model — warm, our belief
  text: "#D5DBE2",
  bright: "#E4E9EF",
  muted: "#6B7580",
  hair: "#1B2027",
};

// Probability window mapped across the plotting track.
const LO = 30, HI = 62;
const X0 = 28, X1 = 332, BASE = 116, PEAK = 34, HALF = 62;
const xFor = (p: number) => X0 + ((p - LO) / (HI - LO)) * (X1 - X0);
const bell = (cx: number) =>
  `M${cx - HALF} ${BASE} C${cx - HALF * 0.62} ${BASE} ${cx - HALF * 0.3} ${PEAK} ${cx} ${PEAK}` +
  ` C${cx + HALF * 0.3} ${PEAK} ${cx + HALF * 0.62} ${BASE} ${cx + HALF} ${BASE} Z`;

export type EdgeRowProps = {
  away: string;
  home: string;
  market: string;        // sub-label, e.g. "moneyline · Pittsburgh"
  marketProb: number;    // 0–100, the crowd's vig-free price
  modelProb: number;     // 0–100, the model's belief
  edge: number;          // points of edge (positive)
  confidence: number;    // 0–100
  playKey: number;       // bump to replay the divergence
};

export function DivergenceEdgeRow(props: EdgeRowProps) {
  const { away, home, market, marketProb, modelProb, edge, confidence, playKey } = props;
  const mx = xFor(marketProb);
  const cx = xFor(modelProb);
  const from = mx - cx; // where the model starts (collapsed onto the market line)

  const modelRef = useRef<SVGGElement>(null);
  const gapRef = useRef<SVGGElement>(null);
  const [edgeText, setEdgeText] = useState("0.0");
  const [modelText, setModelText] = useState(marketProb.toFixed(0));

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const g = modelRef.current;
    const gap = gapRef.current;
    let raf = 0;
    const anims: Animation[] = [];

    if (reduce) {
      if (g) { g.style.transform = "none"; g.style.opacity = "1"; }
      if (gap) gap.style.opacity = "1";
      setEdgeText(edge.toFixed(1));
      setModelText(modelProb.toFixed(0));
      return;
    }

    if (g?.animate) {
      anims.push(g.animate(
        [
          { transform: `translateX(${from}px) scaleY(0.05)`, opacity: 0.25 },
          { opacity: 1, offset: 0.55 },
          { transform: "translateX(0) scaleY(1)", opacity: 1 },
        ],
        { duration: 950, easing: "cubic-bezier(.2,.85,.25,1)", fill: "both" },
      ));
    }
    if (gap?.animate) {
      anims.push(gap.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 460, delay: 560, easing: "ease", fill: "both" },
      ));
    }

    const dur = 950, t0 = performance.now();
    const tick = (now: number) => {
      const x = Math.min(1, (now - t0) / dur);
      const e = 0.5 - Math.cos(Math.PI * x) / 2; // ease-in-out
      setEdgeText((edge * e).toFixed(1));
      setModelText((marketProb + (modelProb - marketProb) * e).toFixed(0));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => { cancelAnimationFrame(raf); anims.forEach((a) => a.cancel()); };
  }, [playKey, from, edge, marketProb, modelProb]);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "8px 8px",
        borderTop: `1px solid ${C.hair}`, cursor: "pointer",
        fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
      }}
    >
      <div style={{ width: 138, flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{away} @ {home}</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{market}</div>
      </div>

      <svg viewBox="0 0 360 158" style={{ flex: 1, minWidth: 170, height: 108, display: "block" }} preserveAspectRatio="xMidYMax meet"
        role="img" aria-label={`Model prices ${modelProb.toFixed(0)} percent versus market ${marketProb.toFixed(0)} percent, ${edge.toFixed(1)} points of edge`}>
        <line x1={X0} y1={BASE} x2={X1} y2={BASE} stroke={C.hair} />

        <line x1={mx} y1={BASE} x2={mx} y2={PEAK - 6} stroke={C.graphite} strokeWidth={2} />
        <circle cx={mx} cy={PEAK - 6} r={3} fill={C.graphite} />

        <g ref={modelRef} style={{ transformBox: "fill-box", transformOrigin: "50% 100%", opacity: 0, willChange: "transform, opacity" }}>
          <path d={bell(cx)} fill={C.amber} fillOpacity={0.13} stroke={C.amber} strokeWidth={2} />
        </g>

        {/* Model value above the peak, market value below the baseline — two
            vertical bands, so they never collide however close in x. */}
        <text x={cx} y={PEAK - 10} textAnchor="middle" fill={C.bright} fontSize={15} fontWeight={600}
          fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>{modelText}%</text>

        <g ref={gapRef} style={{ opacity: 0 }}>
          <line x1={mx} y1={BASE + 12} x2={cx} y2={BASE + 12} stroke={C.amber} strokeWidth={1.25} />
          <line x1={mx} y1={BASE + 8} x2={mx} y2={BASE + 16} stroke={C.amber} strokeWidth={1.25} />
          <line x1={cx} y1={BASE + 8} x2={cx} y2={BASE + 16} stroke={C.amber} strokeWidth={1.25} />
          <text x={mx} y={BASE + 32} textAnchor="middle" fill={C.graphite} fontSize={11}
            fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>{marketProb.toFixed(0)}%</text>
        </g>
      </svg>

      <div style={{ width: 100, textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.amber, letterSpacing: "-0.02em",
          fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
          +{edgeText}
        </div>
        <div style={{ fontSize: 11, color: C.muted }}>pts of edge</div>
        <div style={{ fontSize: 11, color: "#8A94A0", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
          {confidence.toFixed(0)}% confidence
        </div>
      </div>
    </div>
  );
}
