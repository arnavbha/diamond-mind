"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, todayET, type SlateGame, type BullpenData, type GameAnalysis, type Movement } from "@/lib/api";
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
} from "@/components/ui";
import { tierColor, heatColorFor, HOLD_COLOR } from "@/lib/visual-tokens";

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

function GameCard({ game, index, onClick, trackedML, trackedTotal }: { game: SlateGame; index: number; onClick: () => void; trackedML?: boolean; trackedTotal?: boolean }) {
  const analysis: GameAnalysis | null = game.analysis;
  const hasTier = !!analysis && analysis.ml_tier !== "PASS" && analysis.ml_lean !== "PASS";
  const tc = hasTier ? tierColor(analysis!.ml_tier) : "var(--border)";
  const leanAbbr = analysis?.ml_lean === "HOME" ? game.home_team_abbr
    : analysis?.ml_lean === "AWAY" ? game.away_team_abbr
    : (analysis?.ml_lean && analysis.ml_lean !== "PASS") ? analysis.ml_lean
    : null;
  const hasTotalTier = !!analysis && analysis.total_tier !== "PASS" && analysis.total_lean !== "PASS";
  const totalLabel = analysis?.total_lean === "OVER" ? `O ${analysis.total_line ?? ""}`.trim()
    : analysis?.total_lean === "UNDER" ? `U ${analysis.total_line ?? ""}`.trim() : null;

  // Stagger cap: don't let a long slate's bottom cards wait ~½s (drop multiplier past ~12).
  const delay = Math.min(index, 12) * 25;
  const variant = analysis?.ml_tier === "STRONG LEAN" ? "strong-lean"
    : analysis?.ml_tier === "LEAN" ? "lean"
    : "default";

  const isPass = !hasTier;

  return (
    <Card
      as="button"
      interactive
      variant={variant}
      onClick={onClick}
      className="fade-up infield-divider slate-card"
      style={{
        "--delay": `${delay}ms`,
        "--clay": hasTier ? tc : "var(--border)",
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        opacity: isPass ? 0.62 : 1,
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
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
                    <span className="num" style={{ color: "var(--text)" }}>
                      {Math.round(analysis!.ml_confidence * 100)}%
                    </span>{" "}
                    ·{" "}
                    <span className="num" style={{ color: "var(--text)" }}>
                      {(analysis!.ml_kelly_fraction * 100).toFixed(1)}%
                    </span>{" "}
                    K
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
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
                    <span className="num" style={{ color: "var(--text)" }}>
                      {Math.round(analysis!.total_confidence * 100)}%
                    </span>{" "}
                    ·{" "}
                    <span className="num" style={{ color: "var(--text)" }}>
                      {(analysis!.total_kelly_fraction * 100).toFixed(1)}%
                    </span>{" "}
                    K
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
          <div style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-medium)", color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginBottom: "var(--sp-1)" }}>Bullpen vuln</div>
          {game.away_bullpen && <VulnBar abbr={game.away_team_abbr} bp={game.away_bullpen} />}
          {game.home_bullpen && <VulnBar abbr={game.home_team_abbr} bp={game.home_bullpen} />}
          {!game.home_bullpen && !game.away_bullpen && <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>—</div>}
        </div>
      </div>

      {/* Live monitoring — watchlist only (LEAN / STRONG LEAN). PASS games show nothing.
          Delegates all alert markup + freshness/stale styling to the shared component. */}
      {hasTier && <LiveAlert live={game.live ?? null} />}

      {/* Live odds — inside the card */}
      <LiveOddsRow game={game} />
    </Card>
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

  const sortedGames = games ? [...games].sort((a, b) => sortRank(a) - sortRank(b)) : null;

  return (
    <div style={{ position: "relative" }}>
      {/* Page header */}
      <div className="infield-divider" style={{ paddingBottom: "var(--sp-3)", marginBottom: "var(--sp-5)" }}>
        <h1 style={{
          fontFamily: "var(--font-display)", fontWeight: "var(--weight-display)", fontSize: "var(--fs-headline)",
          letterSpacing: "-0.01em", margin: 0, textTransform: "uppercase", color: "var(--text)",
        }}>Daily Slate</h1>
        <div className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}>
          {date}
        </div>
      </div>

      {/* Date nav row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        padding: "var(--sp-2) 0", marginBottom: "var(--sp-5)",
        borderBottom: "1px solid var(--border)",
      }}>
        <DateNav value={date} onChange={changeDate} />
      </div>

      {error && (
        <ErrorBanner
          kind="outage"
          title="Unable to load slate data"
          detail="The backend may be starting up — try refreshing in a moment."
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

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {sortedGames?.map((g, i) => (
          <GameCard
            key={g.game_id}
            game={g}
            index={i}
            onClick={() => openSidebar(g.game_id, g.game_date)}
            trackedML={trackedKeys.has(`${g.game_id}-moneyline`)}
            trackedTotal={trackedKeys.has(`${g.game_id}-total`)}
          />
        ))}
      </div>

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
