"use client";

import { useEffect, useState } from "react";
import { api, type QuantVerify } from "@/lib/api";
import { Gauge, DuelBar, HudChip, pPlusColor } from "@/components/quant";
import { ExplainTooltip } from "@/components/explain";
import { NumberField, ErrorBanner } from "@/components/ui";
import { tierColor } from "@/lib/visual-tokens";

function Formula({ title, body, plug, term }: { title: string; body: string; plug: string; term?: string }) {
  return (
    <div style={{ marginBottom: "18px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
        {title}
        {term && <ExplainTooltip term={term} />}
      </div>
      <div className="formula-block">{body}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--pos)", marginTop: "6px", paddingLeft: "8px", borderLeft: "2px solid var(--pos)" }}>{plug}</div>
    </div>
  );
}

const pc = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

export default function VerifyPage() {
  const [modelProb, setModelProb] = useState(58);
  const [sideOdds, setSideOdds] = useState(-130);
  const [otherOdds, setOtherOdds] = useState(110);
  const [evidence, setEvidence] = useState(75);
  const [q, setQ] = useState<QuantVerify | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      const mp = Math.min(0.99, Math.max(0.01, modelProb / 100));
      api.quantVerify(mp, sideOdds, otherOdds, evidence / 100).then((r) => {
        if (r === null) { setErr(true); return; }
        setErr(false); setQ(r);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [modelProb, sideOdds, otherOdds, evidence]);

  // Single-sourced through the typed token map (STRONG LEAN→pos, LEAN→lean,
  // PASS→text-2, AVOID→neg, NEED MORE INFO→warn) — same vocabulary as every
  // other page, now on the Abyssal signal palette.
  const tc = q ? tierColor(q.recommendation) : "var(--text-2)";

  return (
    <div>
      <div className="infield-divider" style={{ marginBottom: "22px", paddingBottom: "16px" }}>
        <h1 style={{ fontFamily: "var(--font-display-serif)", fontWeight: "var(--weight-display)", fontSize: "22px", letterSpacing: "0", margin: 0, textTransform: "uppercase", color: "var(--text)" }}>
          Bet Verifier
        </h1>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)", marginTop: "4px" }}>
          Live quant pipeline · Shin devig → Bayesian shrink → edge posterior → uncertainty Kelly
        </div>
      </div>

      <div className="responsive-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sp-3)", marginBottom: "var(--sp-5)" }}>
        <NumberField label="Model win %" value={modelProb} onChange={(v) => setModelProb(parseFloat(v))} hint="your model's prob for the side" />
        <NumberField label="Side odds (American)" value={sideOdds} onChange={(v) => setSideOdds(parseFloat(v))} step={5} hint="the line you'd bet" />
        <NumberField label="Opponent odds" value={otherOdds} onChange={(v) => setOtherOdds(parseFloat(v))} step={5} hint="needed to devig" />
        <NumberField label="Evidence quality %" value={evidence} onChange={(v) => setEvidence(parseFloat(v))} step={5} hint="data completeness 0–100" />
      </div>

      {err && (
        <ErrorBanner
          kind="outage"
          detail="Unable to reach the calculation service. Try refreshing in a moment."
        />
      )}

      {q && (
        <>
          <div className="verdict-slab" style={{ "--slab-color": tc, marginBottom: "20px" } as React.CSSProperties}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "20px", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "32px", fontWeight: "var(--weight-display)", color: tc, textTransform: "uppercase", lineHeight: 1 }}>
                  {q.recommendation}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-2)", marginTop: "6px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                  model{" "}
                  <span className="scoreboard-num" style={{ fontSize: "13px", color: "var(--text)" }}>{pc(q.p_model)}</span>{" "}
                  →{" "}
                  <ExplainTooltip term="bayesian-shrinkage">
                    <span>shrunk</span>
                  </ExplainTooltip>{" "}
                  <span className="scoreboard-num" style={{ fontSize: "13px", color: "var(--text)" }}>{pc(q.p_shrunk)}</span>{" "}
                  vs{" "}
                  <ExplainTooltip term="shin-devig">
                    <span>Shin market</span>
                  </ExplainTooltip>{" "}
                  <span className="scoreboard-num" style={{ fontSize: "13px", color: "var(--text)" }}>{pc(q.shin_vig_free)}</span>
                </div>
                <div style={{ marginTop: "14px" }}>
                  <DuelBar model={q.p_shrunk} market={q.shin_vig_free} lower={q.ci_low} upper={q.ci_high} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <Gauge p={q.prob_positive} size={144} />
              </div>
            </div>
            <div
              className="section-label"
              style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px", marginBottom: "8px", flexWrap: "wrap" }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                P(+EV)
                <ExplainTooltip term="p-plus-ev" />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                Log-growth
                <ExplainTooltip term="expected-log-growth" />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                Doubling
                <ExplainTooltip term="doubling-time" />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                Kelly
                <ExplainTooltip term="uncertainty-kelly" />
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                Vig
                <ExplainTooltip term="vig-overround" />
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
              <HudChip k="EV / $1" v={`${q.ev_per_dollar >= 0 ? "+" : ""}${(q.ev_per_dollar * 100).toFixed(1)}¢`} color={q.ev_per_dollar >= 0 ? "var(--pos)" : "var(--neg)"} />
              <HudChip k="honest edge" v={`${q.edge_quant >= 0 ? "+" : ""}${(q.edge_quant * 100).toFixed(2)}%`} color={q.edge_quant >= 0 ? "var(--pos)" : "var(--neg)"} />
              <HudChip k="log-growth / bet" v={q.growth_rate > 0 ? `+${(q.growth_rate * 100).toFixed(3)}%` : "0%"} color={q.growth_rate > 0 ? "var(--pos)" : "var(--text-muted)"} />
              <HudChip k="Kelly stake" v={pc(q.kelly_sized, 2)} color="var(--purple)" />
            </div>
          </div>

          <div className="vs-grid" style={{ marginBottom: "8px" }}>
            <div className="vs-col naive">
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Sonnet 4.6 theory</div>
              <div style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 10 }}>proportional devig · point edge · ¼-Kelly</div>
              <Cmp k="vig-free implied" v={pc(q.prop_vig_free)} />
              <Cmp k="edge" v={`${q.edge_naive >= 0 ? "+" : ""}${(q.edge_naive * 100).toFixed(2)}%`} c={q.edge_naive >= 0 ? "var(--pos)" : "var(--neg)"} />
              <Cmp k="confidence in edge" v="not modeled" c="var(--text-muted)" />
              <Cmp k="Kelly mult" v="0.25 (assumed)" c="var(--text-muted)" />
            </div>
            <div className="vs-spine"><span>VS</span></div>
            <div className="vs-col quant">
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pos)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Opus 4.7 quant</div>
              <div style={{ fontSize: 10, color: "var(--text-2)", marginBottom: 10 }}>Shin devig · Bayesian shrink · posterior Kelly</div>
              <Cmp k={`Shin vig-free (z=${q.shin_z.toFixed(3)})`} v={pc(q.shin_vig_free)} />
              <Cmp k="edge (shrunk)" v={`${q.edge_quant >= 0 ? "+" : ""}${(q.edge_quant * 100).toFixed(2)}%`} c={q.edge_quant >= 0 ? "var(--pos)" : "var(--neg)"} />
              <Cmp k="P(edge > 0)" v={pc(q.prob_positive)} c={pPlusColor(q.prob_positive)} />
              <Cmp k="Kelly mult (derived)" v={q.kelly_multiplier.toFixed(3)} c="var(--lean)" />
            </div>
          </div>
          <div style={{ marginBottom: "26px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)", paddingLeft: 8, borderLeft: "2px solid var(--warn)" }}>
            Naive devig + point edge would tell you to bet <strong style={{ color: "var(--warn)" }}>{(q.edge_naive * 100).toFixed(2)}%</strong>.
            The quant path strips the favorite–longshot bias, shrinks the lone model toward the market, and prices in estimation noise —
            leaving an honest <strong style={{ color: q.edge_quant >= 0 ? "var(--pos)" : "var(--neg)" }}>{(q.edge_quant * 100).toFixed(2)}%</strong> you are{" "}
            <strong style={{ color: pPlusColor(q.prob_positive) }}>{pc(q.prob_positive)}</strong> sure is real.
          </div>

          <div className="section-label">The math — your numbers plugged in</div>

          <Formula
            title="1 · Shin devig (favorite–longshot correction)"
            term="shin-devig"
            body={`r_i = 1/decimal_odds_i ,  B = Σ r_i\np_i(z) = [ √( z² + 4(1−z)·r_i²/B ) − z ] / ( 2(1−z) )\nsolve z so Σ p_i = 1`}
            plug={`B = ${q.booksum.toFixed(4)} (overround) · z = ${q.shin_z.toFixed(4)} insider proportion → Shin fair = ${pc(q.shin_vig_free)} (proportional said ${pc(q.prop_vig_free)})`}
          />
          <Formula
            title="2 · Bayesian shrinkage toward the market prior"
            term="bayesian-shrinkage"
            body={`logit(p*) = w·logit(p_model) + (1−w)·logit(p_market)\nw = evidence quality`}
            plug={`w = ${q.shrink_weight.toFixed(2)} → ${pc(q.p_model)} pulled to ${pc(q.p_shrunk)} (a lone model rarely beats a liquid market by much)`}
          />
          <Formula
            title="3 · Edge as a posterior, not a point"
            term="p-plus-ev"
            body={`Var(p) ≈ p(1−p)/(N+1) ,  N = 60·evidence\nP(edge>0) = Φ( edge_mean / SD )`}
            plug={`N_eff = ${q.effective_n} · SD = ${(q.edge_sd * 100).toFixed(2)}% · 95% CI [${(q.ci_low * 100).toFixed(1)}%, ${(q.ci_high * 100).toFixed(1)}%] · P(+) = ${pc(q.prob_positive)}`}
          />
          <Formula
            title="4 · Uncertainty-adjusted Kelly + log-growth"
            term="uncertainty-kelly"
            body={`f = f_full · g²/(g²+σ²)  , capped at ¼\ng_rate = p·ln(1+b·f) + q·ln(1−f)`}
            plug={`f_full = ${pc(q.kelly_full, 2)} · derived mult = ${q.kelly_multiplier.toFixed(3)} → stake ${pc(q.kelly_sized, 2)} · growth ${q.growth_rate > 0 ? "+" : ""}${(q.growth_rate * 100).toFixed(3)}%/bet${q.doubling_bets ? ` · 2× in ${q.doubling_bets} bets` : ""}`}
          />

          <div
            className="infield-divider"
            style={{ marginTop: "8px", paddingTop: "16px", marginBottom: "10px", borderBottom: "none" }}
          >
            <div className="section-label" style={{ margin: 0 }}>
              How this verdict is graded over time
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--text-2)",
              lineHeight: 1.6,
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 18px",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              Forecast accuracy is scored by
              <ExplainTooltip term="brier-score">
                <strong style={{ color: "var(--text)" }}>Brier score</strong>
              </ExplainTooltip>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              and checked for
              <ExplainTooltip term="calibration">
                <strong style={{ color: "var(--text)" }}>calibration</strong>
              </ExplainTooltip>
              on the Track Record page.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Cmp({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 10, color: "var(--text-2)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{k}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: c ?? "var(--text)" }}>{v}</span>
    </div>
  );
}
