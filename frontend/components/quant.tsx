"use client";

import type { GameAnalysis } from "@/lib/api";
import { tierColor as tierColorToken } from "@/lib/visual-tokens";
import { SectionHeader } from "@/components/ui";

/* ── color helpers ─────────────────────────────────────── */
// Re-exported for the pages (picks/verify) that import tierColor from quant.
// Single-sourced through the typed token module (STRONG LEAN→pos, LEAN→lean,
// PASS→text-2, AVOID→neg, NEED MORE INFO→warn).
export function tierColor(tier: string): string {
  return tierColorToken(tier);
}

export function pPlusColor(p: number): string {
  if (p >= 0.65) return "var(--pos)";
  if (p >= 0.55) return "var(--lean)";
  if (p >= 0.45) return "var(--warn)";
  return "var(--neg)";
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;

/* ── P(+EV) semicircular gauge ─────────────────────────── */
export function Gauge({ p, size = 132 }: { p: number; size?: number }) {
  const color = pPlusColor(p);
  return (
    <div
      className="gauge"
      style={
        {
          width: size,
          height: size / 2 + 6,
          "--g": Math.round(p * 100),
          "--gauge-color": color,
          clipPath: "inset(0 0 0 0)",
        } as React.CSSProperties
      }
    >
      <div style={{ position: "absolute", bottom: 2, textAlign: "center", width: "100%" }}>
        <div
          className="num"
          style={{ fontWeight: "var(--weight-bold)", fontSize: size / 5.5, color, lineHeight: "var(--lh-tight)" }}
        >
          {Math.round(p * 100)}
          <span style={{ fontSize: size / 13, color: "var(--text-muted)" }}>%</span>
        </div>
        <div
          style={{
            fontSize: "var(--fs-micro)",
            letterSpacing: "var(--tracking-wide)",
            color: "var(--text-2)",
            textTransform: "uppercase",
            marginTop: 2,
          }}
        >
          P(+EV)
        </div>
      </div>
    </div>
  );
}

/* ── Model-vs-market duel ──────────────────────────────── */
export function DuelBar({ model, market, lower, upper }: { model: number; market: number; lower: number; upper: number }) {
  const lo = Math.min(model, market) - 0.06;
  const hi = Math.max(model, market) + 0.06;
  const span = hi - lo || 1;
  const xOf = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  const ciL = xOf(market + lower);
  const ciW = `${(Math.max(0, ((upper - lower) / span) * 100)).toFixed(1)}%`;
  const edge = model - market;
  const col = edge >= 0 ? "var(--pos)" : "var(--neg)";
  return (
    <div>
      <div className="duel" style={{ "--w": "100%" } as React.CSSProperties}>
        {/* 95% credible interval band */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: ciL,
            width: ciW,
            background: "var(--lean-tint)",
            borderLeft: "1px dashed var(--lean)",
            borderRight: "1px dashed var(--lean)",
          }}
        />
        {/* market tick */}
        <div className="duel-tick" style={{ left: xOf(market), background: "var(--text-2)", boxShadow: "0 0 6px var(--text-2)" }} />
        {/* model tick */}
        <div className="duel-tick" style={{ left: xOf(model), background: col, boxShadow: `0 0 7px ${col}` }} />
      </div>
      <div
        className="num"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "var(--sp-1)",
          fontSize: "var(--fs-micro)",
          color: "var(--text-2)",
        }}
      >
        <span>market {pct(market)}</span>
        <span style={{ color: col, fontWeight: "var(--weight-bold)" }}>edge {signed(edge)}</span>
        <span>model {pct(model)}</span>
      </div>
    </div>
  );
}

/* ── HUD readout chip ──────────────────────────────────── */
export function HudChip({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="hud-chip">
      <span className="k">{k}</span>
      <span className="v num" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

/* ── Devig-engine method comparison ────────────────────── */
export function MethodCompare({ a }: { a: GameAnalysis }) {
  const naiveEdge = a.q_edge_naive;
  const quantEdge = a.q_edge_quant;
  const collapsed = naiveEdge - quantEdge;
  return (
    <div>
      <SectionHeader>Devig engine · naive vs quant</SectionHeader>
      <div className="vs-grid">
        <div className="vs-col naive">
          <div
            style={{
              fontSize: "var(--fs-caption)",
              fontWeight: "var(--weight-bold)",
              color: "var(--text-2)",
              letterSpacing: "var(--tracking-label)",
              textTransform: "uppercase",
            }}
          >
            Naive theory
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", marginBottom: "var(--sp-2)" }}>
            proportional devig · point estimate · ¼-Kelly
          </div>
          <Row k="vig-free implied" v={pct(a.q_prop_vig_free)} />
          <Row k="edge (point)" v={signed(naiveEdge)} c={naiveEdge >= 0 ? "var(--pos)" : "var(--neg)"} />
          <Row k="confidence" v="— none —" c="var(--text-muted)" />
          <Row k="Kelly mult" v="0.25 fixed" c="var(--text-muted)" />
        </div>
        <div className="vs-spine"><span>VS</span></div>
        <div className="vs-col quant">
          <div
            style={{
              fontSize: "var(--fs-caption)",
              fontWeight: "var(--weight-bold)",
              color: "var(--pos)",
              letterSpacing: "var(--tracking-label)",
              textTransform: "uppercase",
            }}
          >
            Quant model
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", marginBottom: "var(--sp-2)" }}>
            Shin devig · Bayesian shrink · posterior Kelly
          </div>
          <Row k={`Shin vig-free (z=${a.q_shin_z.toFixed(3)})`} v={pct(a.q_shin_vig_free)} />
          <Row k="edge (shrunk)" v={signed(quantEdge)} c={quantEdge >= 0 ? "var(--pos)" : "var(--neg)"} />
          <Row k="P(edge > 0)" v={pct(a.q_prob_positive)} c={pPlusColor(a.q_prob_positive)} />
          <Row k="Kelly mult (derived)" v={a.q_kelly_mult.toFixed(3)} c="var(--lean)" />
        </div>
      </div>
      <div
        style={{
          marginTop: "var(--sp-2)",
          fontFamily: "var(--font-body)",
          fontSize: "var(--fs-meta)",
          color: "var(--text-2)",
          paddingLeft: "var(--sp-2)",
          borderLeft: "2px solid var(--warn)",
          lineHeight: "var(--lh-prose)",
        }}
      >
        Shrinkage collapsed the naive edge by{" "}
        <strong className="num" style={{ color: "var(--warn)" }}>{signed(collapsed)}</strong>{" "}
        — the market prior is doing its job. You bet{" "}
        <strong className="num" style={{ color: pPlusColor(a.q_prob_positive) }}>{pct(a.q_prob_positive)}</strong>{" "}
        confidence the edge is real, not a point guess.
      </div>
    </div>
  );
}

function Row({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "var(--sp-1) 0",
      }}
    >
      <span
        style={{
          fontSize: "var(--fs-caption)",
          color: "var(--text-2)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
        }}
      >
        {k}
      </span>
      <span className="num" style={{ fontWeight: "var(--weight-bold)", color: c ?? "var(--text)" }}>{v}</span>
    </div>
  );
}

/* ── Growth-rate readout ───────────────────────────────── */
export function GrowthReadout({ a }: { a: GameAnalysis }) {
  const g = a.q_growth_rate;
  const dbl = a.q_doubling_bets;
  return (
    <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-2)" }}>
      <HudChip k="EV / $1" v={`${a.ev_per_dollar >= 0 ? "+" : ""}${(a.ev_per_dollar * 100).toFixed(1)}¢`} color={a.ev_per_dollar >= 0 ? "var(--pos)" : "var(--neg)"} />
      <HudChip k="log-growth / bet" v={g > 0 ? `+${(g * 100).toFixed(2)}%` : "0.00%"} color={g > 0 ? "var(--pos)" : "var(--text-2)"} />
      <HudChip k="2× bankroll in" v={dbl > 0 ? `${dbl} bets` : "—"} color={dbl > 0 ? "var(--lean)" : "var(--text-2)"} />
      <HudChip k="stake (Kelly)" v={pct(a.q_kelly_sized, 2)} color="var(--purple)" />
    </div>
  );
}
