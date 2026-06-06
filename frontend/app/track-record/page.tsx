"use client";

import { useEffect, useState } from "react";
import {
  api,
  todayET,
  type CalibrationBucket,
  type TierHitRate,
  type TrackRecordResult,
  type TrackRecordClv,
} from "@/lib/api";
import { ExplainTooltip } from "@/components/explain";
import { tierColor } from "@/lib/visual-tokens";
import {
  Card,
  Panel,
  StatCell,
  StatGroup,
  SemanticValue,
  Accruing,
  SampleSize,
  DateField,
  SectionHeader,
  ErrorBanner,
  Skeleton,
  Tabs,
  TabPanel,
  type TabItem,
} from "@/components/ui";

/* ── date helpers ──────────────────────────────────────── */
/* ET-based dates (todayET) — fixes the old toISOString() UTC off-by-one. */
function offsetEtDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/* ── shared chart frame (Panel with clay infield-divider header) ─────────── */
function ChartFrame({
  title,
  term,
  children,
}: {
  title: string;
  term?: string;
  children: React.ReactNode;
}) {
  return (
    <Panel
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <span
            style={{
              fontSize: "var(--fs-caption)",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "var(--tracking-label)",
              textTransform: "uppercase",
              color: "var(--text-2)",
            }}
          >
            {title}
          </span>
          {term && <ExplainTooltip term={term} />}
        </span>
      }
    >
      {children}
    </Panel>
  );
}

/* ── 1 · Calibration ───────────────────────────────────── */
function CalibrationChart({ buckets }: { buckets: CalibrationBucket[] }) {
  const live = buckets.filter((b) => b.n > 0 && b.actual_win_rate != null);
  if (live.length === 0) {
    return (
      <Accruing note="No completed games with a HOME/AWAY lean in this range yet.">
        <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>
          Calibration accruing
        </span>
      </Accruing>
    );
  }

  const W = 480;
  const H = 260;
  const pad = { l: 42, r: 16, t: 16, b: 34 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  // X: predicted 50–100%, Y: actual 0–100%
  const xOf = (p: number) => pad.l + ((p - 0.5) / 0.5) * plotW;
  const yOf = (a: number) => pad.t + (1 - a) * plotH;
  const maxN = Math.max(...live.map((b) => b.n), 1);

  return (
    <svg
      className="chart-draw"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Calibration chart: predicted win rate versus observed win rate, with a diagonal perfect-calibration reference line."
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {/* grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={`y${t}`}>
          <line x1={pad.l} y1={yOf(t)} x2={W - pad.r} y2={yOf(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 8} y={yOf(t) + 3} textAnchor="end" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-3)">
            {(t * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {[0.5, 0.625, 0.75, 0.875, 1].map((p) => (
        <text key={`x${p}`} x={xOf(p)} y={H - 12} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-3)">
          {(p * 100).toFixed(0)}%
        </text>
      ))}
      {/* perfect-calibration reference */}
      <line
        x1={xOf(0.5)}
        y1={yOf(0.5)}
        x2={xOf(1)}
        y2={yOf(1)}
        stroke="var(--text-3)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <text x={xOf(0.93)} y={yOf(0.99)} fontSize={8} fontFamily="var(--font-mono)" fill="var(--text-3)">
        perfect
      </text>
      {/* bucket points */}
      {live.map((b) => {
        const r = 4 + Math.sqrt(b.n / maxN) * 9;
        const cx = xOf(b.midpoint);
        const cy = yOf(b.actual_win_rate as number);
        const off = Math.abs((b.actual_win_rate as number) - b.midpoint);
        const col = off <= 0.05 ? "var(--pos)" : off <= 0.12 ? "var(--warn)" : "var(--neg)";
        return (
          <g key={b.midpoint}>
            <circle cx={cx} cy={cy} r={r} fill={col} fillOpacity={0.22} stroke={col} strokeWidth={1.5} />
            <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={8} fontFamily="var(--font-mono)" fill="var(--text-2)">
              n={b.n}
            </text>
          </g>
        );
      })}
      {/* axis titles */}
      <text x={pad.l + plotW / 2} y={H - 1} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-2)">
        predicted win rate
      </text>
      <text
        x={12}
        y={pad.t + plotH / 2}
        textAnchor="middle"
        fontSize={9}
        fontFamily="var(--font-mono)"
        fill="var(--text-2)"
        transform={`rotate(-90 12 ${pad.t + plotH / 2})`}
      >
        observed win rate
      </text>
    </svg>
  );
}

/* ── 2 · Tier hit rate ─────────────────────────────────── */
const TIER_ORDER = ["STRONG LEAN", "LEAN", "PASS", "AVOID"];

function TierHitRateChart({ rows }: { rows: TierHitRate[] }) {
  const byTier = new Map(rows.map((r) => [r.tier, r]));
  const ordered = TIER_ORDER.map((t) => byTier.get(t) ?? { tier: t, n: 0, hit_rate: null });
  const anyLive = ordered.some((r) => r.n > 0);
  if (!anyLive) {
    return (
      <Accruing note="Tier hit rate populates once completed games carry a tier label.">
        <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>
          No graded picks yet
        </span>
      </Accruing>
    );
  }

  const W = 480;
  const rowH = 38;
  const H = ordered.length * rowH + 24;
  const labelW = 110;
  const trackX = labelW + 8;
  const trackW = W - trackX - 56;

  return (
    <svg
      className="chart-draw"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Horizontal bar chart of hit rate per recommendation tier, with sample size per tier."
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {ordered.map((r, i) => {
        const y = 14 + i * rowH;
        const cy = y + rowH / 2 - 7;
        const col = tierColor(r.tier);
        const hasData = r.n > 0 && r.hit_rate != null;
        const w = hasData ? (r.hit_rate as number) * trackW : 0;
        return (
          <g key={r.tier}>
            <text x={labelW} y={cy + 3} textAnchor="end" fontSize={10} fontFamily="var(--font-mono)" fontWeight={700} fill={col}>
              {r.tier}
            </text>
            <rect x={trackX} y={cy - 8} width={trackW} height={16} fill="var(--surface-3)" rx={2} />
            {hasData ? (
              <rect x={trackX} y={cy - 8} width={w} height={16} fill={col} fillOpacity={0.85} rx={2} />
            ) : (
              <rect
                x={trackX}
                y={cy - 8}
                width={trackW}
                height={16}
                fill="none"
                stroke="var(--border)"
                strokeDasharray="3 3"
                rx={2}
              />
            )}
            {/* 50% reference */}
            <line x1={trackX + trackW * 0.5} y1={cy - 12} x2={trackX + trackW * 0.5} y2={cy + 12} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 2" />
            <text x={trackX + trackW + 6} y={cy + 3} fontSize={10} fontFamily="var(--font-mono)" fontWeight={700} fill={hasData ? "var(--text)" : "var(--text-3)"}>
              {hasData ? `${((r.hit_rate as number) * 100).toFixed(0)}%` : "—"}
            </text>
            <text x={trackX + trackW + 6} y={cy + 15} fontSize={8} fontFamily="var(--font-mono)" fill="var(--text-3)">
              [{r.n}]
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── 3 · P&L line (single realized series) ─────────────── */
function linePath(values: number[], xOf: (i: number) => number, yOf: (v: number) => number): string {
  return values.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(2)} ${yOf(v).toFixed(2)}`).join(" ");
}

function PLLineChart({ series }: { series: number[] }) {
  if (series.length === 0) {
    return (
      <Accruing note="P&L simulation needs at least one completed game with a HOME/AWAY lean.">
        <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>
          No P&L history
        </span>
      </Accruing>
    );
  }

  const W = 480;
  const H = 220;
  const pad = { l: 44, r: 14, t: 16, b: 30 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const all = [...series, 0];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const n = series.length;
  const xOf = (i: number) => pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yOf = (v: number) => pad.t + (1 - (v - min) / span) * plotH;

  const yTicks = 4;
  return (
    <svg
      className="chart-draw"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Cumulative realized profit and loss in units per settled game, with a zero baseline."
      style={{ width: "100%", height: "auto", display: "block" }}
    >
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = min + (span * i) / yTicks;
        const y = yOf(v);
        return (
          <g key={i}>
            <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 8} y={y + 3} textAnchor="end" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-3)">
              {v >= 0 ? "+" : ""}{v.toFixed(1)}
            </text>
          </g>
        );
      })}
      {/* zero baseline */}
      {min < 0 && max > 0 && (
        <line x1={pad.l} y1={yOf(0)} x2={W - pad.r} y2={yOf(0)} stroke="var(--text-3)" strokeWidth={1} strokeDasharray="4 4" />
      )}
      {/* x ticks */}
      {[0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
        <text key={i} x={xOf(i)} y={H - 10} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-3)">
          {i + 1}
        </text>
      ))}
      <path d={linePath(series, xOf, yOf)} fill="none" stroke="var(--lean)" strokeWidth={1.6} />
      {n === 1 && <circle cx={xOf(0)} cy={yOf(series[0])} r={3} fill="var(--lean)" />}
      {/* single realized series — flat/Kelly legend retired (one true money line) */}
      <text x={pad.l + plotW / 2} y={H - 1} textAnchor="middle" fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-2)">
        settled game #
      </text>
    </svg>
  );
}

/* ── Brier readout ─────────────────────────────────────── */
function BrierReadout({ brier }: { brier: number | null }) {
  if (brier === null) {
    return (
      <Accruing note="Needs at least one completed game to score the forecast.">
        <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>
          Brier score accruing
        </span>
      </Accruing>
    );
  }
  const baseline = 0.25;
  const col = brier < baseline ? "var(--pos)" : brier > baseline ? "var(--neg)" : "var(--warn)";
  // visual scale: 0 (best) → 0.5 (worst); clamp
  const scale = (v: number) => `${Math.max(0, Math.min(100, (v / 0.5) * 100))}%`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-3)", marginBottom: "var(--sp-4)" }}>
        <span className="scoreboard-num" style={{ fontSize: "var(--fs-hero)", color: col, lineHeight: 0.9 }}>
          {brier.toFixed(4)}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)", paddingBottom: "var(--sp-1)" }}>
          {brier < baseline ? "better than a coin flip" : brier > baseline ? "worse than a coin flip" : "coin-flip equivalent"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: "var(--text-2)", width: "92px", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>
            Model
          </span>
          <div className="stat-bar-track" style={{ flex: 1, height: "6px" }}>
            <div className="stat-bar-fill" style={{ "--fill": scale(brier), background: col } as React.CSSProperties} />
          </div>
          <span className="num" style={{ fontSize: "var(--fs-meta)", color: col, fontWeight: "var(--weight-bold)", width: "52px", textAlign: "right" }}>
            {brier.toFixed(4)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: "var(--text-2)", width: "92px", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>
            Coin flip
          </span>
          <div className="stat-bar-track" style={{ flex: 1, height: "6px" }}>
            <div className="stat-bar-fill" style={{ "--fill": scale(baseline), background: "var(--text-3)" } as React.CSSProperties} />
          </div>
          <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", fontWeight: "var(--weight-bold)", width: "52px", textAlign: "right" }}>
            0.2500
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Surface the live-vs-replay-vs-null split on the calibration section.
 *
 * Calibration is computed *only* on rows where model_prob is set. We must be
 * loud about which subset that is, because:
 *   - "live" rows = model state captured at the moment of the pick (truth)
 *   - "replay-*" rows = model state re-derived by running today's code over
 *     the historical game; an approximation, not the original model output
 *   - "null" rows = picks created before snapshot capture shipped; excluded
 *     from calibration entirely
 *
 * A user defending +EV claims based on calibration needs this distinction.
 */
function CalibrationCoverageNote({
  coverage,
}: {
  coverage: { source: string; n: number }[];
}) {
  const live = coverage.find((c) => c.source === "live")?.n ?? 0;
  const replay = coverage
    .filter((c) => c.source.startsWith("replay-") && !c.source.endsWith("no-odds"))
    .reduce((s, c) => s + c.n, 0);
  const replayNoOdds = coverage
    .filter((c) => c.source.endsWith("-no-odds"))
    .reduce((s, c) => s + c.n, 0);
  const nullN = coverage.find((c) => c.source === "null")?.n ?? 0;
  const total = live + replay + replayNoOdds + nullN;
  if (total === 0) return null;
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-caption)",
        color: "var(--text-2)",
        marginBottom: "var(--sp-3)",
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--sp-3)",
        alignItems: "center",
      }}
    >
      <span style={{ color: "var(--text-2)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase" }}>
        Snapshot coverage:
      </span>
      <span>
        <strong style={{ color: "var(--pos)" }}>{live}</strong> live
      </span>
      {replay > 0 && (
        <span>
          <strong style={{ color: "var(--warn)" }}>{replay}</strong> replay-backfilled
        </span>
      )}
      {replayNoOdds > 0 && (
        <span style={{ color: "var(--text-muted)" }}>
          <strong>{replayNoOdds}</strong> replay (no odds)
        </span>
      )}
      {nullN > 0 && (
        <span style={{ color: "var(--text-muted)" }}>
          <strong>{nullN}</strong> pre-capture (excluded)
        </span>
      )}
      <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
        live = captured at pick time; replay = re-derived from today&apos;s model code
      </span>
    </div>
  );
}

/* ── CLV (closing-line value) — the strongest evidence of genuine edge ───────
 *
 * Beating the closing line is the sharpest, least-luck-dependent signal that a
 * model has real edge: it says the price we took was better than where the
 * market ultimately settled, independent of whether any single bet won. We
 * lead with "% beat close" and pair every number with an honest coverage line.
 * When no pre-first-pitch close was captured, that bet is simply excluded —
 * nothing is fabricated.
 */
function fmtPct1(v: number | null | undefined, withSign = false): string {
  if (v == null) return "—";
  const pct = v * 100;
  const sign = withSign && pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function ClvSliceBars({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; n_eligible: number; pct_beat_close: number | null; avg_clv_pct: number | null }[];
}) {
  const live = rows.filter((r) => r.n_eligible > 0);
  if (live.length === 0) return null;
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-caption)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
          marginBottom: "var(--sp-2)",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {live.map((r) => {
          const pct = r.pct_beat_close;
          const col = pct == null ? "var(--text-muted)" : pct >= 0.5 ? "var(--pos)" : "var(--neg)";
          const w = pct == null ? 0 : Math.max(0, Math.min(1, pct)) * 100;
          return (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-2)",
                  width: "92px",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-label)",
                }}
              >
                {r.key}
              </span>
              <div className="stat-bar-track" style={{ flex: 1, height: "6px" }}>
                <div
                  className="stat-bar-fill"
                  style={{ "--fill": `${w}%`, background: col } as React.CSSProperties}
                />
              </div>
              <span
                className="num"
                style={{ fontSize: "var(--fs-meta)", color: col, fontWeight: "var(--weight-bold)", width: "48px", textAlign: "right" }}
              >
                {fmtPct1(pct)}
              </span>
              <span
                className="num"
                style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", width: "70px", textAlign: "right" }}
                title="Average CLV in prob-points for this slice"
              >
                {fmtPct1(r.avg_clv_pct, true)} avg
              </span>
              <SampleSize n={r.n_eligible} style={{ width: "34px", textAlign: "right" }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* CLV vs result — beat-the-close decoupled from win/loss. Honesty: CLV edge can
 * be real even when a single bet loses (and vice versa); show the 2×2 split. */
function ClvVsResult({ v }: { v: TrackRecordClv["clv_vs_result"] }) {
  const total = v.beat_and_won + v.beat_and_lost + v.missed_and_won + v.missed_and_lost;
  if (total === 0) return null;
  const cells: { label: string; n: number; color: string }[] = [
    { label: "Beat close · won", n: v.beat_and_won, color: "var(--pos)" },
    { label: "Beat close · lost", n: v.beat_and_lost, color: "var(--text-2)" },
    { label: "Missed close · won", n: v.missed_and_won, color: "var(--text-2)" },
    { label: "Missed close · lost", n: v.missed_and_lost, color: "var(--neg)" },
  ];
  return (
    <div style={{ marginTop: "var(--sp-3)" }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-caption)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
          marginBottom: "var(--sp-2)",
        }}
      >
        CLV vs. result
      </div>
      <StatGroup min="130px">
        {cells.map((c) => (
          <StatCell key={c.label} label={c.label} value={c.n} color={c.color} emphasis="data" />
        ))}
      </StatGroup>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", color: "var(--text-muted)", marginTop: "var(--sp-2)" }}>
        Beating the close is the edge signal; the win/loss split shows variance around it.
      </div>
    </div>
  );
}

function ClvBlock({ clv }: { clv: TrackRecordClv | null | undefined }) {
  const cov = clv?.clv_coverage;
  const nWith = cov?.n_with_clv ?? clv?.n_eligible ?? 0;
  const nSettled = cov?.n_settled ?? 0;

  // No eligible bets with a captured close → be honest, render nothing fake.
  if (!clv || nWith === 0) {
    return (
      <ChartFrame title="Closing-line value (beat the close)">
        <Accruing
          note={
            nSettled > 0
              ? `No pre-first-pitch closing line captured for any of the ${nSettled} settled pick${nSettled === 1 ? "" : "s"} yet. CLV appears once a close is recorded; nothing is fabricated.`
              : "Closing-line value populates once settled picks have a captured pre-first-pitch close."
          }
        >
          <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>
            CLV accruing
          </span>
        </Accruing>
      </ChartFrame>
    );
  }

  const pctBeat = clv.pct_beat_close;

  const tierRows = (clv.clv_by_tier ?? []).map((t) => ({
    key: t.tier,
    n_eligible: t.n_eligible,
    pct_beat_close: t.pct_beat_close,
    avg_clv_pct: t.avg_clv_pct,
  }));
  const marketRows = (clv.clv_by_market ?? []).map((m) => ({
    key: m.market === "moneyline" ? "Moneyline" : m.market === "total" ? "Over/Under" : m.market,
    n_eligible: m.n_eligible,
    pct_beat_close: m.pct_beat_close,
    avg_clv_pct: m.avg_clv_pct,
  }));

  return (
    <ChartFrame title="Closing-line value (beat the close)">
      {/* Honest framing: CLV is the strongest edge signal, but only over the
          subset of bets with a captured close. */}
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--fs-body)",
          color: "var(--text-2)",
          lineHeight: "var(--lh-prose)",
          marginBottom: "var(--sp-4)",
        }}
      >
        Beating the closing line is the strongest evidence of genuine edge —
        it shows the price taken was better than where the market settled,
        independent of any single result.
      </div>

      {/* Headline metrics */}
      <StatGroup min="130px" style={{ marginBottom: "var(--sp-3)" }}>
        <StatCell
          label="% Beat close"
          value={fmtPct1(pctBeat)}
          color={pctBeat == null ? "var(--text-muted)" : pctBeat >= 0.5 ? "var(--pos)" : "var(--neg)"}
        />
        <StatCell
          label="Avg CLV"
          value={fmtPct1(clv.avg_clv_pct, true)}
          color={clv.avg_clv_pct == null ? "var(--text-muted)" : clv.avg_clv_pct >= 0 ? "var(--pos)" : "var(--neg)"}
        />
        <StatCell
          label="Median CLV"
          value={fmtPct1(clv.median_clv_pct, true)}
          color={clv.median_clv_pct == null ? "var(--text-muted)" : clv.median_clv_pct >= 0 ? "var(--pos)" : "var(--neg)"}
        />
        <StatCell label="Beat / eligible" value={`${clv.beat_close_n}/${clv.n_eligible}`} />
      </StatGroup>

      {/* % beat-close Wilson CI */}
      {pctBeat != null &&
        clv.pct_beat_close_ci_low != null &&
        clv.pct_beat_close_ci_high != null && (
          <Card
            variant="inset"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              color: "var(--text-2)",
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "var(--sp-2)",
              marginBottom: "var(--sp-3)",
            }}
          >
            <span>
              95% CI on % beat close:{" "}
              <strong className="num" style={{ color: "var(--text)" }}>
                {fmtPct1(clv.pct_beat_close_ci_low)} – {fmtPct1(clv.pct_beat_close_ci_high)}
              </strong>{" "}
              (Wilson, n={clv.n_eligible})
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              50% = no edge vs. the close
            </span>
          </Card>
        )}

      {/* Per-tier and per-market slices */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)", marginBottom: "var(--sp-3)" }}
        className="responsive-grid-2"
      >
        <ClvSliceBars title="By tier" rows={tierRows} />
        <ClvSliceBars title="By market" rows={marketRows} />
      </div>

      {/* CLV decoupled from win/loss outcome */}
      <ClvVsResult v={clv.clv_vs_result} />

      {/* Honest coverage line */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-caption)",
          color: "var(--text-muted)",
          lineHeight: "var(--lh-prose)",
          paddingLeft: "var(--sp-2)",
          borderLeft: "2px solid var(--clay)",
          marginTop: "var(--sp-3)",
        }}
      >
        CLV available for <strong style={{ color: "var(--text-2)" }}>{nWith}</strong> of{" "}
        <strong style={{ color: "var(--text-2)" }}>{nSettled}</strong> settled tracked picks
        {cov?.coverage_pct != null && (
          <> ({(cov.coverage_pct * 100).toFixed(0)}% coverage)</>
        )}
        .
        {cov && cov.n_no_close_captured > 0 && (
          <> {cov.n_no_close_captured} had no pre-first-pitch close captured (excluded — never fabricated).</>
        )}
        {cov && cov.n_one_sided > 0 && (
          <> {cov.n_one_sided} had a one-sided close.</>
        )}
        {cov && cov.n_total_line_mismatch > 0 && (
          <> {cov.n_total_line_mismatch} had a total-line mismatch.</>
        )}{" "}
        The close is the last market snapshot strictly before first pitch; live
        in-game prices are never used.
      </div>
    </ChartFrame>
  );
}

export default function TrackRecordPage() {
  // Default: cover the entire tracked history. The endpoint reads BetRecord
  // rows (162-ish), not a model replay, so any window is cheap. ET-based dates
  // (todayET) avoid the old UTC toISOString() off-by-one.
  const [start, setStart] = useState(() => offsetEtDay(todayET(), -90));
  const [end, setEnd] = useState(() => todayET());
  const [result, setResult] = useState<TrackRecordResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [section, setSection] = useState("performance");

  useEffect(() => {
    let alive = true;
    // The pre-fetch reset is intentional; cascading renders are benign here
    // because we always immediately await a network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("loading");
    setResult(null);
    api.trackRecord(start, end).then((r) => {
      if (!alive) return;
      if (r === null) {
        setState("error");
      } else {
        setResult(r);
        setState("ready");
      }
    });
    return () => {
      alive = false;
    };
  }, [start, end]);

  // Existing TierHitRateChart expects { tier, n, hit_rate }. The new endpoint
  // returns richer rows; adapt and order them to the chart's TIER_ORDER list.
  const tierRowsForChart: TierHitRate[] =
    result?.tier_hit_rates.map((r) => ({
      tier: r.tier,
      n: r.settled,
      hit_rate: r.win_rate,
    })) ?? [];

  // Existing CalibrationChart consumes the same { midpoint, n, actual_win_rate }
  // shape; no transformation needed.
  const calibrationForChart: CalibrationBucket[] = result?.calibration ?? [];

  // The realized P&L curve is the cumulative units_returned per settled bet.
  // We dropped the synthetic flat-vs-Kelly split because Kelly stakes were
  // discretized into the `units` column before storage — there is no separate
  // Kelly-bankroll curve to honestly render. The curve we DO have is the real
  // money line: every bet was sized at the discretized Kelly value.
  const pnlCurve = result?.pnl_curve ?? [];
  const pnlSeries = pnlCurve.map((p) => p.cum_units);

  const tabItems: TabItem[] = [
    { value: "performance", label: "Performance" },
    { value: "clv", label: "CLV" },
    { value: "calibration", label: "Calibration" },
  ];

  const combined = result?.summary.combined;

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        @media (max-width: 640px) {
          .tr-hero { grid-template-columns: 1fr 1fr !important; }
          .responsive-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* decorative infield diamond watermark */}
      <div className="diamond-watermark" aria-hidden="true">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <polygon points="100,16 184,100 100,184 16,100" fill="none" stroke="var(--text)" strokeWidth={1} />
          <polygon points="100,58 142,100 100,142 58,100" fill="none" stroke="var(--text)" strokeWidth={1} />
          <line x1="100" y1="16" x2="100" y2="184" stroke="var(--text)" strokeWidth={1} />
          <line x1="16" y1="100" x2="184" y2="100" stroke="var(--text)" strokeWidth={1} />
        </svg>
      </div>

      {/* header */}
      <div
        className="infield-divider"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--sp-4)",
          marginBottom: "var(--sp-6)",
          paddingBottom: "var(--sp-4)",
        }}
      >
        <div>
          <h1
            className="scoreboard-num"
            style={{ fontSize: "var(--fs-headline)", margin: 0, color: "var(--text)", textTransform: "uppercase", lineHeight: "var(--lh-tight)" }}
          >
            Track Record
          </h1>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              color: "var(--text-2)",
              marginTop: "var(--sp-1)",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            Live-tracked picks · settled vs. predicted · no replay, no fabricated data
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--sp-3)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
            <span style={{ fontSize: "var(--fs-caption)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-2)" }}>From</span>
            <DateField value={start} onChange={setStart} aria-label="Start date" max={end} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
            <span style={{ fontSize: "var(--fs-caption)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-2)" }}>To</span>
            <DateField value={end} onChange={setEnd} aria-label="End date" max={todayET()} />
          </label>
        </div>
      </div>

      {state === "error" && (
        <ErrorBanner
          kind="outage"
          title="Track-record endpoint not reachable"
          detail="Run: uvicorn app.api.routes:app --port 8000"
          style={{ marginBottom: "var(--sp-4)" }}
        />
      )}

      {state === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          <Skeleton height={96} radius="var(--r-lg)" />
          <Skeleton height={200} radius="var(--r-md)" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }} className="responsive-grid-2">
            <Skeleton height={200} radius="var(--r-md)" />
            <Skeleton height={200} radius="var(--r-md)" />
          </div>
        </div>
      )}

      {state === "ready" && result && result.summary.combined.n === 0 && (
        <Accruing
          note={
            <>
              No picks logged between{" "}
              <strong style={{ color: "var(--text-2)" }}>{result.start ?? "—"}</strong> and{" "}
              <strong style={{ color: "var(--text-2)" }}>{result.end ?? "—"}</strong>. Widen the
              date range or wait for the next slate. Nothing is fabricated to fill this view.
            </>
          }
          style={{ padding: "var(--sp-10) var(--sp-6)" }}
        >
          <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", fontSize: "var(--fs-body)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>
            No tracked picks in range
          </span>
        </Accruing>
      )}

      {state === "ready" && result && combined && combined.n > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
          {/* ── HERO BAND — Net Units / ROI / % beat close ── */}
          <Card
            variant="default"
            style={{
              borderRadius: "var(--r-lg)",
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "var(--sp-4)",
              padding: "var(--sp-5) var(--sp-6)",
            }}
            className="tr-hero"
          >
            <HeroMetric
              label="Net Units"
              value={
                <SemanticValue
                  value={combined.units_net}
                  mode="units"
                  digits={2}
                  suffix="u"
                  style={{ fontSize: "var(--fs-hero)", fontFamily: "var(--font-display)", fontWeight: "var(--weight-display)" }}
                />
              }
            />
            <HeroMetric
              label="ROI"
              value={
                combined.roi == null ? (
                  <span className="scoreboard-num" style={{ fontSize: "var(--fs-hero)", color: "var(--text-muted)" }}>—</span>
                ) : (
                  <SemanticValue
                    value={combined.roi}
                    mode="roi"
                    display={`${combined.roi >= 0 ? "+" : ""}${(combined.roi * 100).toFixed(1)}%`}
                    style={{ fontSize: "var(--fs-hero)", fontFamily: "var(--font-display)", fontWeight: "var(--weight-display)" }}
                  />
                )
              }
            />
            <HeroMetric
              label="% Beat close"
              value={
                result.clv?.pct_beat_close == null ? (
                  <span className="scoreboard-num" style={{ fontSize: "var(--fs-hero)", color: "var(--text-muted)" }}>—</span>
                ) : (
                  <span
                    className="scoreboard-num"
                    style={{
                      fontSize: "var(--fs-hero)",
                      color: result.clv.pct_beat_close >= 0.5 ? "var(--pos)" : "var(--neg)",
                    }}
                  >
                    {(result.clv.pct_beat_close * 100).toFixed(1)}%
                  </span>
                )
              }
            />
            <HeroMetric
              label="Record"
              value={
                <span className="scoreboard-num" style={{ fontSize: "var(--fs-hero)", color: "var(--text)" }}>
                  {combined.wins}-{combined.losses}{combined.pushes ? "-" + combined.pushes : ""}
                </span>
              }
              sub={
                combined.win_rate != null ? (
                  <SemanticValue
                    value={combined.win_rate}
                    mode="win-rate"
                    display={`${(combined.win_rate * 100).toFixed(1)}% win`}
                    style={{ fontSize: "var(--fs-meta)" }}
                  />
                ) : undefined
              }
            />
          </Card>

          {/* Win-rate Wilson CI strip */}
          {combined.win_rate != null &&
            combined.win_rate_ci_low != null &&
            combined.win_rate_ci_high != null && (
              <Card
                variant="inset"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-meta)",
                  color: "var(--text-2)",
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "var(--sp-2)",
                }}
              >
                <span>
                  95% CI on win rate:{" "}
                  <strong className="num" style={{ color: "var(--text)" }}>
                    {(combined.win_rate_ci_low * 100).toFixed(1)}% –{" "}
                    {(combined.win_rate_ci_high * 100).toFixed(1)}%
                  </strong>{" "}
                  (Wilson, n={combined.wins + combined.losses})
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  Break-even at -110 = 52.4%
                </span>
              </Card>
            )}

          {/* ── SECTION TABS ── */}
          <Tabs items={tabItems} value={section} onChange={setSection} ariaLabel="Track-record sections" />

          {/* ── PERFORMANCE ── */}
          <TabPanel baseId="tr" tabValue="performance" active={section === "performance"}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              {/* Per-market split */}
              <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--sp-4)" }}>
                {(["ml", "total"] as const).map((mkt) => {
                  const sm = result.summary[mkt];
                  const label = mkt === "ml" ? "Moneyline" : "Over/Under";
                  return (
                    <Card key={mkt}>
                      <SectionHeader divider={false} style={{ marginBottom: "var(--sp-2)" }}>{label}</SectionHeader>
                      <StatGroup min="90px">
                        <StatCell
                          variant="plain"
                          label="Record"
                          value={`${sm.wins}-${sm.losses}${sm.pushes ? "-" + sm.pushes : ""}`}
                          emphasis="data"
                        />
                        <StatCell
                          variant="plain"
                          label="Win %"
                          emphasis="data"
                          value={sm.win_rate != null ? `${(sm.win_rate * 100).toFixed(1)}%` : "—"}
                          color={
                            sm.win_rate == null
                              ? "var(--text-muted)"
                              : sm.win_rate >= 0.524
                              ? "var(--pos)"
                              : "var(--neg)"
                          }
                        />
                        <StatCell
                          variant="plain"
                          label="Net"
                          emphasis="data"
                          value={`${sm.units_net >= 0 ? "+" : ""}${sm.units_net.toFixed(2)}u`}
                          color={sm.units_net >= 0 ? "var(--pos)" : "var(--neg)"}
                        />
                      </StatGroup>
                    </Card>
                  );
                })}
              </div>

              {/* Tier hit rate + Brier */}
              <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
                <ChartFrame title="Tier hit rate" term="tiers">
                  <TierHitRateChart rows={tierRowsForChart} />
                </ChartFrame>
                <ChartFrame title="Brier vs coin flip" term="brier-score">
                  <BrierReadout brier={result.brier_score} />
                </ChartFrame>
              </div>

              {/* P&L line (realized) */}
              <ChartFrame title="Cumulative net units (realized)">
                {pnlSeries.length === 0 ? (
                  <Accruing note="Curve fills in as bets settle.">
                    <span style={{ fontWeight: "var(--weight-bold)", color: "var(--text-2)", textTransform: "uppercase", fontSize: "var(--fs-meta)" }}>
                      No settled picks yet
                    </span>
                  </Accruing>
                ) : (
                  <PLLineChart series={pnlSeries} />
                )}
              </ChartFrame>

              <CoverageFootnote />
            </div>
          </TabPanel>

          {/* ── CLV ── */}
          <TabPanel baseId="tr" tabValue="clv" active={section === "clv"}>
            <ClvBlock clv={result.clv} />
          </TabPanel>

          {/* ── CALIBRATION ── */}
          <TabPanel baseId="tr" tabValue="calibration" active={section === "calibration"}>
            <ChartFrame title="Calibration (model prob vs realized)" term="calibration">
              <CalibrationCoverageNote coverage={result.snapshot_coverage} />
              <CalibrationChart buckets={calibrationForChart} />
            </ChartFrame>
          </TabPanel>
        </div>
      )}
    </div>
  );
}

/* ── hero metric atom ──────────────────────────────────── */
function HeroMetric({
  label,
  value,
  sub,
  explain,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  explain?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", minWidth: 0 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-1)",
          fontSize: "var(--fs-caption)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
        }}
      >
        {label}
        {explain && <ExplainTooltip term={explain} />}
      </span>
      <span style={{ lineHeight: "var(--lh-tight)" }}>{value}</span>
      {sub != null && <span>{sub}</span>}
    </div>
  );
}

/* ── shared honesty footnote ───────────────────────────── */
function CoverageFootnote() {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-caption)",
        color: "var(--text-muted)",
        lineHeight: "var(--lh-prose)",
        paddingLeft: "var(--sp-2)",
        borderLeft: "2px solid var(--clay)",
      }}
    >
      Live-pick basis: every row aggregates real BetRecord entries created
      by /tracker/auto-track at the time the pick was made, settled against
      real box scores. ROI uses units actually wagered (Kelly-discretized
      stakes, not flat). Calibration restricts to picks with a captured
      model probability — see the coverage note above. Past performance
      doesn&apos;t establish future results.
    </div>
  );
}
