"use client";

// ── Divergence HERO — motion-identity prototype (isolated) ──────────────────
// Hero-scale rendering of one market-vs-model disagreement. Choreographed:
// (1) the market draws in as a single cold line, (2) the model emerges from it
// and slides away — the disagreement OPENS — (3) the gap + edge resolve.
// The question this exists to answer: is the divergence gesture memorable as
// Diamond Mind? Not wired into the app. See memory: frontend_redesign_direction.

import { useEffect, useRef, useState } from "react";

const C = {
  graphite: "#7C8B9C", amber: "#D99A34",
  text: "#E7ECF2", bright: "#F4F7FA", muted: "#727C88", faint: "#3A414B",
};

const BASE = 330, TOP = 80, LO = 34, HI = 56, X0 = 140, X1 = 760, HALF = 150;
const xFor = (p: number) => X0 + ((p - LO) / (HI - LO)) * (X1 - X0);
const bell = (cx: number) =>
  `M${cx - HALF} ${BASE} C${cx - HALF * 0.62} ${BASE} ${cx - HALF * 0.3} ${TOP} ${cx} ${TOP}` +
  ` C${cx + HALF * 0.3} ${TOP} ${cx + HALF * 0.62} ${BASE} ${cx + HALF} ${BASE} Z`;

export type Treatment = "scoreboard" | "editorial";

export type HeroProps = {
  away: string; home: string; market: string;
  marketProb: number; modelProb: number; edge: number; confidence: number;
  playKey: number; treatment: Treatment;
};

export function DivergenceHero(p: HeroProps) {
  const { away, home, market, marketProb, modelProb, edge, confidence, playKey, treatment } = p;
  const mx = xFor(marketProb), cx = xFor(modelProb), from = mx - cx;

  const lineRef = useRef<SVGGElement>(null);
  const modelRef = useRef<SVGGElement>(null);
  const labelRef = useRef<SVGGElement>(null);
  const [edgeT, setEdgeT] = useState("0.0");

  useEffect(() => {
    const reduce = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const line = lineRef.current, model = modelRef.current, label = labelRef.current;
    let raf = 0; const anims: Animation[] = [];

    if (reduce) {
      [line, model, label].forEach((el) => { if (el) { el.style.transform = "none"; el.style.opacity = "1"; } });
      setEdgeT(edge.toFixed(1));
      return;
    }

    if (line?.animate) anims.push(line.animate(
      [{ transform: "scaleY(0)", opacity: 0.4 }, { transform: "scaleY(1)", opacity: 1 }],
      { duration: 380, easing: "cubic-bezier(.3,1,.4,1)", fill: "both" }));

    if (model?.animate) anims.push(model.animate(
      [
        { transform: `translateX(${from}px) scaleY(0.03)`, opacity: 0.15 },
        { opacity: 1, offset: 0.5 },
        { transform: "translateX(0) scaleY(1)", opacity: 1 },
      ],
      { duration: 880, delay: 300, easing: "cubic-bezier(.22,1,.28,1)", fill: "both" }));

    if (label?.animate) anims.push(label.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 520, delay: 1020, easing: "ease", fill: "both" }));

    const dur = 900, t0 = performance.now() + 300;
    const tick = (now: number) => {
      const x = Math.max(0, Math.min(1, (now - t0) / dur));
      const e = 0.5 - Math.cos(Math.PI * x) / 2;
      setEdgeT((edge * e).toFixed(1));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); anims.forEach((a) => a.cancel()); };
  }, [playKey, from, edge]);

  const isEd = treatment === "editorial";
  const numStyle: React.CSSProperties = {
    fontFamily: isEd ? "var(--font-display-serif)" : "var(--font-display)",
    fontWeight: 700, fontSize: "clamp(64px, 12vw, 112px)", lineHeight: 1,
    letterSpacing: isEd ? "-0.01em" : "-0.035em", color: C.amber,
    fontVariantNumeric: "tabular-nums",
  };
  const subStyle: React.CSSProperties = {
    fontFamily: isEd ? "var(--font-body)" : "var(--font-display)",
    textTransform: isEd ? "none" : "uppercase",
    letterSpacing: isEd ? "0.01em" : "0.16em",
    fontSize: 13, color: C.muted, fontWeight: isEd ? 400 : 600,
  };

  return (
    <div style={{ textAlign: "center", width: "100%" }}>
      <svg viewBox="0 0 900 400" style={{ width: "100%", maxWidth: 900, height: "auto", display: "block", margin: "0 auto" }}
        role="img" aria-label={`The market prices ${away} at ${marketProb.toFixed(0)} percent; the model at ${modelProb.toFixed(0)} percent, a ${edge.toFixed(1)} point edge`}>
        <line x1={X0 - 20} y1={BASE} x2={X1 + 20} y2={BASE} stroke="#1A1F26" />

        <g ref={lineRef} style={{ transformBox: "fill-box", transformOrigin: "50% 100%", opacity: 0 }}>
          <line x1={mx} y1={BASE} x2={mx} y2={TOP - 4} stroke={C.graphite} strokeWidth={2.5} />
          <circle cx={mx} cy={TOP - 4} r={4} fill={C.graphite} />
        </g>

        <g ref={modelRef} style={{ transformBox: "fill-box", transformOrigin: "50% 100%", opacity: 0, willChange: "transform, opacity" }}>
          <path d={bell(cx)} fill={C.amber} fillOpacity={0.14} stroke={C.amber} strokeWidth={2.5} />
        </g>

        <g ref={labelRef} style={{ opacity: 0 }}>
          <text x={mx} y={TOP - 30} textAnchor="middle" fill={C.muted} fontSize={11} letterSpacing="0.18em"
            fontFamily="var(--font-display)">THE MARKET</text>
          <text x={mx} y={TOP - 12} textAnchor="middle" fill={C.graphite} fontSize={18} fontWeight={600}
            fontFamily="var(--font-display)" style={{ fontVariantNumeric: "tabular-nums" }}>{marketProb.toFixed(0)}%</text>
          <text x={cx} y={TOP - 30} textAnchor="middle" fill={C.amber} fontSize={11} letterSpacing="0.18em"
            fontFamily="var(--font-display)">OUR MODEL</text>
          <text x={cx} y={TOP - 12} textAnchor="middle" fill={C.bright} fontSize={20} fontWeight={700}
            fontFamily="var(--font-display)" style={{ fontVariantNumeric: "tabular-nums" }}>{modelProb.toFixed(0)}%</text>
          <line x1={mx} y1={BASE + 20} x2={cx} y2={BASE + 20} stroke={C.amber} strokeWidth={1.5} />
          <line x1={mx} y1={BASE + 14} x2={mx} y2={BASE + 26} stroke={C.amber} strokeWidth={1.5} />
          <line x1={cx} y1={BASE + 14} x2={cx} y2={BASE + 26} stroke={C.amber} strokeWidth={1.5} />
        </g>
      </svg>

      <div style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={numStyle}>+{edgeT}</div>
        <div style={subStyle}>
          {away} · points of edge over the market · {confidence.toFixed(0)}% confidence
        </div>
      </div>
    </div>
  );
}
