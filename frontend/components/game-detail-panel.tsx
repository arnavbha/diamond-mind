"use client";

import React, { useEffect, useState } from "react";
import { api, type GameContext, type WeatherData, type GameAnalysis, type TeamBatting, type LiveState, type FairValueResult, type BoostEv, type Movement } from "@/lib/api";
import { Gauge, DuelBar, MethodCompare, GrowthReadout } from "@/components/quant";
import { ExplainTooltip } from "@/components/explain";
import { LiveAlert } from "@/components/live-alert";
import {
  Card,
  Panel,
  TeamLogo,
  TierBadge,
  SectionHeader,
  StatCell,
  Bar,
  LabeledBar,
  OddsValue,
  Tabs,
  TabPanel,
  Button,
  NumberField,
  EmptyState,
  ErrorBanner,
  SkeletonCard,
  SkeletonText,
  Loading,
} from "@/components/ui";
import { tierColor, heatColorFor, semanticColor, HOLD_COLOR } from "@/lib/visual-tokens";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-bold)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-2)", marginBottom: "var(--sp-3)" }}>
      {children}
    </div>
  );
}

function StatRow({ label, value, mono = true }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--sp-1) 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{label}</span>
      <span className={mono ? "num" : undefined} style={{ fontFamily: mono ? undefined : "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text)", fontWeight: "var(--weight-medium)" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function vulnColor(score: number) {
  // Continuous gauge — heat ramp (fresh→gassed), not win/loss semantic red.
  return heatColorFor(score, 0, 100);
}

function BullpenCard({ abbr, bp }: { abbr: string; bp: NonNullable<GameContext["home_bullpen"]> }) {
  const vc = vulnColor(bp.vulnerability_score);
  return (
    <Card style={{ borderTop: `2px solid ${vc}` }}>
      <Label>{abbr} Bullpen</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", marginBottom: "var(--sp-3)" }}>
        <div>
          <div style={{ marginBottom: "var(--sp-1)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", fontWeight: "var(--weight-medium)" }}>Vulnerability</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "var(--sp-1)" }}>— how exposed the pen is tonight (0 = fresh, 100 = gassed)</span>
          </div>
          <LabeledBar label="Vuln" value={bp.vulnerability_score / 100} color={vc} valueText={bp.vulnerability_score.toFixed(0)} valueColor={vc} delay={0} />
        </div>
        <div>
          <div style={{ marginBottom: "var(--sp-1)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", fontWeight: "var(--weight-medium)" }}>Fatigue</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "var(--sp-1)" }}>— pitcher workload over last 3 days</span>
          </div>
          <LabeledBar label="Fatigue" value={bp.fatigue_score / 100} color="var(--text-2)" valueText={bp.fatigue_score.toFixed(0)} valueColor="var(--text-2)" delay={80} />
        </div>
        <div>
          <div style={{ marginBottom: "var(--sp-1)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", fontWeight: "var(--weight-medium)" }}>Available Quality</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "var(--sp-1)" }}>— quality of relievers who can pitch tonight</span>
          </div>
          <LabeledBar label="Avail. quality" value={bp.available_quality / 100} color="var(--warn)" valueText={bp.available_quality.toFixed(0)} valueColor="var(--warn)" delay={160} />
        </div>
      </div>
      {(bp.unavailable_relievers?.length ?? 0) > 0 && (
        <div style={{ marginTop: "var(--sp-2)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--neg)" }}>
          Can&apos;t pitch tonight: {bp.unavailable_relievers.join(", ")}
        </div>
      )}
      {(bp.limited_relievers?.length ?? 0) > 0 && (
        <div style={{ marginTop: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: HOLD_COLOR }}>
          Limited (high usage): {bp.limited_relievers.join(", ")}
        </div>
      )}
      {(bp.best_available?.length ?? 0) > 0 && (
        <div style={{ marginTop: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--pos)" }}>
          Best available: {bp.best_available.join(", ")}
        </div>
      )}
      <div style={{ marginTop: "var(--sp-3)", fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", fontStyle: "italic", lineHeight: "var(--lh-prose)" }}>
        {bp.betting_implication}
      </div>
    </Card>
  );
}

function StarterCard({ abbr, starter }: { abbr: string; starter: NonNullable<GameContext["home_starter"]> | null }) {
  const fipColor = starter?.fip != null
    ? starter.fip <= 3.20 ? "var(--pos)" : starter.fip >= 4.50 ? "var(--neg)" : "var(--text)"
    : "var(--text)";
  return (
    <Card>
      <Label>{abbr} Starting Pitcher</Label>
      {starter ? (
        <>
          <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-data)", marginBottom: "var(--sp-3)", color: "var(--text)", letterSpacing: "-0.01em" }}>
            {starter.pitcher_name}
          </div>
          {starter.insufficient_sample && starter.starts === 0 ? (
            <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: "var(--lh-prose)" }}>
              Announced starter — no recent-start sample available yet.
            </div>
          ) : (
            <>
              <StatRow label="ERA" value={starter.era?.toFixed(2)} />
              {starter.fip != null && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--sp-1) 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)", display: "inline-flex", alignItems: "center", gap: "var(--sp-1)" }}>
                    <ExplainTooltip term="fip"><span>FIP</span></ExplainTooltip>
                  </span>
                  <span className="num" style={{ fontSize: "var(--fs-data)", color: fipColor }}>{starter.fip.toFixed(2)}</span>
                </div>
              )}
              <StatRow label="WHIP" value={starter.whip?.toFixed(2)} />
              <StatRow label="K/9" value={starter.k_per_9?.toFixed(1)} />
              <StatRow label="BB/9" value={starter.bb_per_9?.toFixed(1)} />
              {starter.babip != null && <StatRow label="BABIP" value={starter.babip.toFixed(3)} />}
              {starter.avg_pitches_per_start != null && (
                <StatRow label="Avg pitches/start" value={starter.avg_pitches_per_start.toFixed(0)} />
              )}
              <StatRow label="Recent trend" value={starter.trend_label?.replace(/_/g, " ")} mono={false} />
            </>
          )}
          {starter.insufficient_sample && (
            <div style={{ marginTop: "var(--sp-2)", fontSize: "var(--fs-meta)", color: "var(--warn)" }}>Small sample — fewer than 5 starts</div>
          )}
        </>
      ) : (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)", color: "var(--text-muted)" }}>Starter not yet announced</div>
      )}
    </Card>
  );
}

function degreesToCompass(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function windEffect(speedMph: number, deg: number): string {
  if (speedMph < 6) return "calm — minimal effect";
  if (deg >= 30 && deg <= 120) return `blowing out to CF — favors hitters, Over lean`;
  if (deg >= 210 && deg <= 300) return `blowing in from CF — suppresses power, Under lean`;
  return `crosswind — limited scoring effect`;
}

function WeatherCard({ w }: { w: WeatherData }) {
  if (w.is_dome) return (
    <Card>
      <Label>Conditions</Label>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>Indoor venue — weather not a factor.</div>
    </Card>
  );
  const tempNote = w.temperature_f != null
    ? w.temperature_f >= 85 ? " (hot)" : w.temperature_f <= 50 ? " (cold)" : "" : "";
  const windNote = w.wind_speed_mph != null && w.wind_direction_deg != null && w.wind_speed_mph >= 6
    ? windEffect(w.wind_speed_mph, w.wind_direction_deg) : null;
  return (
    <Card>
      <Label>Conditions</Label>
      <StatRow label={`Temp${tempNote}`} value={w.temperature_f != null ? `${w.temperature_f}°F` : null} />
      {w.wind_speed_mph != null && (
        <StatRow
          label={`Wind — ${w.wind_speed_mph} mph from ${w.wind_direction_deg != null ? degreesToCompass(w.wind_direction_deg) : "?"}`}
          value={windNote ?? "calm"} mono={false}
        />
      )}
      <StatRow label="Precip chance" value={w.precipitation_chance != null ? `${w.precipitation_chance}%` : null} />
    </Card>
  );
}

type FormWindow = {
  runs_per_game?: number | null;
  runs_allowed_per_game?: number | null;
  team_ops?: number | null;
  team_woba?: number | null;
  record_wins?: number | null;
  record_losses?: number | null;
  trend_label?: string | null;
  games?: number | null;
};

function CompareRow({ label, home, away, higherBetter = true, fmt = (v: number) => v.toFixed(2) }: {
  label: string; home: number | null | undefined; away: number | null | undefined;
  higherBetter?: boolean; fmt?: (v: number) => string;
}) {
  const hVal = home ?? null;
  const aVal = away ?? null;
  const homeWins = hVal !== null && aVal !== null && (higherBetter ? hVal > aVal : hVal < aVal);
  const awayWins = hVal !== null && aVal !== null && (higherBetter ? aVal > hVal : aVal < hVal);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", alignItems: "center", padding: "var(--sp-1) 0", borderBottom: "1px solid var(--border)" }}>
      <span className="num" style={{ fontSize: "var(--fs-body)", color: homeWins ? "var(--text)" : "var(--text-2)", fontWeight: homeWins ? "var(--weight-semibold)" : "var(--weight-normal)", textAlign: "right" }}>
        {hVal !== null ? fmt(hVal) : "—"}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", textAlign: "center", letterSpacing: "var(--tracking-label)" }}>{label}</span>
      <span className="num" style={{ fontSize: "var(--fs-body)", color: awayWins ? "var(--text)" : "var(--text-2)", fontWeight: awayWins ? "var(--weight-semibold)" : "var(--weight-normal)", textAlign: "left" }}>
        {aVal !== null ? fmt(aVal) : "—"}
      </span>
    </div>
  );
}

function TeamStatsCard({ homeAbbr, awayAbbr, homeForm, awayForm, homeBatting, awayBatting }: {
  homeAbbr: string; awayAbbr: string;
  homeForm: FormWindow | null | undefined; awayForm: FormWindow | null | undefined;
  homeBatting?: TeamBatting | null; awayBatting?: TeamBatting | null;
}) {
  const hf = homeForm as FormWindow | null;
  const af = awayForm as FormWindow | null;
  if (!hf && !af) return null;
  return (
    <Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", marginBottom: "var(--sp-3)" }}>
        <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-data)", color: "var(--text)", textAlign: "right", letterSpacing: "-0.01em" }}>{homeAbbr}</div>
        <div style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-bold)", letterSpacing: "var(--tracking-label)", color: "var(--text-2)", textTransform: "uppercase", textAlign: "center", paddingTop: "var(--sp-1)" }}>L10</div>
        <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-data)", color: "var(--text-2)", textAlign: "left", letterSpacing: "-0.01em" }}>{awayAbbr}</div>
      </div>
      <CompareRow label="R/G" home={hf?.runs_per_game} away={af?.runs_per_game} fmt={v => v.toFixed(1)} />
      <CompareRow label="RA/G" home={hf?.runs_allowed_per_game} away={af?.runs_allowed_per_game} higherBetter={false} fmt={v => v.toFixed(1)} />
      <CompareRow label="OPS" home={hf?.team_ops} away={af?.team_ops} fmt={v => v.toFixed(3)} />
      <CompareRow label="wOBA" home={hf?.team_woba} away={af?.team_woba} fmt={v => v.toFixed(3)} />
      {(homeBatting?.iso != null || awayBatting?.iso != null) && (
        <CompareRow label="ISO" home={homeBatting?.iso ?? null} away={awayBatting?.iso ?? null} fmt={v => v.toFixed(3)} />
      )}
      {(homeBatting?.strikeout_rate != null || awayBatting?.strikeout_rate != null) && (
        <CompareRow label="K%" home={homeBatting?.strikeout_rate ?? null} away={awayBatting?.strikeout_rate ?? null} higherBetter={false} fmt={v => `${(v*100).toFixed(1)}%`} />
      )}
      {(homeBatting?.walk_rate != null || awayBatting?.walk_rate != null) && (
        <CompareRow label="BB%" home={homeBatting?.walk_rate ?? null} away={awayBatting?.walk_rate ?? null} fmt={v => `${(v*100).toFixed(1)}%`} />
      )}
      <CompareRow label="W (L10)" home={hf?.record_wins} away={af?.record_wins} fmt={v => String(Math.round(v))} />
      <CompareRow label="L (L10)" home={hf?.record_losses} away={af?.record_losses} higherBetter={false} fmt={v => String(Math.round(v))} />
      {(hf?.trend_label || af?.trend_label) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", padding: "var(--sp-1) 0" }}>
          <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", textAlign: "right" }}>{hf?.trend_label?.replace(/_/g, " ") ?? "—"}</span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", textAlign: "center" }}>Trend</span>
          <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", textAlign: "left" }}>{af?.trend_label?.replace(/_/g, " ") ?? "—"}</span>
        </div>
      )}
    </Card>
  );
}

function AnalysisPanel({ a }: { a: GameAnalysis }) {
  const tc = tierColor(a.ml_tier);
  const leanAbbr = a.ml_lean === "HOME" ? a.home_team_abbr
    : a.ml_lean === "AWAY" ? a.away_team_abbr
    : (a.ml_lean && a.ml_lean !== "PASS") ? a.ml_lean
    : null;
  const isActionable = leanAbbr !== null && a.ml_tier !== "AVOID";
  const evPct = a.ev_per_dollar != null ? a.ev_per_dollar * 100 : null;
  const variant = a.ml_tier === "STRONG LEAN" ? "strong-lean" : a.ml_tier === "LEAN" ? "lean" : "default";

  return (
    <Card variant={variant} pad={false} style={{ overflow: "hidden" }}>
      <div style={{ padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-headline)", fontWeight: "var(--weight-display)", color: tc, letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: "var(--lh-tight)" }}>
            {isActionable ? `${leanAbbr} ML` : a.ml_tier}
          </div>
          {isActionable && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <span className="num" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text)" }}>
                {a.ml_american_odds > 0 ? "+" : ""}{a.ml_american_odds}
              </span>
              <TierBadge tier={a.ml_tier} />
            </div>
          )}
        </div>
        {isActionable && (
          <div style={{ display: "flex", gap: "var(--sp-6)", textAlign: "right" }}>
            <div>
              <div className="data-label" style={{ textAlign: "right" }}>EV / dollar</div>
              <div className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-stat)", color: evPct != null ? semanticColor(evPct) : "var(--text-2)", lineHeight: "var(--lh-tight)" }}>
                {evPct != null ? `${evPct > 0 ? "+" : ""}${evPct.toFixed(1)}¢` : "—"}
              </div>
              <div style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", marginTop: "var(--sp-1)" }}>per $1 wagered</div>
            </div>
            <div>
              <div className="data-label" style={{ textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--sp-1)" }}>
                Kelly <ExplainTooltip term="uncertainty-kelly" />
              </div>
              <div className="num" style={{ fontSize: "var(--fs-stat)", fontWeight: "var(--weight-bold)", color: "var(--text)", lineHeight: "var(--lh-tight)" }}>
                {(a.ml_kelly_fraction * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", marginTop: "var(--sp-1)" }}>of bankroll</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "var(--sp-4) var(--sp-5)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "var(--sp-5)", alignItems: "center", marginBottom: "var(--sp-4)" }}>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)", marginBottom: "var(--sp-3)", display: "flex", alignItems: "center", gap: "var(--sp-1)", flexWrap: "wrap" }}>
              model{" "}
              <span className="num" style={{ color: "var(--text)" }}>{(a.q_p_model * 100).toFixed(1)}%</span>{" "}→{" "}
              <ExplainTooltip term="bayesian-shrinkage"><span>shrunk</span></ExplainTooltip>{" "}
              <strong className="num" style={{ color: "var(--text)" }}>{(a.q_p_shrunk * 100).toFixed(1)}%</strong>{" "}vs{" "}
              <ExplainTooltip term="shin-devig"><span>Shin market</span></ExplainTooltip>{" "}
              <span className="num" style={{ color: "var(--text)" }}>{(a.q_shin_vig_free * 100).toFixed(1)}%</span>
            </div>
            <DuelBar model={a.q_p_shrunk} market={a.q_shin_vig_free} lower={a.q_ci_low} upper={a.q_ci_high} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
            <Gauge p={a.q_prob_positive} size={140} />
            <ExplainTooltip term="p-plus-ev">
              <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase" }}>P(+EV)</span>
            </ExplainTooltip>
          </div>
        </div>
        <div className="section-label" style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", marginBottom: "var(--sp-2)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>Bankroll growth <ExplainTooltip term="expected-log-growth" /></span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>Doubling <ExplainTooltip term="doubling-time" /></span>
        </div>
        <GrowthReadout a={a} />
        {isActionable && <div style={{ marginTop: "var(--sp-4)" }}><MethodCompare a={a} /></div>}
      </div>

      <div className="mobile-stack" style={{ padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
        <div style={{ padding: "0 var(--sp-3) 0 0", borderRight: "1px solid var(--border)" }}>
          <div className="data-label" style={{ marginBottom: "var(--sp-2)" }}>Win Probability</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
            {[
              { abbr: a.home_team_abbr, prob: a.model_home_win_prob },
              { abbr: a.away_team_abbr, prob: a.model_away_win_prob },
            ].map(({ abbr, prob }) => (
              <div key={abbr} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", width: "30px" }}>{abbr}</span>
                <Bar value={prob} color="var(--lean)" style={{ flex: 1 }} />
                <span className="num" style={{ fontSize: "var(--fs-data)", color: "var(--text)", width: "42px", textAlign: "right" }}>
                  {(prob * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: "0 var(--sp-3)", borderRight: "1px solid var(--border)" }}>
          <div className="data-label" style={{ marginBottom: "var(--sp-2)" }}>Total (O/U)</div>
          <div className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-stat)", color: a.total_lean === "OVER" ? "var(--pos)" : a.total_lean === "UNDER" ? "var(--lean)" : "var(--text-2)" }}>
            {a.total_lean === "PASS" ? "NO LEAN" : a.total_lean}
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}>
            proj <span className="num" style={{ color: "var(--text-2)" }}>{a.projected_total.toFixed(1)}</span> runs
          </div>
        </div>
        <div style={{ padding: "0 0 0 var(--sp-3)" }}>
          <div className="data-label" style={{ marginBottom: "var(--sp-2)", display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
            Base Rate <ExplainTooltip term="vig-overround" />
          </div>
          <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: "var(--lh-prose)" }}>
            Home adv: <span className="num" style={{ color: "var(--text)" }}>53.5%</span><br/>
            Vig: <span className="num" style={{ color: "var(--text)" }}>{a.overround != null ? `${((a.overround - 1) * 100).toFixed(1)}%` : "—"}</span>
          </div>
        </div>
      </div>

      {(() => {
        const components = [
          { label: "SP / FIP",      val: a.component_fip,       note: "FIP differential" },
          { label: "Bullpen",       val: a.component_bullpen,   note: "Vulnerability & fatigue gap" },
          { label: "Offense",       val: a.component_offense,   note: "wOBA + R/G vs RA/G" },
          { label: "Form / Splits", val: a.component_trend,     note: "Trend, H2H, home/road" },
          { label: "K Matchup",     val: a.component_k_matchup, note: "SP K/9 vs lineup K%" },
          { label: "Weather",       val: a.component_weather,   note: "Wind + temp effect" },
          { label: "Rest",          val: a.component_rest,      note: "Pitcher days rest" },
          { label: "Park",          val: a.component_park,      note: "Ballpark run factor" },
        ].filter(c => Math.abs(c.val) > 0.001);
        if (!components.length) return null;
        const maxAbs = Math.max(...components.map(c => Math.abs(c.val)), 0.01);
        return (
          <div style={{ padding: "var(--sp-3) var(--sp-5)", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
              <div className="data-label">Factor Waterfall</div>
              <div style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)", display: "flex", gap: "var(--sp-3)" }}>
                <span style={{ color: "var(--neg)" }}>← {a.away_team_abbr}</span>
                <span style={{ color: "var(--pos)" }}>{a.home_team_abbr} →</span>
              </div>
            </div>
            {components.map(({ label, val, note }) => {
              const pct = (Math.abs(val) / maxAbs) * 80;
              const color = val > 0 ? "var(--pos)" : "var(--neg)";
              return (
                <div key={label} style={{ marginBottom: "var(--sp-3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--sp-1)" }}>
                    <div>
                      <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{label}</span>
                      <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-2)", marginLeft: "var(--sp-2)" }}>{note}</span>
                    </div>
                    <span className="num" style={{ fontSize: "var(--fs-meta)", color, fontWeight: "var(--weight-bold)" }}>
                      {val > 0 ? "+" : ""}{(val * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                      {val < 0 && <div style={{ width: `${pct}%`, height: "4px", background: color, borderRadius: "var(--r-xs)" }} />}
                    </div>
                    <div style={{ width: "1px", height: "8px", background: "var(--border)", flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      {val > 0 && <div style={{ width: `${pct}%`, height: "4px", background: color, borderRadius: "var(--r-xs)" }} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {a.key_factors.length > 0 && (
        <div style={{ padding: "var(--sp-3) var(--sp-5)", borderBottom: a.cautions.length > 0 ? "1px solid var(--border)" : "none" }}>
          <div className="data-label" style={{ marginBottom: "var(--sp-2)" }}>Key Factors</div>
          {a.key_factors.map((f, i) => (
            <div key={i} style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", marginBottom: "var(--sp-1)", paddingLeft: "var(--sp-2)", borderLeft: "1px solid var(--border)" }}>{f}</div>
          ))}
        </div>
      )}

      {a.cautions.length > 0 && (
        <div style={{ padding: "var(--sp-3) var(--sp-5)", background: "var(--amber-tint)" }}>
          {a.cautions.map((c, i) => (
            <div key={i} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: HOLD_COLOR, marginBottom: "var(--sp-1)" }}>{c}</div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Beat-the-Book: fair value, book hold, profit-boost EV ───────────────────────

function fmtAmerican(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 0 ? `+${n}` : `${n}`;
}

function verdictColor(verdict: string): string {
  if (verdict === "+EV") return "var(--pos)";
  if (verdict === "-EV") return "var(--neg)";
  return "var(--warn)"; // marginal
}

/** One market's offered price vs the no-vig fair line + book hold. Verification
 *  only — this exposes the vig the book charges; it is NOT a pick. */
function FairMarketRow({ label, offered, fair, holdPct, fmt = fmtAmerican }: {
  label: string;
  offered: { aTag: string; a: number | null; bTag: string; b: number | null } | null;
  fair: { a: number | null; b: number | null } | null;
  holdPct: number | null;
  fmt?: (n: number | null | undefined) => string;
}) {
  if (!offered) {
    return (
      <div style={{ padding: "var(--sp-2) 0", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
          {label} — odds not captured (two-sided price required)
        </span>
      </div>
    );
  }
  return (
    <div style={{ padding: "var(--sp-2) 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "var(--sp-2)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)", fontWeight: "var(--weight-medium)" }}>{label}</span>
        {holdPct != null && (
          <span
            className="num"
            title="Book hold (overround) — the vig baked into both sides of this market"
            style={{ fontSize: "var(--fs-meta)", color: HOLD_COLOR, fontWeight: "var(--weight-semibold)" }}
          >
            hold {holdPct.toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-1)", marginTop: "var(--sp-1)" }}>
        {[
          { tag: offered.aTag, off: offered.a, fr: fair?.a ?? null },
          { tag: offered.bTag, off: offered.b, fr: fair?.b ?? null },
        ].map(({ tag, off, fr }) => (
          <div key={tag} style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)" }}>
            <span style={{ color: "var(--text-2)", width: "34px" }}>{tag}</span>
            <OddsValue odds={off} />
            <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>book</span>
            <span style={{ color: "var(--text-muted)" }}>·</span>
            <OddsValue odds={fr} muted />
            <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>fair</span>
          </div>
        ))}
      </div>
      {!fair && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: "var(--text-muted)", marginTop: "var(--sp-1)" }}>
          fair line needs both sides priced
        </div>
      )}
    </div>
  );
}

/** Profit-Boost EV calculator. Stateless — evaluates whether a DraftKings-style
 *  profit boost (applies to winnings only) is +EV at a supplied fair win prob.
 *  Seeds the price + fair prob from the model when available. Never says "bet". */
function BoostEvWidget({ fv }: { fv: FairValueResult }) {
  // Seed the side/price from the model's leaned side when it ran on real odds;
  // else fall back to the home moneyline. Boost defaults to 30%.
  const ml = fv.moneyline;
  const modelSide = ml.model_fair_side; // "home" | "away" | null
  const seedSide: "home" | "away" = modelSide ?? "home";
  const seedOdds = (s: "home" | "away") => (s === "home" ? ml.offered?.home : ml.offered?.away) ?? null;
  // Fair prob seed: model's vig-free prob for the leaned side, else the book's
  // no-vig prob for the chosen side, else null (user must supply).
  const bookFairProb = (s: "home" | "away") =>
    ml.fair ? (s === "home" ? ml.fair.home_prob : ml.fair.away_prob) : null;
  const seedProb = (s: "home" | "away") =>
    modelSide === s ? ml.model_fair_prob ?? bookFairProb(s) : bookFairProb(s);

  const [side, setSide] = useState<"home" | "away">(seedSide);
  const [boostPct, setBoostPct] = useState<number>(30);
  const [oddsStr, setOddsStr] = useState<string>(() => {
    const o = seedOdds(seedSide);
    return o != null ? String(o) : "";
  });
  const [probStr, setProbStr] = useState<string>(() => {
    const p = seedProb(seedSide);
    return p != null ? (p * 100).toFixed(1) : "";
  });
  const [result, setResult] = useState<BoostEv | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pickSide(s: "home" | "away") {
    setSide(s);
    const o = seedOdds(s);
    setOddsStr(o != null ? String(o) : "");
    const p = seedProb(s);
    setProbStr(p != null ? (p * 100).toFixed(1) : "");
    setResult(null);
    setErr(null);
  }

  async function compute() {
    setErr(null);
    const odds = parseInt(oddsStr, 10);
    const probPct = parseFloat(probStr);
    if (!Number.isFinite(odds) || odds === 0) { setErr("Enter a non-zero American price."); return; }
    if (!Number.isFinite(boostPct) || boostPct < 0) { setErr("Boost % must be ≥ 0."); return; }
    if (!Number.isFinite(probPct) || probPct <= 0 || probPct >= 100) { setErr("Fair win prob must be between 0 and 100%."); return; }
    setBusy(true);
    const r = await api.boostEv(odds, boostPct, probPct / 100);
    setBusy(false);
    if (!r) { setErr("Could not evaluate — check the inputs."); setResult(null); return; }
    setResult(r);
  }

  const homeAbbr = fv.home_team_abbr ?? "HOME";
  const awayAbbr = fv.away_team_abbr ?? "AWAY";
  const sideLabel = side === "home" ? homeAbbr : awayAbbr;

  const sideBtn = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--surface-2)" : "transparent",
    border: `1px solid ${active ? "var(--lean)" : "var(--border)"}`,
    color: active ? "var(--text)" : "var(--text-2)",
    borderRadius: "var(--r-sm)", padding: "var(--sp-1) var(--sp-3)", cursor: "pointer",
    minHeight: "44px", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", fontWeight: "var(--weight-semibold)",
  });

  return (
    <Card>
      <Label>Profit-Boost EV</Label>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", marginBottom: "var(--sp-3)", lineHeight: "var(--lh-prose)" }}>
        A profit boost lifts your winnings only (never the stake). Enter a boost % and a fair
        win probability to verify whether the promo is +EV — this is a check, not a recommendation.
      </div>

      {/* Side toggle (moneyline) */}
      <div style={{ display: "flex", gap: "var(--sp-1)", marginBottom: "var(--sp-2)", alignItems: "center" }}>
        <button type="button" style={sideBtn(side === "away")} onClick={() => pickSide("away")}>{awayAbbr}</button>
        <button type="button" style={sideBtn(side === "home")} onClick={() => pickSide("home")}>{homeAbbr}</button>
        {modelSide && (
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: "var(--text-2)", alignSelf: "center" }}>
            seeded from model · {modelSide === "home" ? homeAbbr : awayAbbr}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
        <NumberField label={`${sideLabel} price`} value={oddsStr} onChange={setOddsStr} placeholder="e.g. -120" inputMode="numeric" />
        <NumberField label="boost %" value={String(boostPct)} onChange={(v) => setBoostPct(parseFloat(v))} inputMode="decimal" />
        <NumberField label="fair win %" value={probStr} onChange={setProbStr} placeholder="e.g. 55" inputMode="decimal" />
      </div>

      <Button variant="primary" onClick={compute} disabled={busy}>
        {busy ? "Evaluating…" : "Evaluate boost"}
      </Button>

      {err && (
        <div style={{ marginTop: "var(--sp-2)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--neg)" }}>{err}</div>
      )}

      {result && (
        <div style={{ marginTop: "var(--sp-3)", borderTop: "1px solid var(--border)", paddingTop: "var(--sp-3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
              boosted price{" "}
              <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-bold)" }}>{fmtAmerican(result.boosted_american)}</span>
            </span>
            <span className="num" style={{
              fontSize: "var(--fs-body)", fontWeight: "var(--weight-bold)",
              color: verdictColor(result.verdict),
              border: `1px solid ${verdictColor(result.verdict)}`, borderRadius: "var(--r-sm)", padding: "var(--sp-1) var(--sp-2)",
            }}>
              {result.verdict}
            </span>
          </div>
          <StatRow label="EV %" value={`${result.ev_pct >= 0 ? "+" : ""}${result.ev_pct.toFixed(2)}%`} />
          <StatRow label="EV (units / $1)" value={`${result.ev_units >= 0 ? "+" : ""}${result.ev_units.toFixed(3)}`} />
          <StatRow label="Break-even prob" value={`${(result.breakeven_prob * 100).toFixed(1)}%`} />
          <StatRow label="Edge vs break-even" value={`${result.edge_vs_breakeven >= 0 ? "+" : ""}${(result.edge_vs_breakeven * 100).toFixed(1)} pts`} />
          <StatRow label="Boosted payout / $1" value={result.boosted_payout_per_unit.toFixed(3)} />
        </div>
      )}
    </Card>
  );
}

// ── Line movement (single-book net move, open → close) ──────────────────────
// Verification readout, NOT cross-book "steam". Reports one bookmaker's net move
// between the opening and latest pre-first-pitch snapshots, and whether the
// market moved toward or away from the model's leaned side. Honest empty state
// when fewer than two pre-pitch snapshots exist. No fabricated numbers.

function movementLabelColor(label: Movement["label"]): string {
  if (label === "confirmation") return "var(--pos)";
  if (label === "fade") return "var(--neg)";
  return "var(--text-2)"; // flat / null
}

function movementSideTag(m: Movement, homeAbbr: string, awayAbbr: string): string | null {
  switch (m.side) {
    case "home": return homeAbbr;
    case "away": return awayAbbr;
    case "over": return "Over";
    case "under": return "Under";
    default: return null;
  }
}

function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)} pts`;
}

function fmtSignedNum(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

/** One market's net open → close move with toward/away + confirmation/fade. */
function MovementMarketRow({ label, m, homeAbbr, awayAbbr }: {
  label: string;
  m: Movement | null | undefined;
  homeAbbr: string;
  awayAbbr: string;
}) {
  const usable = m && (m.source === "live" || m.source === "one_sided")
    && m.open?.american != null && m.close?.american != null;

  if (!m || !usable) {
    const why = !m ? "not available"
      : m.source === "single_snapshot" ? "only one pre-first-pitch snapshot captured — no movement to measure"
      : m.source === "no_first_pitch" ? "first-pitch time unknown — cannot bound pre-pitch snapshots"
      : m.source === "no_book_snapshots" ? "no snapshots captured for this book"
      : "no movement data";
    return (
      <div style={{ padding: "var(--sp-2) 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)", fontWeight: "var(--weight-medium)", marginBottom: "var(--sp-1)" }}>{label}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{why}</div>
      </div>
    );
  }

  const color = movementLabelColor(m.label);
  const sideTag = movementSideTag(m, homeAbbr, awayAbbr);
  const dirWord = m.agreement === "toward" ? "toward"
    : m.agreement === "away" ? "away from"
    : "flat";
  const lineMoved = m.line_delta != null && m.line_delta !== 0
    && m.open?.line != null && m.close?.line != null;
  // one_sided means we could not devig; the prob delta is a raw price-implied
  // approximation, so we say so rather than implying a clean no-vig number.
  const probApprox = m.source === "one_sided";

  return (
    <div style={{ padding: "var(--sp-2) 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "var(--sp-2)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)", fontWeight: "var(--weight-medium)" }}>{label}</span>
        {m.label && (
          <span
            className="num"
            title="Whether the book's net move went toward or away from the model's leaned side"
            style={{ fontSize: "var(--fs-meta)", color, fontWeight: "var(--weight-semibold)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}
          >
            {m.label}
          </span>
        )}
      </div>

      {/* Open → close prices (and total line when it moved) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", marginTop: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-caption)" }}>price</span>
          <span className="num" style={{ color: "var(--text-2)", fontWeight: "var(--weight-semibold)" }}>{fmtAmerican(m.open.american)}</span>
          <span style={{ color: "var(--text-muted)" }}>→</span>
          <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-bold)" }}>{fmtAmerican(m.close.american)}</span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>({fmtSignedNum(m.american_delta, 0)})</span>
        </span>
        {lineMoved && (
          <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
            <span style={{ color: "var(--text-2)", fontSize: "var(--fs-caption)" }}>total</span>
            <span className="num" style={{ color: "var(--text-2)", fontWeight: "var(--weight-semibold)" }}>{m.open.line}</span>
            <span style={{ color: "var(--text-muted)" }}>→</span>
            <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-bold)" }}>{m.close.line}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>({fmtSignedNum(m.line_delta, 1)})</span>
          </span>
        )}
      </div>

      {/* Vig-free implied-prob delta for the measured side */}
      <div style={{ marginTop: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
        <span style={{ color: "var(--text-2)" }}>
          {probApprox ? "implied-prob Δ (price-implied)" : "vig-free implied-prob Δ"}
          {sideTag ? ` · ${sideTag}` : ""}
        </span>{" "}
        <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>
          {m.devig_prob_delta != null ? fmtSignedPct(m.devig_prob_delta) : (lineMoved ? "see line move" : "—")}
        </span>
      </div>

      {/* Direction vs model side */}
      {sideTag && m.agreement && (
        <div style={{ marginTop: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
          <span style={{ color: "var(--text-2)" }}>market moved</span>{" "}
          <span style={{ color, fontWeight: "var(--weight-semibold)" }}>{dirWord} {sideTag}</span>
        </div>
      )}

      {m.bookmaker && (
        <div style={{ marginTop: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
          {m.bookmaker}
          {m.open.captured_at && m.close.captured_at ? " · open → latest pre-first-pitch" : ""}
        </div>
      )}
    </div>
  );
}

/** Single-book net line movement (open → close) across both markets. */
function MovementPanel({ fv }: { fv: FairValueResult }) {
  const mlMove = fv.moneyline.movement ?? null;
  const totMove = fv.total.movement ?? null;
  // Nothing to render if neither market carries a movement object at all.
  if (!mlMove && !totMove) return null;

  const homeAbbr = fv.home_team_abbr ?? "HOME";
  const awayAbbr = fv.away_team_abbr ?? "AWAY";
  const totLine = fv.total.offered?.line;

  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <SectionHeader>Line movement — open → close (single book)</SectionHeader>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", margin: "var(--sp-1) 0 var(--sp-3)", lineHeight: "var(--lh-prose)" }}>
        Net move for one bookmaker between the opening and the latest pre-first-pitch snapshot —
        and whether it went toward or away from the model&apos;s leaned side. This is single-book
        line movement, not a cross-book market read; the price delta is for context only.
      </div>
      <Card>
        <MovementMarketRow label="Moneyline" m={mlMove} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
        <MovementMarketRow label={`Total${totLine != null ? ` (${totLine})` : ""}`} m={totMove} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
      </Card>
    </div>
  );
}

/** Fair value (no-vig) + book hold per market, plus the boost-EV widget. */
function BeatTheBookPanel({ fv }: { fv: FairValueResult }) {
  const ml = fv.moneyline;
  const tot = fv.total;
  const hasAnyOffered = ml.offered != null || tot.offered != null;

  // Model-vs-market fair-edge: model's vig-free prob vs the book's no-vig prob on
  // the same side. A disagreement readout — not a pick.
  let modelVsMarket: { side: string; model: number; market: number } | null = null;
  if (ml.model_fair_prob != null && ml.model_fair_side && ml.fair) {
    const market = ml.model_fair_side === "home" ? ml.fair.home_prob : ml.fair.away_prob;
    const sideAbbr = ml.model_fair_side === "home"
      ? (fv.home_team_abbr ?? "HOME")
      : (fv.away_team_abbr ?? "AWAY");
    modelVsMarket = { side: sideAbbr, model: ml.model_fair_prob, market };
  }

  return (
    <div style={{ marginBottom: "var(--sp-6)" }}>
      <SectionHeader>Beat the Book — fair value &amp; vig</SectionHeader>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", margin: "var(--sp-1) 0 var(--sp-3)", lineHeight: "var(--lh-prose)" }}>
        The no-vig fair line is what the book&apos;s own two-sided price implies once the hold
        (overround) is removed. Single-book (no-vig), not a market consensus — and not a pick.
      </div>

      {!hasAnyOffered ? (
        <Card style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)", color: "var(--text-muted)" }}>
          No two-sided price captured for this game — fair value not available.
        </Card>
      ) : (
        <Card style={{ marginBottom: "var(--sp-3)" }}>
          <FairMarketRow
            label="Moneyline"
            offered={ml.offered ? { aTag: fv.away_team_abbr ?? "AWAY", a: ml.offered.away, bTag: fv.home_team_abbr ?? "HOME", b: ml.offered.home } : null}
            fair={ml.fair ? { a: ml.fair.away_odds, b: ml.fair.home_odds } : null}
            holdPct={ml.hold_pct}
          />
          <FairMarketRow
            label={`Total${tot.offered?.line != null ? ` (${tot.offered.line})` : ""}`}
            offered={tot.offered ? { aTag: "Over", a: tot.offered.over, bTag: "Under", b: tot.offered.under } : null}
            fair={tot.fair ? { a: tot.fair.over_odds, b: tot.fair.under_odds } : null}
            holdPct={tot.hold_pct}
          />
          {modelVsMarket && (
            <div style={{ marginTop: "var(--sp-3)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
              <span style={{ color: "var(--text-2)" }}>model vs market</span>{" "}
              <span style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{modelVsMarket.side}</span>{" "}
              model <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{(modelVsMarket.model * 100).toFixed(1)}%</span>{" "}
              vs no-vig <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{(modelVsMarket.market * 100).toFixed(1)}%</span>
            </div>
          )}
        </Card>
      )}

      <BoostEvWidget fv={fv} />
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

type SectionKey = "matchup" | "pitching" | "bullpen" | "model" | "beat";

const SECTION_TABS = [
  { value: "matchup", label: "Matchup" },
  { value: "pitching", label: "Pitching" },
  { value: "bullpen", label: "Bullpen" },
  { value: "model", label: "Model" },
  { value: "beat", label: "Beat the Book" },
];

export function GameDetailPanel({ gameId, date }: { gameId: number; date: string }) {
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [homeBatting, setHomeBatting] = useState<TeamBatting | null>(null);
  const [awayBatting, setAwayBatting] = useState<TeamBatting | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [fairValue, setFairValue] = useState<FairValueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctxFailed, setCtxFailed] = useState(false);
  // Best-effort sub-resources arrive after ctx — track readiness for per-section skeletons.
  const [fairLoading, setFairLoading] = useState(true);
  const [section, setSection] = useState<SectionKey>("matchup");
  const tabsId = "game-detail-tabs";

  useEffect(() => {
    setLoading(true);
    setCtxFailed(false);
    setCtx(null);
    setLive(null);
    setFairValue(null);
    setFairLoading(true);
    setHomeBatting(null);
    setAwayBatting(null);
    api.context(gameId, date).then((c) => {
      setCtx(c);
      setLoading(false);
      if (!c) setCtxFailed(true);
      if (c) {
        api.batting(c.home_team_id, date).then(d => setHomeBatting(d));
        api.batting(c.away_team_id, date).then(d => setAwayBatting(d));
      }
    });
    // Live monitoring is best-effort; default to "No live signal" on failure.
    api.live(gameId).then(setLive).catch(() => setLive(null));
    // Beat-the-Book fair value (no-vig + hold). Best-effort; null hides the panel.
    api.fairValue(gameId).then(setFairValue).catch(() => setFairValue(null)).finally(() => setFairLoading(false));
  }, [gameId, date]);

  if (loading) return (
    <Loading label="Loading game detail">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={5} />
      </div>
    </Loading>
  );
  if (ctxFailed || !ctx) return (
    <ErrorBanner kind="outage" title="Game not found" detail="This game's context could not be loaded. Try again from the slate." />
  );

  const analysis = ctx.analysis;

  return (
    <div>
      {/* Matchup header — sticky parity between drawer + route */}
      <div style={{ marginBottom: "var(--sp-4)", paddingBottom: "var(--sp-4)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
          <TeamLogo abbr={ctx.away_team_abbr} size={42} />
          <div>
            <h2 style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-headline)", letterSpacing: "-0.03em", margin: 0, lineHeight: "var(--lh-tight)" }}>
              {ctx.away_team_abbr} <span style={{ color: "var(--text-2)", fontWeight: "var(--weight-normal)" }}>@</span> {ctx.home_team_abbr}
            </h2>
            <div className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}>
              {ctx.venue} · {ctx.game_date}
            </div>
          </div>
          <TeamLogo abbr={ctx.home_team_abbr} size={42} />
        </div>
        {/* Live monitoring block (verification, not a pick) */}
        <LiveAlert live={live} />
      </div>

      {/* Section tabs */}
      <Tabs
        items={SECTION_TABS}
        value={section}
        onChange={(v) => setSection(v as SectionKey)}
        ariaLabel="Game detail sections"
        style={{ marginBottom: "var(--sp-4)" }}
      />

      {/* Matchup — team stats + weather */}
      <TabPanel baseId={tabsId} tabValue="matchup" active={section === "matchup"}>
        {(ctx.home_form || ctx.away_form) ? (
          <div style={{ marginBottom: "var(--sp-6)" }}>
            <SectionHeader>Team Stats</SectionHeader>
            <TeamStatsCard
              homeAbbr={ctx.home_team_abbr}
              awayAbbr={ctx.away_team_abbr}
              homeForm={(ctx.home_form as Record<string, unknown>)?.l10 as FormWindow}
              awayForm={(ctx.away_form as Record<string, unknown>)?.l10 as FormWindow}
              homeBatting={homeBatting}
              awayBatting={awayBatting}
            />
          </div>
        ) : (
          <EmptyState title="No recent-form data" detail="L10 splits aren't available for this matchup yet." style={{ marginBottom: "var(--sp-6)" }} />
        )}

        {ctx.weather && (
          <div style={{ maxWidth: "360px", marginBottom: "var(--sp-6)" }}>
            <WeatherCard w={ctx.weather} />
          </div>
        )}
      </TabPanel>

      {/* Pitching — starters */}
      <TabPanel baseId={tabsId} tabValue="pitching" active={section === "pitching"}>
        <div style={{ marginBottom: "var(--sp-6)" }}>
          <SectionHeader>Starting Pitchers</SectionHeader>
          <div className="mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <StarterCard abbr={ctx.home_team_abbr} starter={ctx.home_starter} />
            <StarterCard abbr={ctx.away_team_abbr} starter={ctx.away_starter} />
          </div>
        </div>
      </TabPanel>

      {/* Bullpen */}
      <TabPanel baseId={tabsId} tabValue="bullpen" active={section === "bullpen"}>
        <div style={{ marginBottom: "var(--sp-6)" }}>
          <SectionHeader>Bullpen Intelligence</SectionHeader>
          {ctx.home_bullpen || ctx.away_bullpen ? (
            <div className="mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
              {ctx.home_bullpen && <BullpenCard abbr={ctx.home_team_abbr} bp={ctx.home_bullpen} />}
              {ctx.away_bullpen && <BullpenCard abbr={ctx.away_team_abbr} bp={ctx.away_bullpen} />}
            </div>
          ) : (
            <EmptyState title="No bullpen data" detail="Reliever availability hasn't been computed for this game yet." />
          )}
        </div>
      </TabPanel>

      {/* Model verdict */}
      <TabPanel baseId={tabsId} tabValue="model" active={section === "model"}>
        <div style={{ marginBottom: "var(--sp-6)" }}>
          <SectionHeader>Model Verdict</SectionHeader>
          {analysis ? (
            <AnalysisPanel a={analysis} />
          ) : (
            <EmptyState title="No model verdict" detail="The model hasn't produced an analysis for this game." />
          )}
        </div>
      </TabPanel>

      {/* Beat the Book — fair value, hold, boost-EV, line movement */}
      <TabPanel baseId={tabsId} tabValue="beat" active={section === "beat"}>
        {fairLoading ? (
          <div style={{ marginBottom: "var(--sp-6)" }}>
            <SectionHeader>Beat the Book — fair value &amp; vig</SectionHeader>
            <Card><SkeletonText lines={4} /></Card>
          </div>
        ) : fairValue ? (
          <>
            <BeatTheBookPanel fv={fairValue} />
            <MovementPanel fv={fairValue} />
          </>
        ) : (
          <EmptyState
            title="Fair value not available"
            detail="No two-sided book price was captured for this game, so no-vig fair lines can't be computed."
            style={{ marginBottom: "var(--sp-6)" }}
          />
        )}
      </TabPanel>
    </div>
  );
}
