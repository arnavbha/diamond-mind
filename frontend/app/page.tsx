"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, todayET, type SlateGame, type BullpenData, type GameAnalysis, type Movement } from "@/lib/api";
import { teamLogoUrl } from "@/lib/team-logos";
import { DitherHeader } from "@/components/dither-header";
import { GameDetailPanel } from "@/components/game-detail-panel";
import { LiveAlert } from "@/components/live-alert";

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
    background: "var(--surface)",
    border: "1px solid var(--border-2)",
    borderRadius: "4px",
    padding: "6px 10px",
    color: "var(--text-2)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    cursor: "pointer",
    lineHeight: 1,
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

function vulnColor(score: number): string {
  if (score >= 70) return "var(--red)";
  if (score >= 50) return "var(--amber)";
  return "var(--green)";
}

function tierColor(tier: string): string {
  if (tier === "STRONG LEAN") return "var(--green)";
  if (tier === "LEAN") return "var(--blue)";
  if (tier === "AVOID") return "var(--red)";
  return "var(--text-3)";
}

function VulnBar({ abbr, bp }: { abbr: string; bp: BullpenData }) {
  const color = vulnColor(bp.vulnerability_score);
  const pct = bp.vulnerability_score;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-2)", width: "28px" }}>{abbr}</span>
      <div className="stat-bar-track" style={{ flex: 1 }}>
        <div className="stat-bar-fill" style={{ "--fill": `${pct}%`, "--delay": "80ms", background: color } as React.CSSProperties} />
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color, fontWeight: 600, width: "28px", textAlign: "right" }}>{pct.toFixed(0)}</span>
    </div>
  );
}

function GameCard({ game, index, onClick, trackedML, trackedTotal }: { game: SlateGame; index: number; onClick: () => void; trackedML?: boolean; trackedTotal?: boolean }) {
  const analysis: GameAnalysis | null = game.analysis;
  const hasTier = analysis && analysis.ml_tier !== "PASS" && analysis.ml_lean !== "PASS";
  const tc = hasTier ? tierColor(analysis!.ml_tier) : "var(--border-2)";
  const leanAbbr = analysis?.ml_lean === "HOME" ? game.home_team_abbr
    : analysis?.ml_lean === "AWAY" ? game.away_team_abbr
    : (analysis?.ml_lean && analysis.ml_lean !== "PASS") ? analysis.ml_lean
    : null;
  const hasTotalTier = analysis && analysis.total_tier !== "PASS" && analysis.total_lean !== "PASS";
  const ttc = hasTotalTier ? tierColor(analysis!.total_tier) : "var(--border-2)";
  const totalLabel = analysis?.total_lean === "OVER" ? `O ${analysis.total_line ?? ""}`.trim()
    : analysis?.total_lean === "UNDER" ? `U ${analysis.total_line ?? ""}`.trim() : null;

  const tierClass = analysis?.ml_tier === "STRONG LEAN" ? "game-card-tier-sl"
    : analysis?.ml_tier === "LEAN" ? "game-card-tier-l"
    : "game-card-tier-pass";

  const isPass = !hasTier;

  return (
    <div
      onClick={onClick}
      style={{ textDecoration: "none", cursor: "pointer" }}
    >
      <div
        className={`game-card fade-up infield-divider glare-card ${tierClass}`}
        style={{
          "--delay": `${index * 35}ms`,
          "--clay": hasTier ? tc : "var(--border-2)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "0",
          opacity: isPass ? 0.5 : 1,
          transition: "opacity 0.12s, background 0.12s, border-color 0.12s",
        } as React.CSSProperties}
      >
        {/* Main row: matchup · signal · bullpen */}
        <div className="game-card-grid mobile-stack" style={{ display: "grid", gridTemplateColumns: "1fr 160px 1fr", gap: "16px", alignItems: "center" }}>
          {/* Matchup */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <TeamLogo abbr={game.away_team_abbr} size={22} />
              <span style={{ fontWeight: 600, fontSize: "15px", color: "var(--text)", letterSpacing: "-0.02em" }}>{game.away_team_abbr}</span>
              {gameStarted(game.status) ? (
                <>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "16px", color: "var(--text)", minWidth: "18px", textAlign: "right" }}>{game.away_score ?? "—"}</span>
                  <span style={{ color: "var(--text-3)", fontSize: "12px" }}>–</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "16px", color: "var(--text)", minWidth: "18px" }}>{game.home_score ?? "—"}</span>
                </>
              ) : (
                <span style={{ color: "var(--text-3)", fontSize: "13px" }}>@</span>
              )}
              <TeamLogo abbr={game.home_team_abbr} size={22} />
              <span style={{ fontWeight: 600, fontSize: "15px", color: "var(--text)", letterSpacing: "-0.02em" }}>{game.home_team_abbr}</span>
            </div>
            {game.venue && (
              <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-3)", marginTop: "3px" }}>{game.venue}</div>
            )}
          </div>

          {/* Model signal */}
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "8px" }}>
            {/* ML signal */}
            <div>
              {analysis ? (
                hasTier ? (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: tc, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {analysis.ml_tier}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)", marginTop: "2px" }}>
                      {leanAbbr} to win
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-2)", marginTop: "1px" }}>
                      <span className="scoreboard-num" style={{ fontSize: "12px", color: "var(--text)" }}>
                        {Math.round(analysis.ml_confidence * 100)}%
                      </span>{" "}
                      ·{" "}
                      <span className="scoreboard-num" style={{ fontSize: "12px", color: "var(--text)" }}>
                        {(analysis.ml_kelly_fraction * 100).toFixed(1)}%
                      </span>{" "}
                      K
                    </div>
                  </>
                ) : trackedML ? (
                  <div style={{ fontSize: "9px", fontWeight: 600, color: "var(--blue)", textTransform: "uppercase", letterSpacing: "0.08em", border: "1px solid var(--blue)", borderRadius: "3px", padding: "2px 6px", display: "inline-block" }}>
                    ML tracked
                  </div>
                ) : (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>Pass</div>
                )
              ) : (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>—</div>
              )}
            </div>

            {/* Total signal */}
            {(hasTotalTier && totalLabel) || trackedTotal ? (
              <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: "6px" }}>
                {hasTotalTier && totalLabel ? (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: ttc, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {analysis!.total_tier}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--text)", marginTop: "2px" }}>
                      {totalLabel}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-2)", marginTop: "1px" }}>
                      <span className="scoreboard-num" style={{ fontSize: "12px", color: "var(--text)" }}>
                        {Math.round(analysis!.total_confidence * 100)}%
                      </span>{" "}
                      ·{" "}
                      <span className="scoreboard-num" style={{ fontSize: "12px", color: "var(--text)" }}>
                        {(analysis!.total_kelly_fraction * 100).toFixed(1)}%
                      </span>{" "}
                      K
                    </div>
                  </>
                ) : trackedTotal ? (
                  <div style={{ fontSize: "9px", fontWeight: 600, color: "var(--blue)", textTransform: "uppercase", letterSpacing: "0.08em", border: "1px solid var(--blue)", borderRadius: "3px", padding: "2px 6px", display: "inline-block" }}>
                    Total tracked
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Bullpen */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 500, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "6px" }}>Bullpen vuln</div>
            {game.away_bullpen && <VulnBar abbr={game.away_team_abbr} bp={game.away_bullpen} />}
            {game.home_bullpen && <VulnBar abbr={game.home_team_abbr} bp={game.home_bullpen} />}
            {!game.home_bullpen && !game.away_bullpen && <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>—</div>}
          </div>
        </div>

        {/* Live monitoring — watchlist only (LEAN / STRONG LEAN). PASS games show nothing.
            Delegates all alert markup + freshness/stale styling to the shared component. */}
        {hasTier && <LiveAlert live={game.live ?? null} />}

        {/* Live odds — inside the card */}
        <LiveOddsRow game={game} />
      </div>
    </div>
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

function oddsColor(n: number | null | undefined): string {
  if (n == null) return "var(--text-2)";
  return n > 0 ? "var(--amber)" : "var(--blue)";
}

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
    <span style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--text-3)" }}>
      <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label} fair</span>
      <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{awayTag}</span>
      <span style={{ color: "var(--text-2)" }}>{fmtOdds(fairAway)}</span>
      <span style={{ color: "var(--border-2)" }}>/</span>
      <span style={{ color: "var(--text-2)", fontWeight: 600 }}>{homeTag}</span>
      <span style={{ color: "var(--text-2)" }}>{fmtOdds(fairHome)}</span>
      <span
        title="Book hold (overround) — the vig baked into both sides"
        style={{ color: "var(--orange)", fontWeight: 600 }}
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
      <span style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--text-3)" }}>
        <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label} line</span>
        <span style={{ color: "var(--text-3)" }}>{why}</span>
      </span>
    );
  }

  const color =
    m.agreement === "toward" ? "var(--green)"
    : m.agreement === "away" ? "var(--red)"
    : "var(--text-3)"; // neutral / no lean

  const sideTag = movementSideTag(m, homeAbbr, awayAbbr);
  const dirWord =
    m.agreement === "toward" ? "toward"
    : m.agreement === "away" ? "away from"
    : null;

  // Totals: prefer the line move (e.g. 8.5 → 9.0) when present.
  const lineMoved = m.line_delta != null && m.line_delta !== 0
    && m.open?.line != null && m.close?.line != null;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--text-3)" }}>
      <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label} line</span>
      {lineMoved ? (
        <span style={{ color: "var(--text-2)", fontWeight: 600 }}>
          {m.open!.line} → {m.close!.line}
        </span>
      ) : (
        <span style={{ color: "var(--text-2)", fontWeight: 600 }}>
          {fmtOdds(openA)} → {fmtOdds(closeA)}
        </span>
      )}
      {dirWord && sideTag ? (
        <>
          <span style={{ color: "var(--border-2)" }}>·</span>
          <span style={{ color, fontWeight: 600 }}>{dirWord} {sideTag}</span>
        </>
      ) : (
        <>
          <span style={{ color: "var(--border-2)" }}>·</span>
          <span style={{ color: "var(--text-3)", fontWeight: 600 }}>flat</span>
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
      marginTop: "10px",
      paddingTop: "8px",
      borderTop: "1px solid var(--border-2)",
      display: "flex",
      flexWrap: "wrap",
      gap: "20px",
      alignItems: "center",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      color: "var(--text-2)",
    }}>
      {gameIsLive(game.status) && (
        <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.08em", border: "1px solid var(--green)", borderRadius: "3px", padding: "1px 5px" }}>Live</span>
      )}
      {gameIsFinal(game.status) && (
        <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", border: "1px solid var(--border-2)", borderRadius: "3px", padding: "1px 5px" }}>Final</span>
      )}
      {!gameStarted(game.status) && (
        <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "1px 5px" }}>Odds</span>
      )}
      {(awayML != null || homeML != null) && (
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ color: "var(--text-3)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>ML</span>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{game.away_team_abbr}</span>
          <span style={{ color: oddsColor(awayML), fontWeight: 700, fontSize: "12px" }}>{fmtOdds(awayML)}</span>
          <span style={{ color: "var(--border-2)" }}>/</span>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{game.home_team_abbr}</span>
          <span style={{ color: oddsColor(homeML), fontWeight: 700, fontSize: "12px" }}>{fmtOdds(homeML)}</span>
        </span>
      )}
      {tot && tot.line != null && (
        <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <span style={{ color: "var(--text-3)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>O/U</span>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{tot.line}</span>
          <span style={{ color: "var(--text-3)" }}>(</span>
          <span>O <span style={{ color: oddsColor(tot.over), fontWeight: 600 }}>{fmtOdds(tot.over)}</span></span>
          <span>U <span style={{ color: oddsColor(tot.under), fontWeight: 600 }}>{fmtOdds(tot.under)}</span></span>
          <span style={{ color: "var(--text-3)" }}>)</span>
        </span>
      )}
      {odds.captured_at && (
        <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: "10px" }}>
          updated {relTime(odds.captured_at)}
        </span>
      )}
      {/* No-vig fair line + book hold. Server emits `fair` only when the book
          priced both sides; this exposes the vig and is NOT a pick. */}
      {(mlFair || totFair) && (
        <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center" }}>
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
        <div style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center" }}>
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

function SlatePageInner() {
  const searchParams = useSearchParams();
  const today = todayET();
  const [date, setDate] = useState(() => searchParams.get("date") ?? today);
  const [games, setGames] = useState<SlateGame[] | null>(null);
  const [error, setError] = useState(false);
  const [sidebar, setSidebar] = useState<{ gameId: number; date: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    if (!sidebar) return;
    // Small delay so CSS transition fires after mount
    const t = setTimeout(() => setSidebarOpen(true), 10);
    return () => clearTimeout(t);
  }, [sidebar]);

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
  // URL); we just animate the sheet closed.
  useEffect(() => {
    function onPop() {
      const onGameUrl = window.location.pathname.startsWith("/game/");
      if (!onGameUrl) {
        setSidebarOpen(false);
        setTimeout(() => setSidebar(null), 280);
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openSidebar(gameId: number, gameDate: string) {
    setSidebar({ gameId, date: gameDate });
    setSidebarOpen(false);
    window.history.pushState(null, "", `/game/${gameId}?date=${gameDate}`);
  }

  function closeSidebar() {
    setSidebarOpen(false);
    window.history.pushState(null, "", `/?date=${date}`);
    setTimeout(() => setSidebar(null), 280);
  }

  function changeDate(d: string) { setGames(null); setError(false); setDate(d); }

  return (
    <div style={{ position: "relative" }}>
      <div className="diamond-watermark" aria-hidden="true">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <polygon points="100,16 184,100 100,184 16,100" fill="none" stroke="var(--text)" strokeWidth={1} />
          <polygon points="100,58 142,100 100,142 58,100" fill="none" stroke="var(--text)" strokeWidth={1} />
          <line x1="100" y1="16" x2="100" y2="184" stroke="var(--text)" strokeWidth={1} />
          <line x1="16" y1="100" x2="184" y2="100" stroke="var(--text)" strokeWidth={1} />
        </svg>
      </div>
      {/* Dither banner */}
      <div style={{ position: "relative", borderRadius: "6px", overflow: "hidden", marginBottom: "0", border: "1px solid #58A6FF66" }}>
        <DitherHeader
          color={[0.2, 0.5, 0.95]}
          colorNum={8}
          amplitude={0.3}
          frequency={3}
          speed={0.03}
          height={110}
        />
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "flex-end",
          padding: "0 20px 14px",
          background: "linear-gradient(to right, rgba(8,12,16,0.65) 0%, rgba(8,12,16,0.2) 60%, rgba(8,12,16,0.55) 100%)",
        }}>
          <div>
            <h1 style={{
              fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "22px",
              letterSpacing: "-0.01em", margin: 0, textTransform: "uppercase", color: "var(--text)",
            }}>Daily Slate</h1>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "rgba(255,255,255,0.7)", marginTop: "4px", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
              {date}
            </div>
          </div>
        </div>
      </div>

      {/* Date nav row */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        padding: "10px 0", marginBottom: "20px",
        borderBottom: "1px solid var(--border)",
      }}>
        <DateNav date={date} onChange={changeDate} />
      </div>

      {error && <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--red)", padding: "10px 12px", border: "1px solid var(--red)", borderRadius: "4px", marginBottom: "16px" }}>Unable to load slate data. The backend may be starting up — try refreshing in a moment.</div>}
      {!error && games === null && <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>Loading…</div>}
      {games?.length === 0 && <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>No games for {date}.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {games?.map((g, i) => (
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

      {/* Game detail sidebar */}
      <div
        className={`game-sidebar-backdrop${sidebarOpen ? " open" : ""}`}
        onClick={closeSidebar}
      />
      <div className={`game-sidebar${sidebarOpen ? " open" : ""}`}>
        {sidebar && (
          <>
            <div className="game-sidebar-header">
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)", letterSpacing: "0.04em" }}>
                GAME DETAIL · {sidebar.date}
              </span>
              <button className="game-sidebar-close" onClick={closeSidebar}>✕ Close</button>
            </div>
            <div style={{ padding: "20px", flex: 1 }}>
              <GameDetailPanel gameId={sidebar.gameId} date={sidebar.date} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SlatePage() {
  return (
    <Suspense fallback={<div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-3)", padding: "40px 0", textAlign: "center" }}>Loading…</div>}>
      <SlatePageInner />
    </Suspense>
  );
}
