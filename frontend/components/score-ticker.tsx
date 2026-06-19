"use client";

/**
 * ScoreTicker — ESPN-style continuous scrolling score strip.
 *
 * Fetches live MLB scores from the public MLB Stats API every 60s.
 * Duplicates the item list to create a seamless infinite loop.
 * Pinned just below the nav, visible on every page.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// Hydration-safe mount flag. Server snapshot is always false; the client
// snapshot is true, so the first client render after hydration flips it
// without a synchronous setState-in-effect.
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TickerGame = {
  gamePk: number;
  awayAbbr: string;
  homeAbbr: string;
  awayScore: number | null;
  homeScore: number | null;
  /** "live" | "final" | "preview" | "postponed" */
  state: "live" | "final" | "preview" | "postponed";
  /** Short status string: "T7" | "B3" | "F" | "F/10" | "7:10 PM" | "PPD" */
  label: string;
};

// ---------------------------------------------------------------------------
// MLB abbreviation map
// ---------------------------------------------------------------------------

const MLB_ABBR: Record<string, string> = {
  ARI: "ARI", AZ: "ARI",
  ATL: "ATL", BAL: "BAL", BOS: "BOS",
  CHC: "CHC", CWS: "CWS", CIN: "CIN", CLE: "CLE",
  COL: "COL", DET: "DET", HOU: "HOU", KC: "KC",
  LAA: "LAA", LAD: "LAD", MIA: "MIA", MIL: "MIL",
  MIN: "MIN", NYM: "NYM", NYY: "NYY", OAK: "OAK", ATH: "OAK",
  PHI: "PHI", PIT: "PIT", SD: "SD", SEA: "SEA",
  SF: "SF", STL: "STL", TB: "TB", TEX: "TEX",
  TOR: "TOR", WSH: "WSH",
};

function toAbbr(raw: string): string {
  return MLB_ABBR[raw?.toUpperCase()] ?? raw?.toUpperCase() ?? "???";
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function loadGames(date: string): Promise<TickerGame[]> {
  const iso = /^\d{8}$/.test(date)
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    : date;

  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${iso}&hydrate=linescore,team`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const games: unknown[] = data?.dates?.[0]?.games ?? [];

    return games.map((raw) => {
      const g = raw as Record<string, unknown>;
      const statusObj = (g.status ?? {}) as Record<string, string>;
      const abstractState = statusObj.abstractGameState ?? "";
      const detailedState = statusObj.detailedState ?? "";

      // MLB returns abstractGameState="Live" for warmup/pre-game states
      // before first pitch. Guard on detailedState to avoid false "T1".
      const PRE_GAME_STATES = ["warmup", "pre-game", "delayed start", "preview", "scheduled"];
      const detailedLower = detailedState.toLowerCase();
      const isActuallyLive = abstractState === "Live" &&
        !PRE_GAME_STATES.some(s => detailedLower.includes(s));

      let state: TickerGame["state"] = "preview";
      if (abstractState === "Final") state = "final";
      else if (isActuallyLive) state = "live";
      else if (detailedLower.includes("postponed")) state = "postponed";

      const ls = (g.linescore ?? {}) as Record<string, unknown>;
      const teams = (g.teams ?? {}) as Record<string, Record<string, unknown>>;

      const awayAbbr = toAbbr(((teams.away?.team ?? {}) as Record<string, string>).abbreviation ?? "");
      const homeAbbr = toAbbr(((teams.home?.team ?? {}) as Record<string, string>).abbreviation ?? "");
      const awayScore = (teams.away?.score as number | undefined) ?? null;
      const homeScore = (teams.home?.score as number | undefined) ?? null;

      // Build short label
      let label = "";
      if (state === "live") {
        const inning = ls.currentInning as number | undefined;
        const half = ls.inningHalf as string | undefined;
        const h = half === "Top" ? "T" : half === "Bottom" ? "B" : "M";
        label = inning != null ? `${h}${inning}` : "LIVE";
      } else if (state === "final") {
        const inn = ls.currentInning as number | undefined;
        label = inn && inn > 9 ? `F/${inn}` : "F";
      } else if (state === "postponed") {
        label = "PPD";
      } else {
        // Pre-game: show ET start time
        const gameTime = g.gameDate as string | undefined;
        if (gameTime) {
          try {
            label = new Date(gameTime).toLocaleTimeString("en-US", {
              timeZone: "America/New_York",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
            });
          } catch {
            label = "TBD";
          }
        } else {
          label = "TBD";
        }
      }

      return { gamePk: g.gamePk as number, awayAbbr, homeAbbr, awayScore, homeScore, state, label };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Today in ET
// ---------------------------------------------------------------------------

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ---------------------------------------------------------------------------
// Single ticker item
// ---------------------------------------------------------------------------

function TickerItem({ game }: { game: TickerGame }) {
  const isLive = game.state === "live";
  const isFinal = game.state === "final";
  const isPPD = game.state === "postponed";
  const showScore = isLive || isFinal;

  const labelColor = isLive
    ? "var(--pos)"
    : isPPD
    ? "var(--warn)"
    : "var(--text-2)";

  const awayWins = isFinal && (game.awayScore ?? 0) > (game.homeScore ?? 0);
  const homeWins = isFinal && (game.homeScore ?? 0) > (game.awayScore ?? 0);

  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "0 14px",
      whiteSpace: "nowrap",
    }}>
      {/* Live pulse dot */}
      {isLive && (
        <span className="live-dot-ticker" style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "var(--pos)",
          display: "inline-block",
          flexShrink: 0,
          // The ONE allowed infinite decorative animation: the live pulse on a
          // genuinely in-progress game. Guarded by the reduced-motion blanket.
          animation: "livePulse 1.4s ease-in-out infinite",
        }} />
      )}

      {/* Away */}
      <span style={{
        fontWeight: awayWins ? 700 : 500,
        color: awayWins ? "var(--text)" : "var(--text-2)",
      }}>
        {game.awayAbbr}
        {showScore && (
          <span style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-display)",
            fontSize: "11px",
            marginLeft: 4,
            color: awayWins ? "var(--text)" : "var(--text-2)",
          }}>
            {game.awayScore ?? 0}
          </span>
        )}
      </span>

      {/* Divider */}
      <span style={{ color: "var(--text-3)", fontSize: "9px" }}>·</span>

      {/* Home */}
      <span style={{
        fontWeight: homeWins ? 700 : 500,
        color: homeWins ? "var(--text)" : "var(--text-2)",
      }}>
        {game.homeAbbr}
        {showScore && (
          <span style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-display)",
            fontSize: "11px",
            marginLeft: 4,
            color: homeWins ? "var(--text)" : "var(--text-2)",
          }}>
            {game.homeScore ?? 0}
          </span>
        )}
      </span>

      {/* Status label */}
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-meta)",
        fontWeight: isLive ? 700 : 500,
        color: labelColor,
        letterSpacing: "0.04em",
        marginLeft: 1,
      }}>
        {game.label}
      </span>
    </span>
  );
}

// Separator between games
function Dot() {
  return (
    <span style={{
      display: "inline-block",
      width: 3,
      height: 3,
      borderRadius: "50%",
      background: "var(--text-3)",
      opacity: 0.4,
      flexShrink: 0,
      alignSelf: "center",
    }} />
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ScoreTicker() {
  const [games, setGames] = useState<TickerGame[]>([]);
  const mounted = useMounted();
  // The horizontal scroll is a decorative infinite animation. Gate it on the
  // motion budget (reduced-motion / Save-Data / coarse pointer) and pause it
  // when the tab is hidden. When paused, the strip is fully readable (it just
  // doesn't scroll) — no data is hidden. The 60s data poll keeps running.
  const [scrolling, setScrolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    // Async fetch — setState only runs after the await resolves (and only while
    // still mounted), so it is not a synchronous setState-in-effect.
    async function refresh() {
      const result = await loadGames(todayET());
      if (active) setGames(result);
    }
    void refresh();
    intervalRef.current = setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Decide whether the scroll animation may run, and pause on tab-hidden.
  useEffect(() => {
    const mm = (q: string) =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(q).matches
        : false;
    const conn = (typeof navigator !== "undefined" &&
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection) || undefined;
    const saveData = conn?.saveData === true;
    const motionAllowed =
      !mm("(prefers-reduced-motion: reduce)") && !saveData && !mm("(pointer: coarse)");

    function sync() {
      setScrolling(motionAllowed && !document.hidden);
    }
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // Don't render on server (uses ET date + fetch)
  if (!mounted || games.length === 0) return null;

  // Speed: ~80px per second. Estimate item width at ~130px each.
  const totalPx = games.length * 130;
  const durationSec = Math.max(20, totalPx / 80);

  // Build interleaved items with dots
  const items = games.flatMap((g, i) =>
    i < games.length - 1
      ? [<TickerItem key={g.gamePk} game={g} />, <Dot key={`dot-${g.gamePk}`} />]
      : [<TickerItem key={g.gamePk} game={g} />]
  );

  return (
    <div style={{
      width: "100%",
      height: "var(--ticker-h)",
      background: "var(--surface-2)",
      // When scrolling, clip the duplicated track. When paused (reduced-motion /
      // hidden / data-saver), allow horizontal scroll so a long slate stays
      // fully readable without animation.
      overflowX: scrolling ? "hidden" : "auto",
      overflowY: "hidden",
      position: "sticky",
      top: "var(--nav-h)",
      // Just below the nav (--z-nav); a hair under so the sticky nav wins.
      zIndex: 99,
      display: "flex",
      alignItems: "center",
    }}>
      {/* Static bottom hairline. The retired rainbow ticker line conflated
          "data is scrolling" with "a game is live"; the green live-dot is now
          the sole live signal, so this is a neutral structural border. */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 1,
        background: "var(--border)",
      }} />
      {scrolling ? (
        // Scrolling track — contents duplicated for a seamless loop.
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          animation: `scoreTicker ${durationSec}s linear infinite`,
          willChange: "transform",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-body)",
          letterSpacing: "0.02em",
        }}>
          {/* First copy */}
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {items}
            <Dot />
          </span>
          {/* Duplicate for seamless loop */}
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {items}
            <Dot />
          </span>
        </div>
      ) : (
        // Static (paused) track — single copy, scrollable, no animation.
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-body)",
          letterSpacing: "0.02em",
        }}>
          {items}
          <Dot />
        </div>
      )}
    </div>
  );
}
