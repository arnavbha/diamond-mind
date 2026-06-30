"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, todayET, type SlateGame, type BullpenData, type GameAnalysis, type Movement } from "@/lib/api";
import { fmtDateHuman, isToday } from "@/lib/date";
import { GameDetailPanel } from "@/components/game-detail-panel";
import { LiveAlert } from "@/components/live-alert";
import {
  Card,
  TeamLogo,
  DateNav,
  Badge,
  TierBadge,
  StatusBadge,
  LabeledBar,
  OddsValue,
  Dialog,
  EmptyState,
  ErrorBanner,
  SkeletonCard,
  Loading,
  PageHeader,
} from "@/components/ui";
import { heatColorFor, HOLD_COLOR } from "@/lib/visual-tokens";

function vulnColor(score: number): string {
  // Continuous vulnerability gauge — heat ramp (low=fresh→high=gassed).
  return heatColorFor(score, 0, 100);
}

function VulnBar({ abbr, bp }: { abbr: string; bp: BullpenData }) {
  const color = vulnColor(bp.vulnerability_score);
  const pct = bp.vulnerability_score;
  return (
    <LabeledBar
      label={abbr}
      value={pct / 100}
      color={color}
      valueText={pct.toFixed(0)}
      valueColor={color}
      delay={80}
    />
  );
}

function GameCard({ game, index, onClick, trackedML, trackedTotal, hero = false }: { game: SlateGame; index: number; onClick: () => void; trackedML?: boolean; trackedTotal?: boolean; hero?: boolean }) {
  const analysis: GameAnalysis | null = game.analysis;
  const hasTier = !!analysis && analysis.ml_tier !== "PASS" && analysis.ml_lean !== "PASS";
  const leanAbbr = analysis?.ml_lean === "HOME" ? game.home_team_abbr
    : analysis?.ml_lean === "AWAY" ? game.away_team_abbr
    : (analysis?.ml_lean && analysis.ml_lean !== "PASS") ? analysis.ml_lean
    : null;
  const hasTotalTier = !!analysis && analysis.total_tier !== "PASS" && analysis.total_lean !== "PASS";
  const totalLabel = analysis?.total_lean === "OVER" ? `O ${analysis.total_line ?? ""}`.trim()
    : analysis?.total_lean === "UNDER" ? `U ${analysis.total_line ?? ""}`.trim() : null;

  // Stagger cap: don't let a long slate's bottom cards wait ~½s (drop multiplier past ~12).
  const delay = Math.min(index, 12) * 25;
  const isStrong = analysis?.ml_tier === "STRONG LEAN";
  const isLean = analysis?.ml_tier === "LEAN";
  const isPass = !hasTier;
  const actionable = hasTier && (isStrong || isLean);

  // ── Hierarchy by emphasis ──────────────────────────────────────────────────
  // Only the single `hero` card (the slate's highest-conviction actionable pick,
  // chosen in SlatePageInner) carries a glow RING + corner-bracket slab. The ring
  // frames the whole card to mark THE standout — functional emphasis, not a
  // colored side-stripe. Every other row stays unstriped: tier is read from the
  // TierBadge + the "X to win" line, and PASS rows recede via opacity. We don't
  // paint a tier-colored left-accent on each actionable row — a column of colored
  // side-tabs is a vibe-coded tell and contradicts the no-side-stripe rule the
  // glow vocabulary already set (see .game-card-tier-* in globals.css).
  const composedShadow = hero
    ? (isStrong ? "var(--glow-pos)" : isLean ? "var(--glow-lean)" : undefined)
    : undefined;
  // Corner-bracket reticle is the "framed in the scope" hero marker — hero only.
  const showSlab = hero && actionable;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`fade-up slate-row${showSlab ? " slab" : ""}`}
      style={{
        "--delay": `${delay}ms`,
        "--slab-color": "var(--clay)",
        // Flat row in the shared board (no per-card box): transparent bg, no
        // border/radius — just a bottom hairline divider. Tier still marked by
        // the inset-left accent (composedShadow); hero keeps its glow.
        ...(composedShadow ? { boxShadow: composedShadow } : {}),
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border)",
        padding: "var(--sp-3) var(--sp-4)",
        color: "var(--text)",
        // PASS games recede so the actionable slate floats above the noise.
        opacity: isPass ? 0.55 : 1,
      } as React.CSSProperties}
    >
      {/* Main row: matchup · signal · bullpen */}
      <div className="game-card-grid mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 168px 1fr", gap: "var(--sp-4)", alignItems: "center" }}>
        {/* Matchup */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <TeamLogo abbr={game.away_team_abbr} size={22} />
            <span style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-data)", color: "var(--text)", letterSpacing: "-0.02em" }}>{game.away_team_abbr}</span>
            {gameStarted(game.status) ? (
              <>
                <span className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-stat)", color: "var(--text)", minWidth: "18px", textAlign: "right" }}>{game.away_score ?? "—"}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-meta)" }}>–</span>
                <span className="num" style={{ fontWeight: "var(--weight-bold)", fontSize: "var(--fs-stat)", color: "var(--text)", minWidth: "18px" }}>{game.home_score ?? "—"}</span>
              </>
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>@</span>
            )}
            <TeamLogo abbr={game.home_team_abbr} size={22} />
            <span style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-data)", color: "var(--text)", letterSpacing: "-0.02em" }}>{game.home_team_abbr}</span>
            {gameIsLive(game.status) && <StatusBadge status="LIVE" style={{ marginLeft: "var(--sp-1)" }} />}
            {gameIsFinal(game.status) && <StatusBadge status="FINAL" style={{ marginLeft: "var(--sp-1)" }} />}
          </div>
          {game.venue && (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}>{game.venue}</div>
          )}
          {/* Game time + countdown */}
          {!gameStarted(game.status) && (game.start_time_et || game.game_time_utc) && (() => {
            const timeLabel = game.start_time_et ?? null;
            const utc = game.game_time_utc;
            let countdown: string | null = null;
            if (utc) {
              const diffMs = Date.parse(utc) - Date.now();
              const diffH = diffMs / 3_600_000;
              if (diffH > 0 && diffH < 4) {
                const h = Math.floor(diffMs / 3_600_000);
                const m = Math.floor((diffMs % 3_600_000) / 60_000);
                countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
              }
            }
            return (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                {timeLabel && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
                    {timeLabel} ET
                  </span>
                )}
                {countdown && (
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)",
                    fontWeight: "var(--weight-bold)", color: "var(--warn)",
                    background: "color-mix(in srgb, var(--warn) 12%, transparent)",
                    borderRadius: "var(--r-sm)", padding: "1px 5px",
                  }}>
                    {countdown}
                  </span>
                )}
              </div>
            );
          })()}
          {/* Starters */}
          {!gameStarted(game.status) && (() => {
            const awayName = game.away_starter_name;
            const homeName = game.home_starter_name;
            const awayEra = game.away_starter_era;
            const homeEra = game.home_starter_era;
            const hasSomeStarter = awayName || homeName;

            function eraColor(era: number | null): string {
              if (era === null) return "var(--text-muted)";
              if (era <= 3.20) return "var(--pos)";
              if (era <= 4.00) return "var(--warn)";
              return "var(--neg)";
            }
            function eraLabel(era: number | null): string {
              return era !== null ? era.toFixed(2) : "—";
            }

            if (!hasSomeStarter) {
              return (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: "var(--sp-1)" }}>
                  Starters TBD
                </div>
              );
            }
            return (
              <div style={{ marginTop: "var(--sp-1)", display: "flex", flexDirection: "column", gap: "1px" }}>
                {[
                  { abbr: game.away_team_abbr, name: awayName, era: awayEra },
                  { abbr: game.home_team_abbr, name: homeName, era: homeEra },
                ].map(({ abbr, name, era }) => (
                  <div key={abbr} style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
                    <span style={{ color: "var(--text-2)", minWidth: "28px" }}>{abbr}</span>
                    <span style={{ color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name ?? "TBD"}
                    </span>
                    <span className="num" style={{ color: eraColor(era ?? null), flexShrink: 0 }}>
                      {eraLabel(era ?? null)} ERA
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Model signal */}
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          {/* ML signal */}
          <div>
            {analysis ? (
              hasTier ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
                  <TierBadge tier={analysis!.ml_tier} />
                  <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-body)", color: "var(--text)" }}>
                    {leanAbbr} to win
                    {analysis!.ml_american_odds != null && (
                      <span className="num" style={{ color: "var(--text-2)", fontSize: "var(--fs-meta)", marginLeft: "var(--sp-1)" }}>
                        {analysis!.ml_american_odds >= 0 ? `+${analysis!.ml_american_odds}` : analysis!.ml_american_odds}
                      </span>
                    )}
                  </div>
                  {/* Confidence + Kelly are the card's key figures — render them
                      at HUD stat size so they read first inside the column. */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                    <span className="num" style={{ fontSize: "24px", fontWeight: "var(--weight-display)", color: "var(--text)", lineHeight: "var(--lh-tight)", fontFamily: "var(--font-display)" }}>
                      {Math.round(analysis!.ml_confidence * 100)}%
                    </span>
                    <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>confidence</span>
                  </div>
                </div>
              ) : trackedML ? (
                <Badge color="var(--lean)">ML tracked</Badge>
              ) : (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>Pass</div>
              )
            ) : (
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>—</div>
            )}
          </div>

          {/* Total signal */}
          {(hasTotalTier && totalLabel) || trackedTotal ? (
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--sp-2)" }}>
              {hasTotalTier && totalLabel ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
                  <TierBadge tier={analysis!.total_tier} />
                  <div style={{ fontWeight: "var(--weight-semibold)", fontSize: "var(--fs-body)", color: "var(--text)" }}>
                    {totalLabel}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                    <span className="num" style={{ fontSize: "var(--fs-stat)", fontWeight: "var(--weight-bold)", color: "var(--text)", lineHeight: "var(--lh-tight)" }}>
                      {Math.round(analysis!.total_confidence * 100)}%
                    </span>
                    <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>confidence</span>
                  </div>
                </div>
              ) : trackedTotal ? (
                <Badge color="var(--lean)">Total tracked</Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Bullpen */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
          <div style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-medium)", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginBottom: "var(--sp-1)" }}>Bullpen risk</div>
          {game.away_bullpen && <VulnBar abbr={game.away_team_abbr} bp={game.away_bullpen} />}
          {game.home_bullpen && <VulnBar abbr={game.home_team_abbr} bp={game.home_bullpen} />}
          {!game.home_bullpen && !game.away_bullpen && <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>—</div>}
        </div>
      </div>

      {/* Odds / fair value / line movement + live alerts now live in the detail
          drawer (click the row) — keeping them off the board row is what makes
          the slate a dense board instead of a stack of tall boxes. */}
    </button>
  );
}

function fmtOdds(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 0 ? `+${n}` : `${n}`;
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

const STARTED_STATUSES = new Set(["In Progress", "Final", "Game Over", "Completed Early"]);
const LIVE_STATUSES = new Set(["In Progress"]);
const FINAL_STATUSES = new Set(["Final", "Game Over", "Completed Early"]);

function gameStarted(status: string) { return STARTED_STATUSES.has(status); }
function gameIsLive(status: string)  { return LIVE_STATUSES.has(status); }
function gameIsFinal(status: string) { return FINAL_STATUSES.has(status); }

// Beat-the-Book chip — exposes the book's vig via the no-vig fair line + hold%.
// Verification only: this is NOT a pick. Rendered ONLY when the book priced both
// sides (fair is non-null server-side); otherwise nothing.
function FairChip({ label, fairAway, fairHome, awayTag, homeTag, holdPct }: {
  label: string;
  fairAway: number | null;
  fairHome: number | null;
  awayTag: string;
  homeTag: string;
  holdPct: number;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", color: "var(--text-2)" }}>
      <span style={{ fontSize: "var(--fs-caption)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>{label} fair</span>
      <span style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{awayTag}</span>
      <OddsValue odds={fairAway} muted />
      <span style={{ color: "var(--border)" }}>/</span>
      <span style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{homeTag}</span>
      <OddsValue odds={fairHome} muted />
      <span
        className="num"
        title="Book hold (overround) — the vig baked into both sides"
        style={{ color: HOLD_COLOR, fontWeight: "var(--weight-semibold)" }}
      >
        · hold {holdPct.toFixed(1)}%
      </span>
    </span>
  );
}

// Resolve the side the movement deltas are measured FOR into a display tag.
function movementSideTag(m: Movement, homeAbbr: string, awayAbbr: string): string | null {
  switch (m.side) {
    case "home": return homeAbbr;
    case "away": return awayAbbr;
    case "over": return "Over";
    case "under": return "Under";
    default: return null; // "market" or null → no directional side
  }
}

// Compact net line-movement chip (single-book, open → close). NOT cross-book
// "steam" — this is one bookmaker's net move between the opening and latest
// pre-first-pitch snapshots. Green = market moved TOWARD the model side
// (confirmation), red = AWAY (fade), muted = neutral / no usable movement.
// Honest empty state: renders a muted note when fewer than two pre-pitch
// snapshots exist. american_delta is display only; never fabricates numbers.
function MovementChip({ label, m, homeAbbr, awayAbbr }: {
  label: string;
  m: Movement | null | undefined;
  homeAbbr: string;
  awayAbbr: string;
}) {
  if (!m) return null;

  const hasMove = m.source === "live" || m.source === "one_sided";
  const openA = m.open?.american;
  const closeA = m.close?.american;
  const haveEndpoints = openA != null && closeA != null;

  // Honest empty state when there is no usable two-snapshot movement.
  if (!hasMove || !haveEndpoints) {
    const why =
      m.source === "single_snapshot" ? "one snapshot only"
      : m.source === "no_first_pitch" ? "no first-pitch time"
      : "no movement data";
    return (
      <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", color: "var(--text-2)" }}>
        <span style={{ fontSize: "var(--fs-caption)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>{label} line</span>
        <span style={{ color: "var(--text-muted)" }}>{why}</span>
      </span>
    );
  }

  const color =
    m.agreement === "toward" ? "var(--pos)"
    : m.agreement === "away" ? "var(--neg)"
    : "var(--text-2)"; // neutral / no lean

  const sideTag = movementSideTag(m, homeAbbr, awayAbbr);
  const dirWord =
    m.agreement === "toward" ? "toward"
    : m.agreement === "away" ? "away from"
    : null;

  // Totals: prefer the line move (e.g. 8.5 → 9.0) when present.
  const lineMoved = m.line_delta != null && m.line_delta !== 0
    && m.open?.line != null && m.close?.line != null;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", color: "var(--text-2)" }}>
      <span style={{ fontSize: "var(--fs-caption)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>{label} line</span>
      {lineMoved ? (
        <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>
          {m.open!.line} → {m.close!.line}
        </span>
      ) : (
        <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>
          {fmtOdds(openA)} → {fmtOdds(closeA)}
        </span>
      )}
      {dirWord && sideTag ? (
        <>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ color, fontWeight: "var(--weight-semibold)" }}>{dirWord} {sideTag}</span>
        </>
      ) : (
        <>
          <span style={{ color: "var(--border)" }}>·</span>
          <span style={{ color: "var(--text-2)", fontWeight: "var(--weight-semibold)" }}>flat</span>
        </>
      )}
    </span>
  );
}

function LiveOddsRow({ game }: { game: SlateGame }) {
  const odds = game.live_odds;
  if (!odds) return null;
  const awayML = odds.moneyline?.away;
  const homeML = odds.moneyline?.home;
  const tot = odds.total;
  const mlFair = odds.moneyline?.fair ?? null;
  const totFair = tot?.fair ?? null;
  const mlMove = odds.moneyline?.movement ?? null;
  const totMove = tot?.movement ?? null;
  // Only surface a movement row when there's a real net move to show (avoid a
  // wall of "no movement data" notes on every card pre-open).
  const mlMoveShow = mlMove && (mlMove.source === "live" || mlMove.source === "one_sided");
  const totMoveShow = totMove && (totMove.source === "live" || totMove.source === "one_sided");
  const hasAnything = awayML != null || homeML != null || tot;
  if (!hasAnything) return null;
  return (
    <div style={{
      marginTop: "var(--sp-3)",
      paddingTop: "var(--sp-2)",
      borderTop: "1px solid var(--border-subtle)",
      display: "flex",
      flexWrap: "wrap",
      gap: "var(--sp-5)",
      alignItems: "center",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--fs-meta)",
      color: "var(--text-2)",
    }}>
      {gameIsLive(game.status) && <StatusBadge status="LIVE" />}
      {gameIsFinal(game.status) && <StatusBadge status="FINAL" />}
      {!gameStarted(game.status) && (
        <span style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-semibold)", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>Odds</span>
      )}
      {(awayML != null || homeML != null) && (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-caption)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>ML</span>
          <span style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{game.away_team_abbr}</span>
          <OddsValue odds={awayML} />
          <span style={{ color: "var(--border)" }}>/</span>
          <span style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{game.home_team_abbr}</span>
          <OddsValue odds={homeML} />
        </span>
      )}
      {tot && tot.line != null && (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-caption)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>O/U</span>
          <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>{tot.line}</span>
          <span style={{ color: "var(--text-muted)" }}>(</span>
          <span>O <OddsValue odds={tot.over} /></span>
          <span>U <OddsValue odds={tot.under} /></span>
          <span style={{ color: "var(--text-muted)" }}>)</span>
        </span>
      )}
      {odds.captured_at && (
        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>
          updated {relTime(odds.captured_at)}
        </span>
      )}
      {/* No-vig fair line + book hold. Server emits `fair` only when the book
          priced both sides; this exposes the vig and is NOT a pick. */}
      {(mlFair || totFair) && (
        <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", alignItems: "center" }}>
          {mlFair && (
            <FairChip
              label="ML"
              awayTag={game.away_team_abbr}
              homeTag={game.home_team_abbr}
              fairAway={mlFair.away_odds}
              fairHome={mlFair.home_odds}
              holdPct={mlFair.hold_pct}
            />
          )}
          {totFair && (
            <FairChip
              label="O/U"
              awayTag="O"
              homeTag="U"
              fairAway={totFair.over_odds}
              fairHome={totFair.under_odds}
              holdPct={totFair.hold_pct}
            />
          )}
        </div>
      )}
      {/* Net line movement (single-book, open → close). Only shown when a real
          two-snapshot move exists; toward/away is the server's call vs the
          model side. NOT cross-book steam. */}
      {(mlMoveShow || totMoveShow) && (
        <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "var(--sp-5)", alignItems: "center" }}>
          {mlMoveShow && (
            <MovementChip label="ML" m={mlMove} homeAbbr={game.home_team_abbr} awayAbbr={game.away_team_abbr} />
          )}
          {totMoveShow && (
            <MovementChip label="O/U" m={totMove} homeAbbr={game.home_team_abbr} awayAbbr={game.away_team_abbr} />
          )}
        </div>
      )}
    </div>
  );
}

// Actionable-first sort: STRONG LEAN, then LEAN, then everything else (PASS/null)
// last so the playable slate floats to the top. Stable within a tier.
function sortRank(g: SlateGame): number {
  const a = g.analysis;
  if (!a) return 3;
  if (a.ml_tier === "STRONG LEAN" || a.total_tier === "STRONG LEAN") return 0;
  if (a.ml_tier === "LEAN" || a.total_tier === "LEAN") return 1;
  return 2;
}

function SlatePageInner() {
  const searchParams = useSearchParams();
  const today = todayET();
  const [date, setDate] = useState(() => searchParams.get("date") ?? today);
  const [games, setGames] = useState<SlateGame[] | null>(null);
  const [error, setError] = useState(false);
  const [sidebar, setSidebar] = useState<{ gameId: number; date: string } | null>(null);
  // Set of "gameId-market" keys for tracked bets on the current date
  const [trackedKeys, setTrackedKeys] = useState<Set<string>>(new Set());
  const [showPass, setShowPass] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("dm-show-pass");
    return saved === null ? true : saved === "true";
  });

  function toggleShowPass() {
    setShowPass(v => {
      const next = !v;
      localStorage.setItem("dm-show-pass", String(next));
      return next;
    });
  }

  useEffect(() => {
    let alive = true;
    function load() {
      api.slate(date).then((g) => {
        if (!alive) return;
        if (g === null) setError(true);
        else setGames(g);
      });
      api.trackerBets({ date_from: date, date_to: date }).then((bets) => {
        if (!alive || !bets) return;
        setTrackedKeys(new Set(bets.map((b) => `${b.game_id}-${b.market}`)));
      });
    }
    load();
    // Refresh every 60s so live_odds + game status stay fresh.
    const iv = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [date]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSidebar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Browser Back / mobile back gesture: openSidebar pushes /game/{id}, so pressing
  // Back pops the history entry and the URL returns to "/". Dismiss the sheet to
  // keep URL and UI in sync. We DON'T pushState here (the pop already updated the
  // URL); we just close the sheet.
  useEffect(() => {
    function onPop() {
      const onGameUrl = window.location.pathname.startsWith("/game/");
      if (!onGameUrl) {
        setSidebar(null);
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openSidebar(gameId: number, gameDate: string) {
    setSidebar({ gameId, date: gameDate });
    window.history.pushState(null, "", `/game/${gameId}?date=${gameDate}`);
  }

  function closeSidebar() {
    if (!sidebar) return;
    window.history.pushState(null, "", `/?date=${date}`);
    setSidebar(null);
  }

  function changeDate(d: string) { setGames(null); setError(false); setDate(d); }

  const sortedGames = games ? [...games].sort((a, b) => {
    const ra = sortRank(a), rb = sortRank(b);
    if (ra !== rb) return ra - rb;
    // Within same tier, sort by start time (soonest first)
    const ta = a.game_time_utc ? Date.parse(a.game_time_utc) : Infinity;
    const tb = b.game_time_utc ? Date.parse(b.game_time_utc) : Infinity;
    return ta - tb;
  }) : null;
  // Actionable = any game whose ML or total is a LEAN / STRONG LEAN (sortRank
  // 0 or 1). Surfaced in the header subtitle as the at-a-glance slate summary.
  const actionableCount = games ? games.filter((g) => sortRank(g) <= 1).length : 0;

  // Filter PASS games from display when showPass is false
  const displayGames = showPass ? sortedGames : sortedGames?.filter(g => sortRank(g) !== 2) ?? null;

  // Hero = the single highest-conviction ML pick on the slate (STRONG outranks
  // LEAN; ties broken by Kelly fraction). Only this card gets the loud glow +
  // slab treatment in GameCard; every other actionable card stays quiet so the
  // standout actually stands out. ML-keyed to match GameCard's own emphasis.
  const heroId: number | null = (() => {
    const acts = (sortedGames ?? []).filter(
      (g) => g.analysis && (g.analysis.ml_tier === "STRONG LEAN" || g.analysis.ml_tier === "LEAN") && g.analysis.ml_lean !== "PASS",
    );
    if (acts.length === 0) return null;
    const conviction = (g: SlateGame) => {
      const a = g.analysis!;
      const strong = a.ml_tier === "STRONG LEAN" ? 1 : 0;
      return strong * 1000 + (a.ml_kelly_fraction ?? 0);
    };
    return acts.reduce((best, g) => (conviction(g) > conviction(best) ? g : best)).game_id;
  })();

  return (
    <div style={{ position: "relative" }}>
      <PageHeader
        title="Daily Slate"
        subtitle={
          games
            ? <>
                <span>{fmtDateHuman(date)}</span>
                {isToday(date) && (
                  <span style={{
                    fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)",
                    fontWeight: "var(--weight-bold)", textTransform: "uppercase",
                    letterSpacing: "var(--tracking-label)", color: "var(--clay)",
                    border: "1px solid var(--clay)", borderRadius: "var(--r-sm)",
                    padding: "1px 6px",
                  }}>Today</span>
                )}
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span>{games.length} games</span>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span style={{ color: actionableCount > 0 ? "var(--pos)" : "var(--text-2)" }}>
                  {actionableCount} actionable
                </span>
              </>
            : fmtDateHuman(date)
        }
        action={<DateNav value={date} onChange={changeDate} />}
      />

      {error && (
        <ErrorBanner
          kind="outage"
          title="Unable to load slate data"
          detail="We're loading today's slate. If this takes a moment, the server may be warming up."
          style={{ marginBottom: "var(--sp-4)" }}
        />
      )}

      {!error && games === null && (
        <Loading label="Loading slate">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
          </div>
        </Loading>
      )}

      {games?.length === 0 && (
        <EmptyState title={`No games for ${date}.`} detail="Try another date with the stepper above." />
      )}

      {/* Board sub-header: actionable count + pass toggle */}
      {sortedGames && sortedGames.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)",
          marginBottom: "var(--sp-3)", paddingBottom: "var(--sp-2)",
          borderBottom: "1px solid var(--border)",
        }}>
          <span>
            <span style={{ color: "var(--pos)", fontWeight: "var(--weight-semibold)" }}>{actionableCount} actionable</span>
            <span style={{ color: "var(--border-strong)", margin: "0 var(--sp-2)" }}>·</span>
            <span>{(sortedGames.length - actionableCount)} pass</span>
          </span>
          <button
            type="button"
            onClick={toggleShowPass}
            style={{
              background: "transparent", border: "1px solid var(--border-2)",
              color: "var(--text-2)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)",
              borderRadius: "var(--r-sm)", padding: "2px 8px", cursor: "pointer",
              textTransform: "uppercase", letterSpacing: "var(--tracking-label)",
            }}
          >
            {showPass ? "Hide Pass" : "Show Pass"}
          </button>
        </div>
      )}

      {/* Hero card — the slate's single best opportunity */}
      {heroId !== null && (() => {
        const heroGame = sortedGames?.find(g => g.game_id === heroId);
        if (!heroGame || !heroGame.analysis) return null;
        const a = heroGame.analysis;
        const leanAbbrHero = a.ml_lean === "HOME" ? heroGame.home_team_abbr : heroGame.away_team_abbr;
        return (
          <button
            type="button"
            onClick={() => openSidebar(heroGame.game_id, heroGame.game_date)}
            className="slab fade-up"
            style={{
              "--slab-color": "var(--clay)",
              "--delay": "0ms",
              width: "100%", textAlign: "left", cursor: "pointer",
              background: "var(--surface)", border: "1px solid var(--border-2)",
              borderRadius: "var(--r-md)", padding: "var(--sp-6)",
              marginBottom: "var(--sp-4)",
              boxShadow: a.ml_tier === "STRONG LEAN" ? "var(--glow-pos)" : "var(--glow-lean)",
              color: "var(--text)",
            } as React.CSSProperties}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-caption)", color: "var(--clay)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginBottom: "var(--sp-2)" }}>
              ◆ Today&apos;s Best Opportunity
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sp-6)", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "var(--font-display-serif)", fontSize: "var(--fs-headline)", fontWeight: "var(--weight-display)", color: "var(--text)", marginBottom: "var(--sp-1)" }}>
                  {heroGame.away_team_abbr} @ {heroGame.home_team_abbr}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
                  {leanAbbrHero} to win
                  {heroGame.start_time_et && <span style={{ marginLeft: "var(--sp-3)" }}>· {heroGame.start_time_et} ET</span>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-hero)", fontWeight: "var(--weight-display)", color: a.ml_tier === "STRONG LEAN" ? "var(--pos)" : "var(--lean)", lineHeight: 1 }}>
                  {Math.round(a.ml_confidence * 100)}%
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>Confidence</div>
              </div>
            </div>
            <div style={{ marginTop: "var(--sp-3)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--pos)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>
              View analysis →
            </div>
          </button>
        );
      })()}

      {/* One bordered board; each game is a flat row with a hairline divider —
          not nine separate boxes. Click a row to open the detail drawer. */}
      {displayGames && displayGames.length > 0 && (
        <div className="slate-board" style={{ border: "1px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
          {displayGames.map((g, i) => (
            <GameCard
              key={g.game_id}
              game={g}
              index={i}
              hero={g.game_id === heroId}
              trackedML={trackedKeys.has(`${g.game_id}-moneyline`)}
              trackedTotal={trackedKeys.has(`${g.game_id}-total`)}
              onClick={() => openSidebar(g.game_id, g.game_date)}
            />
          ))}
        </div>
      )}

      {/* Game detail drawer — focus-trapped Dialog (full-screen sheet on mobile) */}
      <Dialog
        open={!!sidebar}
        onClose={closeSidebar}
        variant="drawer"
        title={sidebar ? `Game detail · ${sidebar.date}` : undefined}
      >
        {sidebar && <GameDetailPanel gameId={sidebar.gameId} date={sidebar.date} />}
      </Dialog>
    </div>
  );
}

export default function SlatePage() {
  return (
    <Suspense fallback={<Loading label="Loading slate"><div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}</div></Loading>}>
      <SlatePageInner />
    </Suspense>
  );
}
