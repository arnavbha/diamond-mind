"use client";

import React, { useEffect, useState } from "react";
import { api, todayET, type GameContext, type WeatherData, type GameAnalysis, type TeamBatting, type LiveState, type FairValueResult, type BoostEv, type Movement } from "@/lib/api";
import { teamLogoUrl } from "@/lib/team-logos";
import { Gauge, DuelBar, MethodCompare, GrowthReadout } from "@/components/quant";
import { ExplainTooltip } from "@/components/explain";
import { LiveAlert } from "@/components/live-alert";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function TeamLogo({ abbr, size = 40 }: { abbr: string; size?: number }) {
  return (
    <img src={teamLogoUrl(abbr)} alt={abbr} width={size} height={size}
      style={{ objectFit: "contain", flexShrink: 0 }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: "10px" }}>
      {children}
    </div>
  );
}

function StatRow({ label, value, mono = true }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-body)", fontSize: "13px", color: "var(--text)", fontWeight: 500 }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function ScoreBar({ value, color, delay = 0 }: { value: number; color: string; delay?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div className="stat-bar-track" style={{ flex: 1 }}>
        <div className="stat-bar-fill"
          style={{ "--fill": `${value}%`, "--delay": `${delay}ms`, background: color } as React.CSSProperties}
        />
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color, fontWeight: 600, width: "40px", textAlign: "right" }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

function vulnColor(score: number) {
  if (score >= 70) return "var(--red)";
  if (score >= 50) return "var(--orange)";
  return "var(--green)";
}

function BullpenCard({ abbr, bp }: { abbr: string; bp: NonNullable<GameContext["home_bullpen"]> }) {
  const vc = vulnColor(bp.vulnerability_score);
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `2px solid ${vc}`, borderRadius: "6px", padding: "16px" }}>
      <Label>{abbr} Bullpen</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "14px" }}>
        <div>
          <div style={{ marginBottom: "4px" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontWeight: 500 }}>Vulnerability</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", marginLeft: "6px" }}>— how exposed the pen is tonight (0 = fresh, 100 = gassed)</span>
          </div>
          <ScoreBar value={bp.vulnerability_score} color={vc} delay={0} />
        </div>
        <div>
          <div style={{ marginBottom: "4px" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontWeight: 500 }}>Fatigue</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", marginLeft: "6px" }}>— pitcher workload over last 3 days</span>
          </div>
          <ScoreBar value={bp.fatigue_score} color="var(--text-2)" delay={80} />
        </div>
        <div>
          <div style={{ marginBottom: "4px" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontWeight: 500 }}>Available Quality</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", marginLeft: "6px" }}>— quality of relievers who can pitch tonight</span>
          </div>
          <ScoreBar value={bp.available_quality} color="var(--amber)" delay={160} />
        </div>
      </div>
      {(bp.unavailable_relievers?.length ?? 0) > 0 && (
        <div style={{ marginTop: "8px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red)" }}>
          Can&apos;t pitch tonight: {bp.unavailable_relievers.join(", ")}
        </div>
      )}
      {(bp.limited_relievers?.length ?? 0) > 0 && (
        <div style={{ marginTop: "4px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--orange)" }}>
          Limited (high usage): {bp.limited_relievers.join(", ")}
        </div>
      )}
      {(bp.best_available?.length ?? 0) > 0 && (
        <div style={{ marginTop: "4px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--green)" }}>
          Best available: {bp.best_available.join(", ")}
        </div>
      )}
      <div style={{ marginTop: "12px", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontStyle: "italic", lineHeight: 1.4 }}>
        {bp.betting_implication}
      </div>
    </div>
  );
}

function StarterCard({ abbr, starter }: { abbr: string; starter: NonNullable<GameContext["home_starter"]> | null }) {
  const fipColor = starter?.fip != null
    ? starter.fip <= 3.20 ? "var(--green)" : starter.fip >= 4.50 ? "var(--red)" : "var(--text)"
    : "var(--text)";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px" }}>
      <Label>{abbr} Starting Pitcher</Label>
      {starter ? (
        <>
          <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "12px", color: "var(--text)", letterSpacing: "-0.01em" }}>
            {starter.pitcher_name}
          </div>
          {starter.insufficient_sample && starter.starts === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--text-2)", lineHeight: 1.45 }}>
              Announced starter — no recent-start sample available yet.
            </div>
          ) : (
            <>
              <StatRow label="ERA" value={starter.era?.toFixed(2)} />
              {starter.fip != null && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-2)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <ExplainTooltip term="fip"><span>FIP</span></ExplainTooltip>
                  </span>
                  <span className="scoreboard-num" style={{ fontSize: "14px", color: fipColor }}>{starter.fip.toFixed(2)}</span>
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
            <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--amber)" }}>Small sample — fewer than 5 starts</div>
          )}
        </>
      ) : (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-3)" }}>Starter not yet announced</div>
      )}
    </div>
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
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px" }}>
      <Label>Conditions</Label>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-2)" }}>Indoor venue — weather not a factor.</div>
    </div>
  );
  const tempNote = w.temperature_f != null
    ? w.temperature_f >= 85 ? " (hot)" : w.temperature_f <= 50 ? " (cold)" : "" : "";
  const windNote = w.wind_speed_mph != null && w.wind_direction_deg != null && w.wind_speed_mph >= 6
    ? windEffect(w.wind_speed_mph, w.wind_direction_deg) : null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px" }}>
      <Label>Conditions</Label>
      <StatRow label={`Temp${tempNote}`} value={w.temperature_f != null ? `${w.temperature_f}°F` : null} />
      {w.wind_speed_mph != null && (
        <StatRow
          label={`Wind — ${w.wind_speed_mph} mph from ${w.wind_direction_deg != null ? degreesToCompass(w.wind_direction_deg) : "?"}`}
          value={windNote ?? "calm"} mono={false}
        />
      )}
      <StatRow label="Precip chance" value={w.precipitation_chance != null ? `${w.precipitation_chance}%` : null} />
    </div>
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
    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: homeWins ? "var(--text)" : "var(--text-2)", fontWeight: homeWins ? 600 : 400, textAlign: "right" }}>
        {hVal !== null ? fmt(hVal) : "—"}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", textAlign: "center", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: awayWins ? "var(--text)" : "var(--text-2)", fontWeight: awayWins ? 600 : 400, textAlign: "left" }}>
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
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", marginBottom: "12px" }}>
        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)", textAlign: "right", letterSpacing: "-0.01em" }}>{homeAbbr}</div>
        <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em", color: "var(--text-3)", textTransform: "uppercase", textAlign: "center", paddingTop: "3px" }}>L10</div>
        <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text-2)", textAlign: "left", letterSpacing: "-0.01em" }}>{awayAbbr}</div>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", padding: "5px 0" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-2)", textAlign: "right" }}>{hf?.trend_label?.replace(/_/g, " ") ?? "—"}</span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", textAlign: "center" }}>Trend</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-2)", textAlign: "left" }}>{af?.trend_label?.replace(/_/g, " ") ?? "—"}</span>
        </div>
      )}
    </div>
  );
}

function tierColor(tier: string) {
  if (tier === "STRONG LEAN") return "var(--green)";
  if (tier === "LEAN") return "var(--blue)";
  if (tier === "AVOID") return "var(--red)";
  return "var(--text-3)";
}

function AnalysisPanel({ a }: { a: GameAnalysis }) {
  const tc = tierColor(a.ml_tier);
  const leanAbbr = a.ml_lean === "HOME" ? a.home_team_abbr
    : a.ml_lean === "AWAY" ? a.away_team_abbr
    : (a.ml_lean && a.ml_lean !== "PASS") ? a.ml_lean
    : null;
  const isActionable = leanAbbr !== null && a.ml_tier !== "AVOID";
  const evPct = a.ev_per_dollar != null ? a.ev_per_dollar * 100 : null;
  const cardClass = a.ml_tier === "STRONG LEAN" ? "card-strong-lean" : a.ml_tier === "LEAN" ? "card-lean" : "";

  return (
    <div style={{ marginBottom: "24px" }}>
      <div className="section-label">Model Verdict</div>
      <div className={cardClass} style={{ background: "var(--surface)", border: `1px solid ${isActionable ? tc : "var(--border)"}`, borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", background: isActionable ? `rgba(${a.ml_tier === "STRONG LEAN" ? "63,185,80" : "88,166,255"},0.04)` : "transparent", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 800, color: tc, letterSpacing: "0.02em", textTransform: "uppercase", lineHeight: 1 }}>
              {isActionable ? `${leanAbbr} ML` : a.ml_tier}
            </div>
            {isActionable && (
              <div style={{ fontSize: "11px", color: "var(--text-2)", marginTop: "5px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                  {a.ml_american_odds > 0 ? "+" : ""}{a.ml_american_odds}
                </span>{" "}· {a.ml_tier}
              </div>
            )}
          </div>
          {isActionable && (
            <div style={{ display: "flex", gap: "24px", textAlign: "right" }}>
              <div>
                <div className="data-label" style={{ textAlign: "right" }}>EV / dollar</div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "20px", color: evPct != null && evPct > 0 ? "var(--green)" : "var(--red)", lineHeight: 1.1 }}>
                  {evPct != null ? `${evPct > 0 ? "+" : ""}${evPct.toFixed(1)}¢` : "—"}
                </div>
                <div style={{ fontSize: "9px", color: "var(--text-3)", marginTop: "2px" }}>per $1 wagered</div>
              </div>
              <div>
                <div className="data-label" style={{ textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px" }}>
                  Kelly <ExplainTooltip term="uncertainty-kelly" />
                </div>
                <div className="scoreboard-num" style={{ fontSize: "22px", color: "var(--text)", lineHeight: 1.1 }}>
                  {(a.ml_kelly_fraction * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: "9px", color: "var(--text-3)", marginTop: "2px" }}>of bankroll</div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "20px", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                model{" "}
                <span className="scoreboard-num" style={{ fontSize: "13px", color: "var(--text)" }}>{(a.q_p_model * 100).toFixed(1)}%</span>{" "}→{" "}
                <ExplainTooltip term="bayesian-shrinkage"><span>shrunk</span></ExplainTooltip>{" "}
                <strong className="scoreboard-num" style={{ color: "var(--text)", fontSize: "13px" }}>{(a.q_p_shrunk * 100).toFixed(1)}%</strong>{" "}vs{" "}
                <ExplainTooltip term="shin-devig"><span>Shin market</span></ExplainTooltip>{" "}
                <span className="scoreboard-num" style={{ fontSize: "13px", color: "var(--text)" }}>{(a.q_shin_vig_free * 100).toFixed(1)}%</span>
              </div>
              <DuelBar model={a.q_p_shrunk} market={a.q_shin_vig_free} lower={a.q_ci_low} upper={a.q_ci_high} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <Gauge p={a.q_prob_positive} size={140} />
              <ExplainTooltip term="p-plus-ev">
                <span style={{ fontSize: "9px", color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase" }}>P(+EV)</span>
              </ExplainTooltip>
            </div>
          </div>
          <div className="section-label" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>Bankroll growth <ExplainTooltip term="expected-log-growth" /></span>
            <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>Doubling <ExplainTooltip term="doubling-time" /></span>
          </div>
          <GrowthReadout a={a} />
          {isActionable && <div style={{ marginTop: "16px" }}><MethodCompare a={a} /></div>}
        </div>

        <div className="mobile-stack" style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0" }}>
          <div style={{ padding: "0 14px 0 0", borderRight: "1px solid var(--border)" }}>
            <div className="data-label" style={{ marginBottom: "8px" }}>Win Probability</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {[
                { abbr: a.home_team_abbr, prob: a.model_home_win_prob },
                { abbr: a.away_team_abbr, prob: a.model_away_win_prob },
              ].map(({ abbr, prob }) => (
                <div key={abbr} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "10px", color: "var(--text-3)", width: "30px" }}>{abbr}</span>
                  <div className="stat-bar-track" style={{ flex: 1 }}>
                    <div className="stat-bar-fill" style={{ "--fill": `${prob * 100}%`, background: "var(--blue)" } as React.CSSProperties} />
                  </div>
                  <span className="scoreboard-num" style={{ fontSize: "14px", color: "var(--text)", width: "42px", textAlign: "right" }}>
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: "0 14px", borderRight: "1px solid var(--border)" }}>
            <div className="data-label" style={{ marginBottom: "8px" }}>Total (O/U)</div>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "18px", color: a.total_lean === "OVER" ? "var(--amber)" : a.total_lean === "UNDER" ? "var(--blue)" : "var(--text-3)" }}>
              {a.total_lean === "PASS" ? "NO LEAN" : a.total_lean}
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-3)", marginTop: "4px" }}>
              proj <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{a.projected_total.toFixed(1)}</span> runs
            </div>
          </div>
          <div style={{ padding: "0 0 0 14px" }}>
            <div className="data-label" style={{ marginBottom: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
              Base Rate <ExplainTooltip term="vig-overround" />
            </div>
            <div style={{ fontSize: "10px", color: "var(--text-2)", lineHeight: 1.6 }}>
              Home adv: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>53.5%</span><br/>
              Vig: <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{a.overround != null ? `${((a.overround - 1) * 100).toFixed(1)}%` : "—"}</span>
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
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                <div className="data-label">Factor Waterfall</div>
                <div style={{ fontSize: "9px", color: "var(--text-3)", display: "flex", gap: "12px" }}>
                  <span style={{ color: "var(--red)" }}>← {a.away_team_abbr}</span>
                  <span style={{ color: "var(--green)" }}>{a.home_team_abbr} →</span>
                </div>
              </div>
              {components.map(({ label, val, note }) => {
                const pct = (Math.abs(val) / maxAbs) * 80;
                const color = val > 0 ? "var(--green)" : "var(--red)";
                return (
                  <div key={label} style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                      <div>
                        <span style={{ fontSize: "11px", color: "var(--text-2)", fontFamily: "var(--font-mono)" }}>{label}</span>
                        <span style={{ fontSize: "9px", color: "var(--text-3)", marginLeft: "8px" }}>{note}</span>
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color, fontWeight: 700 }}>
                        {val > 0 ? "+" : ""}{(val * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                        {val < 0 && <div style={{ width: `${pct}%`, height: "4px", background: color, borderRadius: "1px" }} />}
                      </div>
                      <div style={{ width: "1px", height: "8px", background: "var(--border-2)", flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        {val > 0 && <div style={{ width: `${pct}%`, height: "4px", background: color, borderRadius: "1px" }} />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {a.key_factors.length > 0 && (
          <div style={{ padding: "14px 20px", borderBottom: a.cautions.length > 0 ? "1px solid var(--border)" : "none" }}>
            <div className="data-label" style={{ marginBottom: "8px" }}>Key Factors</div>
            {a.key_factors.map((f, i) => (
              <div key={i} style={{ fontSize: "11px", color: "var(--text-2)", marginBottom: "4px", paddingLeft: "8px", borderLeft: "1px solid var(--border-2)" }}>{f}</div>
            ))}
          </div>
        )}

        {a.cautions.length > 0 && (
          <div style={{ padding: "12px 20px", background: "rgba(240,136,62,0.04)" }}>
            {a.cautions.map((c, i) => (
              <div key={i} style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--orange)", marginBottom: "3px" }}>{c}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Beat-the-Book: fair value, book hold, profit-boost EV ───────────────────────

function fmtAmerican(n: number | null | undefined): string {
  if (n == null) return "—";
  return n >= 0 ? `+${n}` : `${n}`;
}

function verdictColor(verdict: string): string {
  if (verdict === "+EV") return "var(--green)";
  if (verdict === "-EV") return "var(--red)";
  return "var(--amber)"; // marginal
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
      <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>
          {label} — odds not captured (two-sided price required)
        </span>
      </div>
    );
  }
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
        {holdPct != null && (
          <span
            title="Book hold (overround) — the vig baked into both sides of this market"
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--orange)", fontWeight: 600 }}
          >
            hold {holdPct.toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "6px" }}>
        {[
          { tag: offered.aTag, off: offered.a, fr: fair?.a ?? null },
          { tag: offered.bTag, off: offered.b, fr: fair?.b ?? null },
        ].map(({ tag, off, fr }) => (
          <div key={tag} style={{ display: "flex", alignItems: "baseline", gap: "6px", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            <span style={{ color: "var(--text-3)", width: "34px" }}>{tag}</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{fmt(off)}</span>
            <span style={{ color: "var(--text-3)", fontSize: "10px" }}>book</span>
            <span style={{ color: "var(--text-3)" }}>·</span>
            <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{fmt(fr)}</span>
            <span style={{ color: "var(--text-3)", fontSize: "10px" }}>fair</span>
          </div>
        ))}
      </div>
      {!fair && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)", marginTop: "4px" }}>
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

  const inputStyle: React.CSSProperties = {
    background: "var(--bg)", border: "1px solid var(--border-2)", borderRadius: "4px",
    padding: "5px 8px", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "12px",
    width: "100%", outline: "none",
  };
  const sideBtn = (active: boolean): React.CSSProperties => ({
    background: active ? "var(--surface-2, var(--surface))" : "transparent",
    border: `1px solid ${active ? "var(--blue)" : "var(--border-2)"}`,
    color: active ? "var(--text)" : "var(--text-2)",
    borderRadius: "4px", padding: "5px 10px", cursor: "pointer",
    fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600,
  });

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px" }}>
      <Label>Profit-Boost EV</Label>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", marginBottom: "12px", lineHeight: 1.45 }}>
        A profit boost lifts your winnings only (never the stake). Enter a boost % and a fair
        win probability to verify whether the promo is +EV — this is a check, not a recommendation.
      </div>

      {/* Side toggle (moneyline) */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
        <button style={sideBtn(side === "away")} onClick={() => pickSide("away")}>{awayAbbr}</button>
        <button style={sideBtn(side === "home")} onClick={() => pickSide("home")}>{homeAbbr}</button>
        {modelSide && (
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)", alignSelf: "center" }}>
            seeded from model · {modelSide === "home" ? homeAbbr : awayAbbr}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "10px" }}>
        <div>
          <div style={{ fontSize: "9px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>{sideLabel} price</div>
          <input style={inputStyle} value={oddsStr} onChange={(e) => setOddsStr(e.target.value)} placeholder="e.g. -120" inputMode="numeric" />
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>boost %</div>
          <input style={inputStyle} value={String(boostPct)} onChange={(e) => setBoostPct(parseFloat(e.target.value))} inputMode="decimal" />
        </div>
        <div>
          <div style={{ fontSize: "9px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "3px" }}>fair win %</div>
          <input style={inputStyle} value={probStr} onChange={(e) => setProbStr(e.target.value)} placeholder="e.g. 55" inputMode="decimal" />
        </div>
      </div>

      <button
        onClick={compute}
        disabled={busy}
        style={{
          background: "var(--blue)", border: "none", borderRadius: "4px", padding: "7px 14px",
          color: "#fff", fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 600,
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Evaluating…" : "Evaluate boost"}
      </button>

      {err && (
        <div style={{ marginTop: "10px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red)" }}>{err}</div>
      )}

      {result && (
        <div style={{ marginTop: "14px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-2)" }}>
              boosted price{" "}
              <span style={{ color: "var(--text)", fontWeight: 700 }}>{fmtAmerican(result.boosted_american)}</span>
            </span>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 700,
              color: verdictColor(result.verdict),
              border: `1px solid ${verdictColor(result.verdict)}`, borderRadius: "4px", padding: "2px 8px",
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
    </div>
  );
}

// ── Line movement (single-book net move, open → close) ──────────────────────
// Verification readout, NOT cross-book "steam". Reports one bookmaker's net move
// between the opening and latest pre-first-pitch snapshots, and whether the
// market moved toward or away from the model's leaned side. Honest empty state
// when fewer than two pre-pitch snapshots exist. No fabricated numbers.

function movementLabelColor(label: Movement["label"]): string {
  if (label === "confirmation") return "var(--green)";
  if (label === "fade") return "var(--red)";
  return "var(--text-3)"; // flat / null
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
      <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontWeight: 500, marginBottom: "2px" }}>{label}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>{why}</div>
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
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
        {m.label && (
          <span
            title="Whether the book's net move went toward or away from the model's leaned side"
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" }}
          >
            {m.label}
          </span>
        )}
      </div>

      {/* Open → close prices (and total line when it moved) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", marginTop: "6px", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ color: "var(--text-3)", fontSize: "10px" }}>price</span>
          <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{fmtAmerican(m.open.american)}</span>
          <span style={{ color: "var(--text-3)" }}>→</span>
          <span style={{ color: "var(--text)", fontWeight: 700 }}>{fmtAmerican(m.close.american)}</span>
          <span style={{ color: "var(--text-3)", fontSize: "10px" }}>({fmtSignedNum(m.american_delta, 0)})</span>
        </span>
        {lineMoved && (
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "var(--text-3)", fontSize: "10px" }}>total</span>
            <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{m.open.line}</span>
            <span style={{ color: "var(--text-3)" }}>→</span>
            <span style={{ color: "var(--text)", fontWeight: 700 }}>{m.close.line}</span>
            <span style={{ color: "var(--text-3)", fontSize: "10px" }}>({fmtSignedNum(m.line_delta, 1)})</span>
          </span>
        )}
      </div>

      {/* Vig-free implied-prob delta for the measured side */}
      <div style={{ marginTop: "5px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)" }}>
        <span style={{ color: "var(--text-3)" }}>
          {probApprox ? "implied-prob Δ (price-implied)" : "vig-free implied-prob Δ"}
          {sideTag ? ` · ${sideTag}` : ""}
        </span>{" "}
        <span style={{ color: "var(--text)", fontWeight: 600 }}>
          {m.devig_prob_delta != null ? fmtSignedPct(m.devig_prob_delta) : (lineMoved ? "see line move" : "—")}
        </span>
      </div>

      {/* Direction vs model side */}
      {sideTag && m.agreement && (
        <div style={{ marginTop: "4px", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
          <span style={{ color: "var(--text-3)" }}>market moved</span>{" "}
          <span style={{ color, fontWeight: 600 }}>{dirWord} {sideTag}</span>
        </div>
      )}

      {m.bookmaker && (
        <div style={{ marginTop: "4px", fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)" }}>
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
    <div style={{ marginBottom: "24px" }}>
      <div className="section-label">Line movement — open → close (single book)</div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", margin: "4px 0 12px", lineHeight: 1.45 }}>
        Net move for one bookmaker between the opening and the latest pre-first-pitch snapshot —
        and whether it went toward or away from the model&apos;s leaned side. This is single-book
        line movement, not a cross-book market read; the price delta is for context only.
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px" }}>
        <MovementMarketRow label="Moneyline" m={mlMove} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
        <MovementMarketRow label={`Total${totLine != null ? ` (${totLine})` : ""}`} m={totMove} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
      </div>
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
    <div style={{ marginBottom: "24px" }}>
      <div className="section-label">Beat the Book — fair value &amp; vig</div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-3)", margin: "4px 0 12px", lineHeight: 1.45 }}>
        The no-vig fair line is what the book&apos;s own two-sided price implies once the hold
        (overround) is removed. Single-book (no-vig), not a market consensus — and not a pick.
      </div>

      {!hasAnyOffered ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-3)" }}>
          No two-sided price captured for this game — fair value not available.
        </div>
      ) : (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "16px", marginBottom: "12px" }}>
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
            <div style={{ marginTop: "10px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)" }}>
              <span style={{ color: "var(--text-3)" }}>model vs market</span>{" "}
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{modelVsMarket.side}</span>{" "}
              model <span style={{ color: "var(--text)", fontWeight: 600 }}>{(modelVsMarket.model * 100).toFixed(1)}%</span>{" "}
              vs no-vig <span style={{ color: "var(--text)", fontWeight: 600 }}>{(modelVsMarket.market * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
      )}

      <BoostEvWidget fv={fv} />
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function GameDetailPanel({ gameId, date }: { gameId: number; date: string }) {
  const [ctx, setCtx] = useState<GameContext | null>(null);
  const [homeBatting, setHomeBatting] = useState<TeamBatting | null>(null);
  const [awayBatting, setAwayBatting] = useState<TeamBatting | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [fairValue, setFairValue] = useState<FairValueResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setCtx(null);
    setLive(null);
    setFairValue(null);
    api.context(gameId, date).then((c) => {
      setCtx(c);
      setLoading(false);
      if (c) {
        api.batting(c.home_team_id, date).then(d => setHomeBatting(d));
        api.batting(c.away_team_id, date).then(d => setAwayBatting(d));
      }
    });
    // Live monitoring is best-effort; default to "No live signal" on failure.
    api.live(gameId).then(setLive).catch(() => setLive(null));
    // Beat-the-Book fair value (no-vig + hold). Best-effort; null hides the panel.
    api.fairValue(gameId).then(setFairValue).catch(() => setFairValue(null));
  }, [gameId, date]);

  if (loading) return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>Loading…</div>
  );
  if (!ctx) return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--red)" }}>Game not found.</div>
  );

  const analysis = ctx.analysis;

  return (
    <div>
      {/* Matchup header */}
      <div style={{ marginBottom: "24px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <TeamLogo abbr={ctx.away_team_abbr} size={42} />
          <div>
            <h2 style={{ fontWeight: 700, fontSize: "24px", letterSpacing: "-0.03em", margin: 0, lineHeight: 1.1 }}>
              {ctx.away_team_abbr} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>@</span> {ctx.home_team_abbr}
            </h2>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)", marginTop: "5px" }}>
              {ctx.venue} · {ctx.game_date}
            </div>
          </div>
          <TeamLogo abbr={ctx.home_team_abbr} size={42} />
        </div>
        {/* Live monitoring block (verification, not a pick) */}
        <LiveAlert live={live} />
      </div>

      {/* Team stats */}
      {(ctx.home_form || ctx.away_form) && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: "12px" }}>Team Stats</div>
          <TeamStatsCard
            homeAbbr={ctx.home_team_abbr}
            awayAbbr={ctx.away_team_abbr}
            homeForm={(ctx.home_form as Record<string, unknown>)?.l10 as FormWindow}
            awayForm={(ctx.away_form as Record<string, unknown>)?.l10 as FormWindow}
            homeBatting={homeBatting}
            awayBatting={awayBatting}
          />
        </div>
      )}

      {/* Starters */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: "12px" }}>Starting Pitchers</div>
        <div className="mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <StarterCard abbr={ctx.home_team_abbr} starter={ctx.home_starter} />
          <StarterCard abbr={ctx.away_team_abbr} starter={ctx.away_starter} />
        </div>
      </div>

      {/* Bullpens */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-2)", marginBottom: "12px" }}>Bullpen Intelligence</div>
        <div className="mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {ctx.home_bullpen && <BullpenCard abbr={ctx.home_team_abbr} bp={ctx.home_bullpen} />}
          {ctx.away_bullpen && <BullpenCard abbr={ctx.away_team_abbr} bp={ctx.away_bullpen} />}
        </div>
      </div>

      {/* Weather */}
      {ctx.weather && (
        <div style={{ maxWidth: "360px", marginBottom: "24px" }}>
          <WeatherCard w={ctx.weather} />
        </div>
      )}

      {/* Analysis */}
      {analysis && <AnalysisPanel a={analysis} />}

      {/* Beat the Book — no-vig fair value, book hold, profit-boost EV calculator */}
      {fairValue && <BeatTheBookPanel fv={fairValue} />}

      {/* Line movement — single-book net move (open → close) toward/away the model side */}
      {fairValue && <MovementPanel fv={fairValue} />}
    </div>
  );
}
