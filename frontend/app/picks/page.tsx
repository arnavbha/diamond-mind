"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { api, todayET, getAdminToken, type GameAnalysis } from "@/lib/api";
import { teamLogoUrl } from "@/lib/team-logos";
import { Gauge, DuelBar, MethodCompare, GrowthReadout, tierColor, pPlusColor } from "@/components/quant";
import { ExplainTooltip } from "@/components/explain";
import { DitherHeader } from "@/components/dither-header";

// ── Track button + unit modal ─────────────────────────────────────────────────

type TrackCtx = {
  game_id: number;
  game_date: string;
  market: "moneyline" | "total";
  selection: string;
  american_odds: number;
  tier: string;
  home_team_abbr: string;
  away_team_abbr: string;
  total_line?: number | null;
  projected_total?: number | null;
};

function TrackModal({
  ctx,
  onClose,
  onTracked,
}: {
  ctx: TrackCtx;
  onClose: () => void;
  onTracked: () => void;
}) {
  const [units, setUnits] = useState("1");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    const u = parseFloat(units);
    if (isNaN(u) || u <= 0) { setErr("Enter a positive number of units."); return; }
    setLoading(true);
    const res = await api.trackerCreateBet({ ...ctx, units: u });
    setLoading(false);
    if (res) { onTracked(); onClose(); }
    else setErr("Failed to track — is the backend running?");
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(8,12,16,0.8)", display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "8px",
          padding: "20px 24px", width: "300px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "16px", marginBottom: "4px" }}>
          Track Bet
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-2)", marginBottom: "14px" }}>
          {ctx.away_team_abbr} @ {ctx.home_team_abbr} · {ctx.selection} · {ctx.american_odds >= 0 ? "+" : ""}{ctx.american_odds}
        </div>
        <label style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Units
        </label>
        <input
          type="number"
          min="0.1"
          step="0.5"
          value={units}
          onChange={(e) => { setUnits(e.target.value); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onClose(); }}
          autoFocus
          style={{
            display: "block", width: "100%", marginTop: "5px", marginBottom: "12px",
            background: "var(--surface-2)", border: "1px solid var(--border-2)",
            borderRadius: "4px", padding: "7px 10px",
            color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "14px", outline: "none",
          }}
        />
        {err && <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--red)", marginBottom: "10px" }}>{err}</div>}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={submit}
            disabled={loading}
            style={{
              flex: 1, padding: "8px", borderRadius: "4px",
              background: "var(--green)", border: "none", color: "#000",
              fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            }}
          >{loading ? "…" : "Track ✓"}</button>
          <button
            onClick={onClose}
            style={{
              padding: "8px 14px", borderRadius: "4px",
              background: "transparent", border: "1px solid var(--border-2)", color: "var(--text-2)",
              fontFamily: "var(--font-mono)", fontSize: "12px", cursor: "pointer",
            }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TeamLogo({ abbr, size = 28 }: { abbr: string; size?: number }) {
  return (
    <img
      src={teamLogoUrl(abbr)}
      alt={abbr}
      width={size}
      height={size}
      style={{ objectFit: "contain", flexShrink: 0 }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}

function offsetDate(base: string, days: number): string {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const btnStyle: React.CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "4px",
    padding: "6px 10px", color: "var(--text-2)", fontFamily: "var(--font-mono)",
    fontSize: "13px", cursor: "pointer", lineHeight: 1,
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <button style={btnStyle} onClick={() => onChange(offsetDate(date, -1))}>←</button>
      <input
        type="date" value={date}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "4px", padding: "6px 10px", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: "12px", outline: "none" }}
      />
      <button style={btnStyle} onClick={() => onChange(offsetDate(date, 1))}>→</button>
    </div>
  );
}

function TotalBadge({
  pick,
  trackedKey,
  onTrack,
}: {
  pick: GameAnalysis;
  trackedKey: string;
  onTrack: (ctx: TrackCtx) => void;
}) {
  const isTotalAction = pick.total_tier === "STRONG LEAN" || pick.total_tier === "LEAN";
  if (!isTotalAction) return null;
  const tc = tierColor(pick.total_tier);
  const dir = pick.total_lean; // "OVER" or "UNDER"
  const isTracked = trackedKey !== "";

  function handleTrack(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const sel = dir === "OVER" ? "OVER" : "UNDER";
    // use total odds: total_lean determines which side; we don't have per-side odds in GameAnalysis so use a placeholder
    onTrack({
      game_id: pick.game_id,
      game_date: pick.game_date ?? "",
      market: "total",
      selection: sel,
      american_odds: -110, // standard total line; user can edit in tracker
      tier: pick.total_tier,
      home_team_abbr: pick.home_team_abbr,
      away_team_abbr: pick.away_team_abbr,
      total_line: pick.total_line ?? null,
      projected_total: pick.projected_total ?? null,
    });
  }

  return (
    <div style={{
      marginTop: "10px", padding: "8px 10px",
      border: `1px solid ${tc}22`, borderRadius: "6px",
      background: `${tc}08`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 800, color: tc, textTransform: "uppercase", letterSpacing: "-0.01em" }}>
          {dir}
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)", marginLeft: "8px" }}>
          {pick.total_line != null ? `o/u ${pick.total_line}` : ""} · proj {pick.projected_total}
        </span>
        <span className="tier-badge" style={{ color: tc, borderColor: tc, marginLeft: "8px", fontSize: "9px" }}>{pick.total_tier}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)" }}>
            P(+) {(pick.qt_prob_positive * 100).toFixed(0)}%
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-3)" }}>
            Kelly {(pick.qt_kelly_sized * 100).toFixed(1)}%
          </div>
        </div>
        <button
          onClick={handleTrack}
          style={{
            fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700,
            padding: "4px 8px", borderRadius: "3px", border: "1px solid",
            cursor: isTracked ? "default" : "pointer",
            color: isTracked ? "var(--green)" : tc,
            borderColor: isTracked ? "var(--green)" : tc,
            background: "transparent",
            whiteSpace: "nowrap",
          }}
        >
          {isTracked ? "Tracked ✓" : "＋ Track"}
        </button>
      </div>
    </div>
  );
}

// ── Pick of the Day ───────────────────────────────────────────────────────────

function PickOfTheDay({ picks, date, unlocked }: { picks: GameAnalysis[]; date: string; unlocked: boolean }) {
  const [copied, setCopied] = useState(false);

  // Best STRONG LEAN ML by Kelly, fall back to best STRONG LEAN total
  const potd = (() => {
    const slMl = picks
      .filter((p) => p.ml_tier === "STRONG LEAN")
      .sort((a, b) => b.ml_kelly_fraction - a.ml_kelly_fraction)[0] ?? null;
    if (slMl) return { pick: slMl, market: "ml" as const };

    const slTotal = picks
      .filter((p) => p.total_tier === "STRONG LEAN")
      .sort((a, b) => b.total_kelly_fraction - a.total_kelly_fraction)[0] ?? null;
    if (slTotal) return { pick: slTotal, market: "total" as const };

    return null;
  })();

  if (!potd) return null;

  const { pick, market } = potd;
  const isMl = market === "ml";
  const leanAbbr = isMl
    ? (pick.ml_lean === "HOME" ? pick.home_team_abbr : pick.away_team_abbr)
    : null;
  const pickLabel = isMl
    ? `${leanAbbr} ML`
    : `${pick.total_lean} o/u ${pick.total_line ?? ""}`;
  const odds = isMl
    ? (pick.ml_american_odds >= 0 ? `+${pick.ml_american_odds}` : `${pick.ml_american_odds}`)
    : "-110";
  const conf = isMl
    ? Math.round(pick.ml_confidence * 100)
    : Math.round(pick.total_confidence * 100);
  const kelly = isMl
    ? (pick.ml_kelly_fraction * 100).toFixed(1)
    : (pick.total_kelly_fraction * 100).toFixed(1);

  const tweetText =
    `🔷 Diamond Mind POTD — ${date}\n\n` +
    `${pick.away_team_abbr} @ ${pick.home_team_abbr}\n` +
    `${pickLabel} (${odds})\n\n` +
    `Model: ${conf}% confidence · ${kelly}% Kelly sizing\n\n` +
    `#MLB #SportsBetting`;

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(tweetText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="potd-card glare-card" style={{
      marginBottom: "28px",
      border: "1px solid rgba(63,185,80,0.35)",
      borderRadius: "8px",
      background: "linear-gradient(135deg, rgba(63,185,80,0.06) 0%, rgba(8,12,16,0) 60%)",
      overflow: "hidden",
    }}>
      {/* Label bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "7px 14px",
        borderBottom: "1px solid rgba(63,185,80,0.2)",
        background: "rgba(63,185,80,0.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="shiny-text" style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}>◆ Pick of the Day</span>
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px",
            color: "var(--text-3)",
            letterSpacing: "0.04em",
          }}>Highest Kelly · Strong Lean</span>
        </div>
        {unlocked && (
          <button
            onClick={handleCopy}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "4px 10px",
              borderRadius: "3px",
              border: "1px solid",
              cursor: "pointer",
              background: "transparent",
              color: copied ? "var(--green)" : "var(--text-3)",
              borderColor: copied ? "var(--green)" : "var(--border-2)",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {copied ? "Copied ✓" : "Copy Tweet"}
          </button>
        )}
      </div>

      {/* Card body */}
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        {/* Matchup */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <TeamLogo abbr={pick.away_team_abbr} size={26} />
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "14px", color: "var(--text-2)" }}>
            {pick.away_team_abbr}
          </span>
          <span style={{ color: "var(--text-3)", fontSize: "11px" }}>@</span>
          <TeamLogo abbr={pick.home_team_abbr} size={26} />
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "14px", color: "var(--text-2)" }}>
            {pick.home_team_abbr}
          </span>
        </div>

        {/* Pick */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: "26px",
            fontWeight: 800,
            color: "var(--green)",
            letterSpacing: "-0.02em",
            lineHeight: 1,
            textTransform: "uppercase",
          }}>
            {pickLabel}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-2)", fontWeight: 600 }}>
            {odds}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: "18px", flexShrink: 0 }}>
          {[
            ["Confidence", `${conf}%`],
            ["Kelly", `${kelly}%`],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "3px" }}>{k}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 800, color: "var(--text)", letterSpacing: "-0.01em" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PickCard({
  pick,
  index,
  trackedIds,
  onTrack,
}: {
  pick: GameAnalysis;
  index: number;
  trackedIds: Set<string>;
  onTrack: (ctx: TrackCtx) => void;
}) {
  const tc = tierColor(pick.ml_tier);
  const isMlAction = pick.ml_tier === "STRONG LEAN" || pick.ml_tier === "LEAN";
  const isTotalAction = pick.total_tier === "STRONG LEAN" || pick.total_tier === "LEAN";
  const leanAbbr = pick.ml_lean === "HOME" ? pick.home_team_abbr : pick.ml_lean === "AWAY" ? pick.away_team_abbr : null;
  const slab = isMlAction ? tc : isTotalAction ? tierColor(pick.total_tier) : "var(--border-2)";

  const mlTrackKey = `${pick.game_id}-ml`;
  const totalTrackKey = `${pick.game_id}-total`;
  const mlTracked = trackedIds.has(mlTrackKey);

  const slabRef = useRef<HTMLDivElement>(null);
  function onSlabMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!slabRef.current) return;
    const rect = slabRef.current.getBoundingClientRect();
    slabRef.current.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    slabRef.current.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  }
  const isActionable = isMlAction || isTotalAction;
  const spotlightColor = isMlAction
    ? "rgba(63,185,80,0.08)"
    : isTotalAction ? "rgba(88,166,255,0.08)" : undefined;

  function handleMlTrack(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!leanAbbr) return;
    onTrack({
      game_id: pick.game_id,
      game_date: pick.game_date ?? "",
      market: "moneyline",
      selection: leanAbbr,
      american_odds: pick.ml_american_odds,
      tier: pick.ml_tier,
      home_team_abbr: pick.home_team_abbr,
      away_team_abbr: pick.away_team_abbr,
    });
  }

  return (
    <Link href={`/game/${pick.game_id}?date=${pick.game_date ?? ""}`} style={{ textDecoration: "none" }}>
      <div
        className="fade-up game-card"
        style={{ "--delay": `${index * 45}ms`, "--slab-color": slab } as React.CSSProperties}
      >
        <div
          ref={slabRef}
          className={`verdict-slab glare-card${isActionable ? " spotlight-card" : ""}`}
          style={{
            "--slab-color": slab,
            ...(spotlightColor ? { "--spotlight-color": spotlightColor } : {}),
          } as React.CSSProperties}
          onMouseMove={isActionable ? onSlabMouseMove : undefined}
        >
          {/* Top: matchup + tier */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <TeamLogo abbr={pick.away_team_abbr} size={22} />
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "15px" }}>{pick.away_team_abbr}</span>
              <span style={{ color: "var(--text-3)", fontSize: "12px" }}>@</span>
              <TeamLogo abbr={pick.home_team_abbr} size={22} />
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "15px" }}>{pick.home_team_abbr}</span>
              {pick.venue && <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-3)", marginLeft: "4px" }}>{pick.venue}</span>}
            </div>
            <ExplainTooltip term="tiers">
              <span className="tier-badge" style={{ color: tc, borderColor: tc }}>{pick.ml_tier}</span>
            </ExplainTooltip>
          </div>

          {/* Middle: ML verdict + gauge */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "20px", alignItems: "center", marginTop: "14px" }}>
            <div>
              {isMlAction && leanAbbr ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "30px", fontWeight: 800, color: tc, textTransform: "uppercase", lineHeight: 1, letterSpacing: "-0.02em" }}>
                      {leanAbbr} ML
                    </div>
                    <button
                      onClick={handleMlTrack}
                      style={{
                        fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700,
                        padding: "4px 8px", borderRadius: "3px", border: "1px solid",
                        cursor: mlTracked ? "default" : "pointer",
                        color: mlTracked ? "var(--green)" : tc,
                        borderColor: mlTracked ? "var(--green)" : tc,
                        background: "transparent", whiteSpace: "nowrap",
                        marginTop: "2px",
                      }}
                    >
                      {mlTracked ? "Tracked ✓" : "＋ Track"}
                    </button>
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-2)", marginTop: "5px" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{pick.ml_american_odds > 0 ? "+" : ""}{pick.ml_american_odds}</span>
                    {" · Shin-devigged · shrunk to "}
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text)", fontWeight: 600 }}>
                      {(pick.q_p_shrunk * 100).toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 800, color: "var(--text-3)", textTransform: "uppercase", lineHeight: 1 }}>
                  {pick.ml_tier === "AVOID" ? "AVOID" : "PASS"}
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-3)", fontWeight: 400, marginTop: "5px" }}>
                    P(+EV) {(pick.q_prob_positive * 100).toFixed(0)}% — below action threshold
                  </div>
                </div>
              )}
              <div style={{ marginTop: "12px" }}>
                <DuelBar model={pick.q_p_shrunk} market={pick.q_shin_vig_free} lower={pick.q_ci_low} upper={pick.q_ci_high} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Gauge p={pick.q_prob_positive} size={132} />
            </div>
          </div>

          {/* Total pick row */}
          <TotalBadge
            pick={pick}
            trackedKey={trackedIds.has(totalTrackKey) ? totalTrackKey : ""}
            onTrack={(ctx) => onTrack(ctx)}
          />

          {/* ── Quant panel — recessed, reads second ── */}
          <div style={{
            marginTop: "16px",
            marginLeft: "-20px",
            marginRight: "-20px",
            marginBottom: "-18px",
            padding: "12px 20px 16px",
            borderTop: "1px solid var(--border)",
            background: "rgba(0,0,0,0.18)",
          }}>
            {/* Panel header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "10px",
            }}>
              <span className="section-label" style={{ margin: 0 }}>Bankroll math</span>
              <ExplainTooltip term="uncertainty-kelly" />
            </div>

            <GrowthReadout a={pick} />

            {isMlAction && (
              <div style={{ marginTop: "12px" }}>
                <MethodCompare a={pick} />
              </div>
            )}

            {pick.key_factors.length > 0 && (
              <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                {pick.key_factors.slice(0, 2).map((f, i) => (
                  <div key={i} style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-3)", marginBottom: "3px", paddingLeft: "8px", borderLeft: "1px solid var(--border-2)", lineHeight: 1.4 }}>{f}</div>
                ))}
                {pick.cautions.slice(0, 1).map((c, i) => (
                  <div key={i} style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--orange)", marginTop: "4px", paddingLeft: "8px", borderLeft: "1px solid rgba(210,153,34,0.4)", lineHeight: 1.4 }}>{c}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function PicksPage() {
  const today = todayET();
  const [date, setDate] = useState(today);
  const [picks, setPicks] = useState<GameAnalysis[] | null>(null);
  const [error, setError] = useState(false);
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
  const [trackModal, setTrackModal] = useState<TrackCtx | null>(null);
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminToken()));

  useEffect(() => {
    let alive = true;
    api.picks(date).then((p) => {
      if (!alive) return;
      if (p === null) setError(true);
      else setPicks(p);
    });
    return () => { alive = false; };
  }, [date]);

  function changeDate(d: string) { setPicks(null); setError(false); setDate(d); }

  function handleOpenTrack(ctx: TrackCtx) {
    setTrackModal(ctx);
  }

  function handleTracked() {
    if (!trackModal) return;
    const key = `${trackModal.game_id}-${trackModal.market === "moneyline" ? "ml" : "total"}`;
    setTrackedIds((prev) => new Set([...prev, key]));
    setTrackModal(null);
  }

  const isAction = (p: GameAnalysis) =>
    p.ml_tier === "STRONG LEAN" || p.ml_tier === "LEAN" ||
    p.total_tier === "STRONG LEAN" || p.total_tier === "LEAN";
  const actionable = picks?.filter(isAction) ?? [];
  const rest = picks?.filter((p) => !isAction(p)) ?? [];

  return (
    <div>
      {trackModal && (
        <TrackModal
          ctx={trackModal}
          onClose={() => setTrackModal(null)}
          onTracked={handleTracked}
        />
      )}

      {/* Header with dither canvas as background */}
      <div style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        marginBottom: "0",
        border: "1px solid #3FB95066",
      }}>
        <DitherHeader height={120} color={[0.2, 0.85, 0.35]} speed={0.05} colorNum={4} pixelSize={2} />
        {/* Title anchored to bottom-left — editorial banner style */}
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 20px 16px",
          background: "linear-gradient(to right, rgba(8,12,16,0.65) 0%, rgba(8,12,16,0.2) 60%, rgba(8,12,16,0.55) 100%)",
        }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "22px", letterSpacing: "-0.02em", margin: 0, textTransform: "uppercase", textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}>
              Daily Picks
            </h1>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "rgba(255,255,255,0.7)", marginTop: "4px", display: "flex", alignItems: "center", gap: "7px", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
              <span className="live-dot" />
              {picks
                ? `${picks.length} games · ${actionable.length} actionable (ML + O/U) · Shin + Bayesian quant · ${date}`
                : `Shin + Bayesian quant model · ${date}`}
            </div>
          </div>
        </div>
      </div>

      {/* Date nav row — separate from decorative header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "10px 0",
        marginBottom: "20px",
        borderBottom: "1px solid var(--border)",
      }}>
        <DateNav date={date} onChange={changeDate} />
      </div>

      {error && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--red)", padding: "10px 12px", border: "1px solid var(--red)", borderRadius: "4px", marginBottom: "16px" }}>
          Unable to load picks data. The backend may be starting up — try refreshing in a moment.
        </div>
      )}
      {!error && picks === null && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>Loading…</div>
      )}
      {picks?.length === 0 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>No games found for {date}.</div>
      )}

      {picks && picks.length > 0 && (
        <PickOfTheDay picks={picks} date={date} unlocked={unlocked} />
      )}

      {actionable.length > 0 && (
        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            ▸ Actionable — {actionable.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {actionable.map((p, i) => (
              <PickCard
                key={p.game_id} pick={p} index={i}
                trackedIds={trackedIds} onTrack={handleOpenTrack}
              />
            ))}
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          {actionable.length > 0 && (
            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-3)", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              ▸ Rest of slate — {rest.length}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {rest.map((p, i) => (
              <PickCard
                key={p.game_id} pick={p} index={actionable.length + i}
                trackedIds={trackedIds} onTrack={handleOpenTrack}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
