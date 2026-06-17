"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { api, todayET, getAdminToken, type GameAnalysis } from "@/lib/api";
import { Gauge, DuelBar, MethodCompare, GrowthReadout, tierColor } from "@/components/quant";
import { ExplainTooltip } from "@/components/explain";
import {
  Card,
  Button,
  Badge,
  SectionHeader,
  PageHeader,
  DateNav,
  TeamLogo,
  Dialog,
  NumberField,
  EmptyState,
  ErrorBanner,
  SkeletonCard,
} from "@/components/ui";

// ── Per-side tier badge ───────────────────────────────────────────────────────
// Shows tier + which side it applies to. Replaces a single ambiguous "STRONG
// LEAN" pill in the card header.
//
// Three visual states surface what the model decided per side:
//
//   bright (filled color) — tier is actionable AND a side was picked
//                           e.g. "STRONG LEAN · ML WSH"
//
//   outlined (dim color)  — tier is actionable BUT P(+EV) gated the bet
//                           e.g. "STRONG LEAN · ML  (no lean)"
//                           (data path: ml_tier=STRONG LEAN, ml_lean=PASS)
//
//   muted (gray)          — tier is PASS / AVOID
//                           e.g. "ML PASS"
function SideTierBadge({
  tier,
  sideLabel,
  sidePick,
}: {
  tier: string;
  sideLabel: string;      // "ML" or "O/U"
  sidePick: string | null; // e.g. "WSH" or "O 7.5"; null = no actionable pick
}) {
  const isActionTier = tier === "STRONG LEAN" || tier === "LEAN";
  const tierCol = isActionTier ? tierColor(tier) : "var(--text-2)";

  // Filled-color state only for picks that are actually actionable.
  const isFilled = isActionTier && !!sidePick;

  let labelText: string;
  if (isActionTier && sidePick) {
    labelText = `${tier} · ${sideLabel} ${sidePick}`;
  } else if (isActionTier) {
    // Tier rated this side as a lean, but P(+EV) below the action threshold —
    // surface the tier honestly without claiming a pick the model didn't make.
    labelText = `${tier} · ${sideLabel} (no lean)`;
  } else {
    labelText = `${sideLabel} ${tier}`;
  }

  return (
    <Badge
      color={tierCol}
      fill={isFilled}
      style={{
        borderColor: isFilled ? tierCol : "var(--border)",
        whiteSpace: "nowrap",
        opacity: isActionTier ? (isFilled ? 1 : 0.75) : 0.7,
      }}
    >
      {labelText}
    </Badge>
  );
}

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
  const inputRef = useRef<HTMLInputElement>(null);

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
    <Dialog
      open
      onClose={onClose}
      title="Track Bet"
      initialFocusRef={inputRef}
      width={340}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="track"
            active
            size="sm"
            onClick={submit}
            disabled={loading}
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "…" : "Track ✓"}
          </Button>
        </>
      }
    >
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--fs-body)",
          color: "var(--text-2)",
          marginBottom: "var(--sp-4)",
        }}
      >
        {ctx.away_team_abbr} @ {ctx.home_team_abbr} · {ctx.selection} ·{" "}
        <span className="num">{ctx.american_odds >= 0 ? "+" : ""}{ctx.american_odds}</span>
      </div>
      <NumberField
        label="Units"
        value={units}
        onChange={(v) => { setUnits(v); setErr(""); }}
        min={0.1}
        step={0.5}
        error={err || null}
        id="track-units"
      />
      {/* Hidden ref target for initial focus (NumberField owns its own input id). */}
      <input ref={inputRef} aria-hidden="true" tabIndex={-1} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
    </Dialog>
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
    <div
      style={{
        marginTop: "var(--sp-3)",
        padding: "var(--sp-2) var(--sp-3)",
        border: `1px solid ${tc}`,
        borderRadius: "var(--r-sm)",
        background: "color-mix(in srgb, " + tc + " 6%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-3)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-stat)", fontWeight: "var(--weight-display)", color: tc, textTransform: "uppercase", letterSpacing: "var(--tracking-num)" }}>
          {dir}
        </span>
        <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
          {pick.total_line != null ? `o/u ${pick.total_line}` : ""} · proj {pick.projected_total}
        </span>
        <Badge color={tc}>{pick.total_tier}</Badge>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)" }}>
        {/* P(+EV) and Kelly are the total pick's decision numbers — HUD stat
            size, with a quiet uppercase caption beneath. */}
        <div style={{ display: "flex", gap: "var(--sp-4)", textAlign: "right" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span className="num" style={{ fontSize: "var(--fs-stat)", fontWeight: "var(--weight-bold)", color: "var(--text)", lineHeight: "var(--lh-tight)" }}>
              {(pick.qt_prob_positive * 100).toFixed(0)}%
            </span>
            <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>P(+EV)</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span className="num" style={{ fontSize: "var(--fs-stat)", fontWeight: "var(--weight-bold)", color: "var(--text)", lineHeight: "var(--lh-tight)" }}>
              {(pick.qt_kelly_sized * 100).toFixed(1)}%
            </span>
            <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>kelly</span>
          </div>
        </div>
        <Button
          variant="track"
          active={isTracked}
          size="sm"
          aria-pressed={isTracked}
          onClick={isTracked ? (e) => { e.preventDefault(); e.stopPropagation(); } : handleTrack}
        >
          {isTracked ? "Tracked ✓" : "＋ Track"}
        </Button>
      </div>
    </div>
  );
}

// ── Pick of the Day ───────────────────────────────────────────────────────────

function PickOfTheDay({ picks, date, unlocked }: { picks: GameAnalysis[]; date: string; unlocked: boolean }) {
  const [copied, setCopied] = useState(false);

  // Best STRONG LEAN ML by Kelly, fall back to best STRONG LEAN total.
  // CRITICAL: filter on a real directional lean — the data layer can have
  // ml_tier="STRONG LEAN" with ml_lean="PASS" when P(+EV) failed the action
  // gate after the tier was computed. The lean can also arrive as a team
  // abbreviation directly (e.g. "WSH") rather than "HOME"/"AWAY".
  const hasMlLean = (p: GameAnalysis) =>
    !!p.ml_lean && p.ml_lean !== "PASS";
  const hasTotalLean = (p: GameAnalysis) =>
    p.total_lean === "OVER" || p.total_lean === "UNDER";

  const potd = (() => {
    const slMl = picks
      .filter((p) => p.ml_tier === "STRONG LEAN" && hasMlLean(p))
      .sort((a, b) => b.ml_kelly_fraction - a.ml_kelly_fraction)[0] ?? null;
    if (slMl) return { pick: slMl, market: "ml" as const };

    const slTotal = picks
      .filter((p) => p.total_tier === "STRONG LEAN" && hasTotalLean(p))
      .sort((a, b) => b.total_kelly_fraction - a.total_kelly_fraction)[0] ?? null;
    if (slTotal) return { pick: slTotal, market: "total" as const };

    return null;
  })();

  if (!potd) return null;

  const { pick, market } = potd;
  const isMl = market === "ml";
  // Mirror PickCard's defensive ternary — ml_lean can be "HOME"/"AWAY" or a
  // team abbr ("WSH") depending on the data path. The earlier `!= "HOME"
  // defaults to away` heuristic was the source of POTD showing the wrong team.
  const leanAbbr = isMl
    ? (pick.ml_lean === "HOME" ? pick.home_team_abbr
       : pick.ml_lean === "AWAY" ? pick.away_team_abbr
       : (pick.ml_lean && pick.ml_lean !== "PASS") ? pick.ml_lean
       : null)
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
    <Card
      variant="strong-lean"
      pad={false}
      className="slab"
      style={{
        marginBottom: "var(--sp-6)",
        overflow: "hidden",
        // The featured pick is the page's dominant surface: the glow ring plus
        // corner-bracket reticle (.slab) frame it as the headline readout.
        "--slab-color": "var(--clay)",
        boxShadow: "var(--glow-pos)",
      } as React.CSSProperties}
    >
      {/* Label bar */}
      <div
        className="infield-divider"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-3)",
          padding: "var(--sp-2) var(--sp-4)",
          background: "var(--green-tint)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <span
            className="shiny-text"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-caption)",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "var(--tracking-label)",
              textTransform: "uppercase",
            }}
          >
            ◆ Pick of the Day
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-caption)",
              color: "var(--text-2)",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            Highest Kelly · Strong Lean
          </span>
        </div>
        {unlocked && (
          <Button
            variant={copied ? "track" : "ghost"}
            active={copied}
            size="sm"
            onClick={handleCopy}
          >
            {copied ? "Copied ✓" : "Copy Tweet"}
          </Button>
        )}
      </div>

      {/* Card body */}
      <div
        className="potd-body"
        style={{
          padding: "var(--sp-4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
          flexWrap: "wrap",
        }}
      >
        {/* Matchup */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <TeamLogo abbr={pick.away_team_abbr} size={26} />
          <span className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-data)", color: "var(--text-2)" }}>
            {pick.away_team_abbr}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-meta)" }}>@</span>
          <TeamLogo abbr={pick.home_team_abbr} size={26} />
          <span className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-data)", color: "var(--text-2)" }}>
            {pick.home_team_abbr}
          </span>
        </div>

        {/* Pick */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-2)" }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--fs-headline)",
              fontWeight: "var(--weight-display)",
              color: "var(--pos)",
              letterSpacing: "var(--tracking-num)",
              lineHeight: "var(--lh-tight)",
              textTransform: "uppercase",
            }}
          >
            {pickLabel}
          </span>
          <span className="num" style={{ fontSize: "var(--fs-data)", color: "var(--text-2)", fontWeight: "var(--weight-semibold)" }}>
            {odds}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: "var(--sp-5)", flexShrink: 0 }}>
          {[
            ["Confidence", `${conf}%`],
            ["Kelly", `${kelly}%`],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginBottom: "var(--sp-1)" }}>{k}</div>
              <div className="num" style={{ fontSize: "var(--fs-stat)", fontWeight: "var(--weight-bold)", color: "var(--text)" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
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
  const leanAbbr = pick.ml_lean === "HOME" ? pick.home_team_abbr
    : pick.ml_lean === "AWAY" ? pick.away_team_abbr
    : (pick.ml_lean && pick.ml_lean !== "PASS") ? pick.ml_lean
    : null;

  const mlTrackKey = `${pick.game_id}-ml`;
  const totalTrackKey = `${pick.game_id}-total`;
  const mlTracked = trackedIds.has(mlTrackKey);

  // Card chrome: the Pick of the Day hero (rendered above the list) is the
  // page's single glowing standout. The list cards stay QUIET — a tier-colored
  // left accent only, no glow ring — so a column of equally-glowing boxes
  // doesn't drown out the hero. STRONG LEAN reads emerald, LEAN reads blue.
  const variant = "default";
  const accentShadow = pick.ml_tier === "STRONG LEAN"
    ? "inset 3px 0 0 var(--pos)"
    : pick.ml_tier === "LEAN"
      ? "inset 3px 0 0 var(--lean)"
      : undefined;

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
      <Card
        variant={variant}
        pad={false}
        interactive
        className="fade-up"
        style={{
          "--delay": `${Math.min(index, 12) * 25}ms`,
          ...(accentShadow ? { boxShadow: accentShadow } : {}),
        } as React.CSSProperties}
      >
        <div style={{ padding: "var(--sp-3) var(--sp-4)" }}>
          {/* Top: matchup + per-side tier badges. The previous design showed a
              single tier label without saying which side it referred to, which
              left readers staring at "STRONG LEAN" without knowing whether
              that was the ML pick or the total. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--sp-3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap", minWidth: 0 }}>
              <TeamLogo abbr={pick.away_team_abbr} size={22} />
              <span className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-data)" }}>{pick.away_team_abbr}</span>
              <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-meta)" }}>@</span>
              <TeamLogo abbr={pick.home_team_abbr} size={22} />
              <span className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-data)" }}>{pick.home_team_abbr}</span>
              {pick.venue && <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "var(--sp-1)" }}>{pick.venue}</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", alignItems: "flex-end", flexShrink: 0 }}>
              {/* ML side badge */}
              <SideTierBadge
                tier={pick.ml_tier}
                sideLabel="ML"
                sidePick={isMlAction && leanAbbr ? leanAbbr : null}
              />
              {/* Total (O/U) side badge */}
              <SideTierBadge
                tier={pick.total_tier}
                sideLabel="O/U"
                sidePick={
                  isTotalAction && (pick.total_lean === "OVER" || pick.total_lean === "UNDER")
                    ? `${pick.total_lean === "OVER" ? "O" : "U"} ${pick.total_line ?? ""}`.trim()
                    : null
                }
              />
            </div>
          </div>

          {/* Middle: ML verdict + gauge */}
          <div className="mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: "var(--sp-5)", alignItems: "center", marginTop: "var(--sp-3)" }}>
            <div>
              {isMlAction && leanAbbr ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-headline)", fontWeight: "var(--weight-display)", color: tc, textTransform: "uppercase", lineHeight: "var(--lh-tight)", letterSpacing: "var(--tracking-num)" }}>
                      {leanAbbr} ML
                    </div>
                    <Button
                      variant="track"
                      active={mlTracked}
                      size="sm"
                      aria-pressed={mlTracked}
                      onClick={mlTracked ? (e) => { e.preventDefault(); e.stopPropagation(); } : handleMlTrack}
                    >
                      {mlTracked ? "Tracked ✓" : "＋ Track"}
                    </Button>
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}>
                    <span className="num" style={{ fontWeight: "var(--weight-semibold)" }}>{pick.ml_american_odds > 0 ? "+" : ""}{pick.ml_american_odds}</span>
                    {" · Shin-devigged · shrunk to "}
                    <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>
                      {(pick.q_p_shrunk * 100).toFixed(1)}%
                    </span>
                  </div>
                </>
              ) : (
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--fs-stat)",
                    fontWeight: "var(--weight-display)",
                    color: isMlAction ? tc : "var(--text-2)",
                    textTransform: "uppercase",
                    lineHeight: "var(--lh-tight)",
                  }}
                >
                  {pick.ml_tier}
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", fontWeight: "var(--weight-normal)", marginTop: "var(--sp-1)" }}>
                    {isMlAction
                      ? `P(+EV) ${(pick.q_prob_positive * 100).toFixed(0)}% — no directional lean`
                      : `P(+EV) ${(pick.q_prob_positive * 100).toFixed(0)}% — below action threshold`}
                  </div>
                </div>
              )}
              <div style={{ marginTop: "var(--sp-3)" }}>
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
        </div>

        {/* ── Quant panel — recessed well sub-section, reads second ── */}
        <div
          style={{
            padding: "var(--sp-3) var(--sp-4)",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-inset)",
            borderBottomLeftRadius: "var(--r-md)",
            borderBottomRightRadius: "var(--r-md)",
          }}
        >
          <SectionHeader
            divider={false}
            style={{ marginBottom: "var(--sp-2)" }}
            action={<ExplainTooltip term="uncertainty-kelly" />}
          >
            Bankroll math
          </SectionHeader>

          <GrowthReadout a={pick} />

          {isMlAction && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <MethodCompare a={pick} />
            </div>
          )}

          {pick.key_factors.length > 0 && (
            <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-2)", borderTop: "1px solid var(--border-subtle)" }}>
              {pick.key_factors.slice(0, 2).map((f, i) => (
                <div key={i} style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--text-2)", marginBottom: "var(--sp-1)", paddingLeft: "var(--sp-2)", borderLeft: "1px solid var(--border)", lineHeight: "var(--lh-data)" }}>{f}</div>
              ))}
              {pick.cautions.slice(0, 1).map((c, i) => (
                <div key={i} style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", color: "var(--warn)", marginTop: "var(--sp-1)", paddingLeft: "var(--sp-2)", borderLeft: "1px solid var(--warn)", lineHeight: "var(--lh-data)" }}>{c}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
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
  const [unlocked] = useState(() => Boolean(getAdminToken()));

  useEffect(() => {
    let alive = true;
    api.picks(date).then((p) => {
      if (!alive) return;
      if (p === null) setError(true);
      else setPicks(p);
    });
    return () => { alive = false; };
  }, [date]);

  // SEED tracked state from the tracker on date load so a bet tracked elsewhere
  // (slate, tracker page) shows "Tracked ✓" instead of "＋ Track" after reload.
  // trackerBets markets are "moneyline" / "total"; the card keys use "ml" / "total".
  useEffect(() => {
    let alive = true;
    api.trackerBets({ date_from: date, date_to: date }).then((bets) => {
      if (!alive || !bets) return;
      setTrackedIds(new Set(bets.map((b) => `${b.game_id}-${b.market === "moneyline" ? "ml" : "total"}`)));
    });
    return () => { alive = false; };
  }, [date]);

  function changeDate(d: string) { setPicks(null); setError(false); setTrackedIds(new Set()); setDate(d); }

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

      <PageHeader
        title="Daily Picks"
        subtitle={
          <>
            <span className="live-dot" />
            {picks
              ? <>
                  <span>{picks.length} games</span>
                  <span style={{ color: "var(--border-strong)" }}>·</span>
                  <span style={{ color: actionable.length > 0 ? "var(--pos)" : "var(--text-2)" }}>{actionable.length} actionable</span>
                  <span style={{ color: "var(--border-strong)" }}>·</span>
                  <span>Shin + Bayesian quant</span>
                  <span style={{ color: "var(--border-strong)" }}>·</span>
                  <span>{date}</span>
                </>
              : <><span>Shin + Bayesian quant model</span><span style={{ color: "var(--border-strong)" }}>·</span><span>{date}</span></>}
          </>
        }
        action={<DateNav value={date} onChange={changeDate} />}
      />

      {error && (
        <ErrorBanner
          kind="outage"
          title="Unable to load picks"
          detail="The backend may be starting up — try refreshing in a moment."
          style={{ marginBottom: "var(--sp-4)" }}
        />
      )}
      {!error && picks === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <SkeletonCard lines={2} style={{ marginBottom: "var(--sp-3)" }} />
          <SkeletonCard lines={4} />
          <SkeletonCard lines={4} />
        </div>
      )}
      {picks?.length === 0 && (
        <EmptyState
          title={`No games found for ${date}.`}
          detail="Try another date, or check back once the slate is published."
        />
      )}

      {picks && picks.length > 0 && (
        <PickOfTheDay picks={picks} date={date} unlocked={unlocked} />
      )}

      {actionable.length > 0 && (
        <div style={{ marginBottom: "var(--sp-6)" }}>
          <SectionHeader action={<span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{actionable.length}</span>}>
            <span style={{ color: "var(--pos)" }}>▸ Actionable</span>
          </SectionHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
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
            <SectionHeader action={<span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{rest.length}</span>}>
              ▸ Rest of slate
            </SectionHeader>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
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
