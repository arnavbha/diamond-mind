"use client";

// ── Edge glyph — the Brief's visual anchor ───────────────────────────────────
// The market-vs-model disagreement drawn as the product's signature object:
// the market as a single cool tick (it holds one certain price), the model as
// a warm distribution offset from it (a belief with width), and the gap
// between them bracketed as the edge. Graduated from the /lab/edge-row
// prototype into the app's own tokens. Hand-rolled SVG, no chart deps
// (DESIGN.md §6). On load the belief rises out of the market's line and
// slides to its price — the disagreement opening. Reduced-motion renders the
// final state.

import { useEffect, useRef, useState } from "react";

type Props = {
  marketPct: number; // vig-free market win prob for the leaned side, 0–100
  modelPct: number;  // model (shrunk) win prob for the same side, 0–100
  hero?: boolean;    // hero: labeled + gap bracket + edge count-up; else mini
};

const MARKET = "var(--text-2)";
const MODEL = "var(--clay)";

export function EdgeGlyph({ marketPct, modelPct, hero = false }: Props) {
  // Geometry per size. The probability window flexes around the two values so
  // small gaps still read as a visible separation.
  const G = hero
    ? { W: 680, H: 164, X0: 56, X1: 624, BASE: 112, PEAK: 34, HALF: 88 }
    : { W: 260, H: 62, X0: 18, X1: 242, BASE: 44, PEAK: 15, HALF: 32 };
  const lo = Math.max(0, Math.min(marketPct, modelPct) - 10);
  const hi = Math.min(100, Math.max(marketPct, modelPct) + 10);
  const xFor = (p: number) => G.X0 + ((p - lo) / (hi - lo)) * (G.X1 - G.X0);
  const mx = xFor(marketPct);
  const cx = xFor(modelPct);
  const bell =
    `M${cx - G.HALF} ${G.BASE}` +
    ` C${cx - G.HALF * 0.62} ${G.BASE} ${cx - G.HALF * 0.3} ${G.PEAK} ${cx} ${G.PEAK}` +
    ` C${cx + G.HALF * 0.3} ${G.PEAK} ${cx + G.HALF * 0.62} ${G.BASE} ${cx + G.HALF} ${G.BASE} Z`;

  const bellRef = useRef<SVGGElement>(null);
  const bracketRef = useRef<SVGGElement>(null);
  const pts = modelPct - marketPct;
  const [ptsText, setPtsText] = useState(hero ? "0.0" : pts.toFixed(1));

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const bellG = bellRef.current;
    const bracket = bracketRef.current;
    let raf = 0;
    const anims: Animation[] = [];

    if (reduce || !bellG?.animate) {
      if (bellG) { bellG.style.transform = "none"; bellG.style.opacity = "1"; }
      if (bracket) bracket.style.opacity = "1";
      setPtsText(pts.toFixed(1));
      return;
    }

    anims.push(bellG.animate(
      [
        { transform: `translateX(${mx - cx}px) scaleY(0.06)`, opacity: 0.2 },
        { opacity: 1, offset: 0.5 },
        { transform: "translateX(0) scaleY(1)", opacity: 1 },
      ],
      { duration: 820, delay: 120, easing: "cubic-bezier(.22,1,.28,1)", fill: "both" },
    ));
    if (bracket?.animate) {
      anims.push(bracket.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 420, delay: 720, easing: "ease", fill: "both" },
      ));
    }
    if (hero) {
      const dur = 820, t0 = performance.now() + 120;
      const tick = (now: number) => {
        const x = Math.max(0, Math.min(1, (now - t0) / dur));
        const e = 0.5 - Math.cos(Math.PI * x) / 2;
        setPtsText((pts * e).toFixed(1));
        if (x < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => { cancelAnimationFrame(raf); anims.forEach((a) => a.cancel()); };
    // Geometry is pure f(props); re-run only when the data changes.
  }, [marketPct, modelPct, hero, mx, cx, pts]);

  const label = `The model prices this side at ${modelPct.toFixed(1)} percent against a vig-free market of ${marketPct.toFixed(1)} percent — ${pts.toFixed(1)} points of edge.`;

  return (
    <svg
      viewBox={`0 0 ${G.W} ${G.H}`}
      role="img"
      aria-label={label}
      style={hero
        ? { width: "100%", maxWidth: `${G.W}px`, height: "auto", display: "block" }
        : { width: `${G.W}px`, height: "auto", display: "block", flexShrink: 0 }}
    >
      <line x1={G.X0 - (hero ? 24 : 8)} y1={G.BASE} x2={G.X1 + (hero ? 24 : 8)} y2={G.BASE} stroke="var(--border)" />

      {/* The market — one certain price */}
      <line x1={mx} y1={G.BASE} x2={mx} y2={G.PEAK + 6} stroke={MARKET} strokeWidth={hero ? 2 : 1.5} />
      <circle cx={mx} cy={G.PEAK + 6} r={hero ? 3.5 : 2.5} fill={MARKET} />
      {hero ? (
        <>
          <text x={mx - 10} y={G.PEAK + 2} textAnchor="end" fill="var(--text-muted)" fontSize={10} letterSpacing="0.14em" fontFamily="var(--font-mono)">MARKET</text>
          <text x={mx - 10} y={G.PEAK + 18} textAnchor="end" fill={MARKET} fontSize={14} fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>{marketPct.toFixed(1)}%</text>
        </>
      ) : (
        <text x={mx} y={G.BASE + 13} textAnchor="middle" fill={MARKET} fontSize={10} fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>{marketPct.toFixed(0)}</text>
      )}

      {/* The model — a belief with width */}
      <g ref={bellRef} style={{ transformBox: "fill-box", transformOrigin: "50% 100%", opacity: 0, willChange: "transform, opacity" }}>
        <path d={bell} fill={MODEL} fillOpacity={0.13} stroke={MODEL} strokeWidth={hero ? 2 : 1.5} />
      </g>
      {hero ? (
        <>
          <text x={cx} y={G.PEAK - 22} textAnchor="middle" fill={MODEL} fontSize={10} letterSpacing="0.14em" fontFamily="var(--font-mono)">MODEL</text>
          <text x={cx} y={G.PEAK - 6} textAnchor="middle" fill="var(--text)" fontSize={15} fontWeight={600} fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>{modelPct.toFixed(1)}%</text>
        </>
      ) : (
        <text x={cx} y={G.PEAK - 4} textAnchor="middle" fill="var(--text)" fontSize={11} fontWeight={600} fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>{modelPct.toFixed(0)}</text>
      )}

      {/* The gap — the edge itself */}
      {hero && (
        <g ref={bracketRef} style={{ opacity: 0 }}>
          <line x1={mx} y1={G.BASE + 14} x2={cx} y2={G.BASE + 14} stroke={MODEL} strokeWidth={1.5} />
          <line x1={mx} y1={G.BASE + 9} x2={mx} y2={G.BASE + 19} stroke={MODEL} strokeWidth={1.5} />
          <line x1={cx} y1={G.BASE + 9} x2={cx} y2={G.BASE + 19} stroke={MODEL} strokeWidth={1.5} />
          <text x={(mx + cx) / 2} y={G.BASE + 38} textAnchor="middle" fill={MODEL} fontSize={14} fontWeight={700} fontFamily="var(--font-mono)" style={{ fontVariantNumeric: "tabular-nums" }}>
            +{ptsText} pts of edge
          </text>
        </g>
      )}
    </svg>
  );
}
