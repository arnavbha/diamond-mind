"use client";

/**
 * Scoreboard — fetches live MLB game scores directly from the public
 * MLB Stats API (no key, CORS-permissive). Updates every 30s during
 * the game window so in-progress scores stay fresh.
 *
 * Data source: https://statsapi.mlb.com/api/v1/schedule
 *   hydrate=linescore gives us current inning + runs scored.
 */

import { useEffect, useRef, useState } from "react";
import { teamLogoUrl } from "@/lib/team-logos";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GameScore = {
  gamePk: number;
  status: "preview" | "live" | "final" | "postponed" | "suspended";
  /** "Final" | "In Progress" | "Postponed" | "7:10 PM ET" etc. */
  statusText: string;
  /** Inning label when live, e.g. "T3", "B7" */
  inningLabel: string | null;
  away: { abbr: string; score: number | null };
  home: { abbr: string; score: number | null };
};

// ---------------------------------------------------------------------------
// MLB Stats API abbr normalization
// ---------------------------------------------------------------------------

// MLB API uses full names; map to our 2-3 letter abbrs.
const MLB_ABBR: Record<string, string> = {
  ARI: "ARI", AZ: "ARI",
  ATL: "ATL", BAL: "BAL", BOS: "BOS",
  CHC: "CHC", CWS: "CWS", CIN: "CIN", CLE: "CLE",
  COL: "COL", DET: "DET", HOU: "HOU", KC:  "KC",
  LAA: "LAA", LAD: "LAD", MIA: "MIA", MIL: "MIL",
  MIN: "MIN", NYM: "NYM", NYY: "NYY", OAK: "OAK",
  ATH: "OAK",  // Athletics moved to OAK abbr in our system
  PHI: "PHI", PIT: "PIT", SD: "SD",  SEA: "SEA",
  SF: "SF",   STL: "STL", TB:  "TB", TEX: "TEX",
  TOR: "TOR", WSH: "WSH",
};

function normalizeAbbr(raw: string): string {
  return MLB_ABBR[raw?.toUpperCase()] ?? raw?.toUpperCase() ?? "???";
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchScores(date: string): Promise<GameScore[]> {
  // YYYYMMDD → YYYY-MM-DD for MLB API
  const iso = date.length === 8
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;

  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${iso}` +
    `&hydrate=linescore,team`;

  let data: unknown;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  const dates = (data as { dates?: unknown[] }).dates ?? [];
  if (!dates.length) return [];

  const games = (dates[0] as { games?: unknown[] }).games ?? [];

  return games.map((raw) => {
    const g = raw as Record<string, unknown>;
    const statusObj = (g.status ?? {}) as Record<string, string>;
    const abstractState = statusObj.abstractGameState ?? ""; // Preview / Live / Final
    const codedState = statusObj.codedGameState ?? "";
    const detailedState = statusObj.detailedState ?? "";

    // Classify
    let status: GameScore["status"] = "preview";
    if (abstractState === "Final") status = "final";
    else if (abstractState === "Live") status = "live";
    else if (detailedState.toLowerCase().includes("postponed")) status = "postponed";
    else if (detailedState.toLowerCase().includes("suspended")) status = "suspended";

    // Inning label for live games
    let inningLabel: string | null = null;
    let statusText = detailedState;

    const ls = (g.linescore ?? {}) as Record<string, unknown>;
    if (status === "live") {
      const inning = ls.currentInning as number | undefined;
      const half = ls.inningHalf as string | undefined; // "Top" | "Bottom"
      if (inning != null && half) {
        const halfCode = half === "Top" ? "T" : half === "Bottom" ? "B" : "M";
        inningLabel = `${halfCode}${inning}`;
      }
      statusText = inningLabel ?? "Live";
    } else if (status === "preview") {
      // Convert game time to local ET display
      const gameTime = g.gameDate as string | undefined;
      if (gameTime) {
        try {
          const d = new Date(gameTime);
          statusText = d.toLocaleTimeString("en-US", {
            timeZone: "America/New_York",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }) + " ET";
        } catch {
          statusText = detailedState;
        }
      }
    } else if (status === "final") {
      statusText = "Final";
      // Extra innings?
      const innings = ls.currentInning as number | undefined;
      if (innings && innings > 9) statusText = `Final/${innings}`;
    }

    // Teams
    const teams = (g.teams ?? {}) as Record<string, Record<string, unknown>>;
    const awayTeamInfo = (teams.away?.team ?? {}) as Record<string, string>;
    const homeTeamInfo = (teams.home?.team ?? {}) as Record<string, string>;

    const awayAbbr = normalizeAbbr(awayTeamInfo.abbreviation ?? "");
    const homeAbbr = normalizeAbbr(homeTeamInfo.abbreviation ?? "");

    const awayScore = (teams.away?.score as number | undefined) ?? null;
    const homeScore = (teams.home?.score as number | undefined) ?? null;

    return {
      gamePk: g.gamePk as number,
      status,
      statusText,
      inningLabel,
      away: { abbr: awayAbbr, score: awayScore },
      home: { abbr: homeAbbr, score: homeScore },
    } satisfies GameScore;
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusPip({ status }: { status: GameScore["status"] }) {
  const color =
    status === "live"      ? "var(--green)"  :
    status === "final"     ? "var(--text-3)" :
    status === "postponed" ? "var(--orange)" :
    status === "suspended" ? "var(--orange)" :
    "var(--text-3)";

  return status === "live" ? (
    <span
      style={{
        display: "inline-block",
        width: 6, height: 6,
        borderRadius: "50%",
        background: "var(--green)",
        boxShadow: "0 0 5px 1px var(--green)",
        animation: "pulse 1.4s ease-in-out infinite",
        flexShrink: 0,
      }}
    />
  ) : (
    <span
      style={{
        display: "inline-block",
        width: 6, height: 6,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        opacity: 0.6,
      }}
    />
  );
}

function ScoreCell({
  abbr,
  score,
  isWinner,
  isLive,
  isFinal,
}: {
  abbr: string;
  score: number | null;
  isWinner: boolean;
  isLive: boolean;
  isFinal: boolean;
}) {
  const showScore = isFinal || isLive;
  const scoreColor = isWinner && isFinal ? "var(--text)" : "var(--text-2)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <img
        src={teamLogoUrl(abbr)}
        alt={abbr}
        width={18}
        height={18}
        style={{ objectFit: "contain", flexShrink: 0, opacity: 0.9 }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        fontWeight: isWinner && isFinal ? 700 : 500,
        color: "var(--text)",
        minWidth: 28,
      }}>
        {abbr}
      </span>
      {showScore && (
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: "16px",
          fontWeight: 800,
          color: scoreColor,
          letterSpacing: "-0.01em",
          minWidth: 20,
          textAlign: "right",
        }}>
          {score ?? 0}
        </span>
      )}
    </div>
  );
}

function GameTile({ game }: { game: GameScore }) {
  const isFinal = game.status === "final";
  const isLive = game.status === "live";
  const isPreview = game.status === "preview";
  const isOther = !isFinal && !isLive && !isPreview;

  const awayWins = isFinal && (game.away.score ?? 0) > (game.home.score ?? 0);
  const homeWins = isFinal && (game.home.score ?? 0) > (game.away.score ?? 0);

  const borderColor =
    isLive  ? "var(--green)" :
    isFinal ? "var(--border)" :
    "var(--border-2)";

  const bgColor =
    isLive  ? "rgba(var(--green-rgb, 34,197,94), 0.04)" :
    "var(--surface)";

  return (
    <div style={{
      flexShrink: 0,
      width: 155,
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      {/* Away team */}
      <ScoreCell
        abbr={game.away.abbr}
        score={game.away.score}
        isWinner={awayWins}
        isLive={isLive}
        isFinal={isFinal}
      />
      {/* Home team */}
      <ScoreCell
        abbr={game.home.abbr}
        score={game.home.score}
        isWinner={homeWins}
        isLive={isLive}
        isFinal={isFinal}
      />
      {/* Status row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
        <StatusPip status={game.status} />
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "9px",
          color: isLive ? "var(--green)" : isOther ? "var(--orange)" : "var(--text-3)",
          letterSpacing: "0.05em",
          fontWeight: isLive ? 700 : 500,
        }}>
          {game.statusText}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function Scoreboard({ date }: { date: string }) {
  const [games, setGames] = useState<GameScore[] | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const scores = await fetchScores(date);
    setGames(scores);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    setGames(null);
    void load();

    // Refresh every 30s so live scores stay reasonably current
    timerRef.current = setInterval(() => void load(), 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  if (games === null) {
    return (
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)",
        padding: "12px 0",
      }}>
        Loading scores…
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)",
        padding: "12px 0",
      }}>
        No games found for {date}.
      </div>
    );
  }

  const liveCount = games.filter((g) => g.status === "live").length;
  const finalCount = games.filter((g) => g.status === "final").length;

  return (
    <div style={{ marginBottom: 28 }}>
      {/* Section header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 700,
            textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)",
          }}>
            Scoreboard
          </span>
          {liveCount > 0 && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "9px", fontWeight: 700,
              color: "var(--green)", letterSpacing: "0.06em",
            }}>
              {liveCount} LIVE
            </span>
          )}
          {finalCount > 0 && liveCount === 0 && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "9px",
              color: "var(--text-3)",
            }}>
              {finalCount}/{games.length} final
            </span>
          )}
        </div>
        {lastUpdated && (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-3)",
          }}>
            {liveCount > 0 ? "live · " : ""}updated {lastUpdated.toLocaleTimeString("en-US", {
              timeZone: "America/New_York",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            })}
          </span>
        )}
      </div>

      {/* Horizontal scrolling strip */}
      <div style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        paddingBottom: 4,
        // Hide scrollbar but keep scroll
        scrollbarWidth: "none",
      }}>
        {games.map((g) => (
          <GameTile key={g.gamePk} game={g} />
        ))}
      </div>
    </div>
  );
}
