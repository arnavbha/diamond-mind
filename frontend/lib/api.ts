const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Date helpers — always use Eastern Time (America/New_York) for game dates.
// new Date().toISOString() returns UTC and will show tomorrow after 8 PM ET.
// ---------------------------------------------------------------------------
export function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ---------------------------------------------------------------------------
// Admin token — stored in localStorage, sent as X-Admin-Token on mutations.
// ---------------------------------------------------------------------------
export function getAdminToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("admin_token") ?? "";
}

export function setAdminToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem("admin_token", token);
  } else {
    localStorage.removeItem("admin_token");
  }
}

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAdminToken();
  return {
    ...(token ? { "X-Admin-Token": token } : {}),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Client-side GET cache (in-memory, module-scoped)
// ---------------------------------------------------------------------------
// Every page in this app is a "use client" component fetching through useEffect,
// so Next's `{ next: { revalidate } }` (a Server-Component fetch-cache control)
// never engages — each mount hit the backend cold. This module-level Map gives
// those client fetches a real TTL cache. Keyed by the full path + query string
// (the same string passed to `get`). A second in-flight map de-dupes concurrent
// identical requests (e.g. React 19 StrictMode's double-mount in dev, or two
// components asking for the same slate) into a single network round-trip.
type CacheEntry = { data: unknown; ts: number };
const _cache = new Map<string, CacheEntry>();
const _inflight = new Map<string, Promise<unknown | null>>();

// TTLs (ms). Slate/picks/edge/report data is fine slightly stale; tracker bets
// change on every settle/track so they get a shorter window; mutations never
// read or write the cache.
const TTL_DEFAULT = 60_000; // slate, picks, edge, report, analysis, fair-value …
const TTL_TRACKER = 30_000; // tracker bets / summary / track-record
const TTL_NONE = 0;         // mutations + anything that must always be fresh

/** Drop every cached + in-flight entry whose key starts with any given prefix.
 *  Called after a mutation so the next read re-fetches the affected resource. */
function bust(...prefixes: string[]): void {
  for (const key of _cache.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) _cache.delete(key);
  }
  for (const key of _inflight.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) _inflight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function get<T>(path: string, ttl: number = TTL_DEFAULT): Promise<T | null> {
  const now = Date.now();

  // Fresh cache hit → return without touching the network. (Honors ttl=0 as
  // "never cache": the entry is skipped both on read and on write.)
  if (ttl > 0) {
    const hit = _cache.get(path);
    if (hit && now - hit.ts < ttl) return hit.data as T;

    // A matching request is already in flight — share it instead of firing a
    // second identical fetch.
    const pending = _inflight.get(path);
    if (pending) return pending as Promise<T | null>;
  }

  const req = (async (): Promise<T | null> => {
    try {
      const res = await fetch(`${API}${path}`, { next: { revalidate: 60 } });
      if (!res.ok) return null;
      const data = (await res.json()) as T;
      if (ttl > 0) _cache.set(path, { data, ts: Date.now() });
      return data;
    } catch {
      return null;
    } finally {
      _inflight.delete(path);
    }
  })();

  if (ttl > 0) _inflight.set(path, req as Promise<unknown | null>);
  return req;
}

// Mutations never read or write the GET cache. On success they purge any cached
// reads that the write could have invalidated (passed as path-prefix `bustKeys`).
async function post<T>(path: string, body: unknown, bustKeys?: string[]): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    if (bustKeys) bust(...bustKeys);
    return res.json();
  } catch {
    return null;
  }
}

async function patch<T>(path: string, body: unknown, bustKeys?: string[]): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    if (bustKeys) bust(...bustKeys);
    return res.json();
  } catch {
    return null;
  }
}

async function del(path: string, bustKeys?: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    const ok = res.ok || res.status === 204;
    if (ok && bustKeys) bust(...bustKeys);
    return ok;
  } catch {
    return false;
  }
}

// Path-prefix groups for cache invalidation. A tracker write changes the bets
// list + summary + the live track-record, and also the slate/picks pages, which
// each seed their "Tracked ✓" state from /tracker/bets. Bust all of them.
const TRACKER_BUST = ["/tracker/", "/games/slate", "/games/picks"];

export type Game = {
  game_id: number;
  game_date: string;
  home_team_id: number;
  away_team_id: number;
  home_team_abbr: string;
  away_team_abbr: string;
  venue: string;
  home_probable_starter_id: number | null;
  away_probable_starter_id: number | null;
};

export type BullpenData = {
  fatigue_score: number;
  overall_quality: number;
  available_quality: number;
  vulnerability_score: number;
  unavailable_relievers: string[];
  limited_relievers: string[];
  best_available: string[];
  betting_implication: string;
};

export type PitcherForm = {
  starts: number;
  pitcher_name: string;
  era: number | null;
  whip: number | null;
  k_per_9: number | null;
  bb_per_9: number | null;
  hr_per_9: number | null;
  fip: number | null;
  babip: number | null;
  avg_pitches_per_start: number | null;
  trend_label: string;
  insufficient_sample: boolean;
};

export type GameBundle = {
  game_id: number;
  game_date: string;
  status: string;
  venue: string;
  home_team_id: number;
  away_team_id: number;
  home_team_abbr: string;
  away_team_abbr: string;
  home_form: Record<string, unknown> | null;
  away_form: Record<string, unknown> | null;
  home_starter: PitcherForm | null;
  away_starter: PitcherForm | null;
  home_bullpen: BullpenData | null;
  away_bullpen: BullpenData | null;
};

export type GameAnalysis = {
  game_id: number;
  home_team_abbr: string;
  away_team_abbr: string;
  model_home_win_prob: number;
  model_away_win_prob: number;
  ml_lean: string;
  ml_confidence: number;
  ml_tier: string;
  total_lean: string;
  total_tier: string;
  total_confidence: number;
  projected_total: number;
  total_line: number | null;
  total_kelly_fraction: number;
  qt_edge_quant: number;
  qt_edge_sd: number;
  qt_prob_positive: number;
  qt_p_model: number;
  qt_p_shrunk: number;
  qt_kelly_sized: number;
  qt_kelly_mult: number;
  qt_growth_rate: number;
  ml_kelly_fraction: number;
  key_factors: string[];
  cautions: string[];
  sp_advantage: string;
  bullpen_edge: string;
  offense_edge: string;
  ml_american_odds: number;
  implied_prob: number;
  vig_free_implied: number;
  overround: number;
  edge_vig_free: number;
  ev_per_dollar: number;
  component_fip: number;
  component_bullpen: number;
  component_offense: number;
  component_trend: number;
  component_k_matchup: number;
  component_weather: number;
  component_rest: number;
  component_park: number;
  // ── Quant layer (PhD-level) ──────────────────────────────
  q_prop_vig_free: number;   // proportional devig (Sonnet 4.6 theory)
  q_shin_vig_free: number;   // Shin devig (Opus 4.7)
  q_shin_z: number;          // estimated insider proportion
  q_p_model: number;
  q_p_shrunk: number;        // after Bayesian shrinkage to market
  q_shrink_weight: number;
  q_edge_naive: number;
  q_edge_quant: number;      // honest edge
  q_edge_sd: number;
  q_prob_positive: number;   // P(edge > 0)
  q_ci_low: number;
  q_ci_high: number;
  q_effective_n: number;
  q_kelly_full: number;
  q_kelly_sized: number;
  q_kelly_mult: number;      // derived multiplier
  q_growth_rate: number;     // expected log-growth per bet
  q_doubling_bets: number;   // 0 = never
  q_evidence_quality: number;
  // from picks endpoint
  game_date?: string;
  venue?: string;
};

export type TeamBatting = {
  estimated_woba: number | null;
  iso: number | null;
  strikeout_rate: number | null;
  walk_rate: number | null;
  ops: number | null;
  batting_avg: number | null;
  on_base_pct: number | null;
  slugging_pct: number | null;
  stolen_bases: number;
  caught_stealing: number;
  stolen_base_success_rate: number | null;
  games: number;
  insufficient_sample: boolean;
};

export type WeatherData = {
  temperature_f: number | null;
  wind_speed_mph: number | null;
  wind_direction_deg: number | null;
  precipitation_chance: number | null;
  is_dome: boolean;
};

/** Returned by /games/{id}/context — bundle + weather + analysis in one call. */
export type GameContext = {
  game_id: number;
  game_date: string;
  status: string;
  venue: string;
  home_team_id: number;
  away_team_id: number;
  home_team_abbr: string;
  away_team_abbr: string;
  home_form: Record<string, unknown> | null;
  away_form: Record<string, unknown> | null;
  home_starter: PitcherForm | null;
  away_starter: PitcherForm | null;
  home_bullpen: BullpenData | null;
  away_bullpen: BullpenData | null;
  weather: WeatherData | null;
  analysis: GameAnalysis | null;
};

// ── Beat-the-Book fair value (no-vig) ───────────────────────────────────────
// Computed server-side via Shin devig and attached inline to the slate's
// live_odds payload. Present ONLY when BOTH sides have a non-zero captured price
// from the one pinned book; otherwise null (honest empty state — never a
// fabricated single-side fair line). All fields additive so older payloads parse.
// This exposes the book's vig; it is NOT a pick.
export type FairMoneyline = {
  home_odds: number | null;
  away_odds: number | null;
  home_prob: number;
  away_prob: number;
  hold_pct: number;
  shin_z: number;
};

export type FairTotal = {
  over_odds: number | null;
  under_odds: number | null;
  over_prob: number;
  under_prob: number;
  hold_pct: number;
  shin_z?: number;
};

// ── Line movement (single-book net move, open → close) ──────────────────────
// NOT cross-book "steam": our odds are effectively single-book (DraftKings), so
// this is the NET move for one bookmaker between the opening pre-first-pitch
// snapshot and the latest pre-first-pitch snapshot. `american_delta` is DISPLAY
// ONLY; the toward/away decision is made server-side on `devig_prob_delta`
// (or `line_delta` for totals). Additive — older payloads omit `movement`.
//   source: "live"               → two real pre-pitch snapshots, deltas valid
//           "single_snapshot"    → only one pre-pitch snapshot (no movement)
//           "one_sided"          → could not devig (raw price-implied delta only)
//           "no_book_snapshots"  → no snapshots for this book/market
//           "no_first_pitch"     → game time unknown, cannot bound pre-pitch
export type MovementEndpoint = {
  american: number | null;
  line: number | null;
  captured_at: string | null;
};

export type Movement = {
  source: "live" | "single_snapshot" | "one_sided" | "no_book_snapshots" | "no_first_pitch";
  bookmaker: string | null;
  open: MovementEndpoint;
  close: MovementEndpoint;
  // The leaned side the deltas are measured FOR. "market" when the lean is
  // PASS/None (deltas reported for the home/over reference side, no agreement).
  side: "home" | "away" | "over" | "under" | "market" | null;
  american_delta: number | null;   // close − open. DISPLAY ONLY — never the decision.
  devig_prob_delta: number | null;  // leaned-side Shin vig-free close − open; raw price-implied when source=="one_sided"; null on a dominant totals line move
  line_delta: number | null;        // totals only: line_close − line_open
  // Classified SOLELY on devig_prob_delta (|.|>=0.015) except totals where
  // |line_delta|>=0.5 dominates (line UP favors OVER). null when no lean or
  // insufficient data.
  agreement: "toward" | "away" | "neutral" | null;
  label: "confirmation" | "fade" | "flat" | null;
};

/** Latest market odds per game — refreshed by /admin/tick. */
export type LiveOdds = {
  moneyline: {
    home: number | null;
    away: number | null;
    bookmaker?: string | null;
    fair?: FairMoneyline | null;
    movement?: Movement | null;
  };
  total: {
    line: number;
    over: number | null;
    under: number | null;
    bookmaker: string;
    fair?: FairTotal | null;
    movement?: Movement | null;
  } | null;
  captured_at: string | null;
};

// ── /games/{id}/fair-value — per-market fair vs offered + book hold ──────────
export type FairValueResult = {
  game_id: number;
  home_team_abbr: string | null;
  away_team_abbr: string | null;
  captured_at: string | null;
  moneyline: {
    offered: { home: number | null; away: number | null } | null;
    bookmaker: string | null;
    fair: FairMoneyline | null;
    hold_pct: number | null;
    // model's vig-free prob for the LEANED side only (null unless analyzer ran
    // against real odds). A disagreement readout vs the book's no-vig prob — not a pick.
    model_fair_prob: number | null;
    model_fair_side: "home" | "away" | null;
    movement?: Movement | null;
  };
  total: {
    offered: { line: number | null; over: number | null; under: number | null } | null;
    bookmaker: string | null;
    fair: FairTotal | null;
    hold_pct: number | null;
    movement?: Movement | null;
  };
};

// ── /tools/boost-ev — stateless DraftKings profit-boost EV checker ───────────
// A profit boost multiplies NET PROFIT only (never the stake). Verification
// framing: returns +EV / marginal / -EV — never "bet this".
export type BoostEv = {
  odds: number;
  boost_pct: number;
  fair_prob: number;
  stake: number;
  decimal: number;
  boosted_decimal: number;
  boosted_american: number | null;
  boosted_payout_per_unit: number;
  boosted_profit_per_unit: number;
  ev_units: number;
  ev_pct: number;
  breakeven_prob: number;
  edge_vs_breakeven: number; // fair_prob - breakeven_prob
  verdict: "+EV" | "marginal" | "-EV";
};

// ── /tools/parlay-ev — stateless parlay / same-game-parlay fair-value checker ─
// Compares an OFFERED parlay price to the fair price under the INDEPENDENCE
// assumption (product of each leg's vig-free fair prob). The headline reveal is
// the COMPOUNDED HOLD the book takes on the parlay — far larger than on a single
// bet. When 2+ legs share a game_tag the independence product is NOT valid;
// the backend returns a verbatim correlation_warning and we surface it without
// inventing any correlation-adjusted number. Verification framing only.
export type ParlayLegBody = {
  american: number;            // required, != 0
  opposite_american?: number | null;
  fair_prob?: number | null;   // in (0,1) if supplied
  game_tag?: string | null;
  label?: string | null;
};

export type ParlayEvBody = {
  legs: ParlayLegBody[];       // >= 2
  offered_american: number;    // != 0
  stake?: number;              // default 1.0
};

export type ParlayLegResult = {
  label: string | null;
  american: number;
  opposite_american: number | null;
  game_tag: string | null;
  fair_prob: number;
  prob_source: "supplied" | "devig" | "raw_implied";
  vig_loaded: boolean;
  leg_hold_pct: number | null;
  fair_american: number | null;
};

export type ParlayCorrelatedGroup = {
  game_tag: string;
  leg_count: number;
  leg_indices: number[];
};

export type ParlayEv = {
  n_legs: number;
  legs: ParlayLegResult[];
  fair_parlay_prob: number;
  fair_parlay_decimal: number;
  fair_parlay_american: number | null;
  offered_american: number;
  offered_decimal: number;
  offered_implied_parlay_prob: number;
  parlay_hold_pct: number;          // headline; offered_implied / fair_prob − 1, %
  parlay_hold_pct_raw: number;      // unclamped, may be negative on a boosted/stale offer
  book_compounded_hold_pct: number | null; // structural Π(booksum_i)−1, %; null if any leg one-sided
  single_leg_hold_avg_pct: number | null;
  ev_units: number;
  ev_pct: number;
  stake: number;
  breakeven_prob: number;
  edge_vs_breakeven: number;
  verdict: "+EV" | "marginal" | "-EV";
  verdict_caveat: string | null;
  fair_basis: "independence";
  any_vig_loaded: boolean;
  correlated: boolean;
  correlated_groups: ParlayCorrelatedGroup[];
  correlation_warning: string | null;
};

// ── /tools/bankroll — stateless Kelly stake / risk-of-ruin calculator ────────
// Given a bankroll, a bet's american odds, and a VIG-FREE fair win prob (seed
// from the model's p_shrunk), computes the full-Kelly fraction, a recommended
// stake at a chosen fractional-Kelly multiplier, expected log-growth, an honest
// risk-of-drawdown estimate, and an edge-sensitivity table. Risk-of-ruin and
// growth are SENSITIVE to the edge assumption — the model edge is ESTIMATED, not
// known. The caveat strings encode that honesty; surface them verbatim. Never a
// pick — verification framing only.
export type BankrollDrawdownRow = {
  floor: number;   // bankroll fraction, in (0,1)
  prob: number;    // probability of touching that floor; [1e-4, 1.0], never 0
};

export type BankrollMultiplierRow = {
  label: "quarter" | "half" | "full" | string;
  multiplier: number;
  fraction: number;            // m * f_full
  stake_currency: number;
  stake_units: number;
  growth_rate: number;
  doubling_bets: number | null;
};

export type BankrollSensitivityRow = {
  delta: number;               // how much lower the true edge might be (>= 0)
  true_prob: number;           // fair_prob - delta
  full_kelly_at_true_p: number;
  ev_per_dollar: number;
  growth_rate: number;
  exceeds_full_kelly: boolean; // chosen stake over-bets this lower-edge truth
  drawdown: BankrollDrawdownRow[];
};

export type BankrollRiskBody = {
  bankroll: number;                        // > 0
  american_odds: number;                   // != 0
  fair_prob: number;                       // VIG-FREE fair win prob in (0,1)
  kelly_multiplier?: number;               // in (0,1], default 0.5
  unit_size?: number | null;               // default bankroll * 0.01
  drawdown_floors?: number[] | null;       // each in (0,1), default [0.5, 0.25, 0.10]
  edge_sensitivity_deltas?: number[] | null; // each >= 0, default [0.0, 0.02, 0.04]
};

export type BankrollRisk = {
  bankroll: number;
  american_odds: number;
  decimal_odds: number;
  fair_prob: number;
  kelly_multiplier: number;
  unit_size: number;
  kelly_full: number;          // unclamped full Kelly f*
  kelly_used_fraction: number; // m * f_full, 0.0 when clamped
  stake_currency: number;
  stake_units: number;
  ev_per_dollar: number;
  ev_on_stake: number;
  growth_rate: number;         // g at f_used
  doubling_bets: number | null; // ln2 / g, null if g <= 0
  no_bet: boolean;             // true when f_full <= 0
  verdict:
    | "no bet / -EV"
    | "+EV (small edge)"
    | "+EV (moderate)"
    | "+EV (large — full-Kelly stake is high; fractional strongly advised)"
    | string;
  multiplier_table: BankrollMultiplierRow[]; // [] when no_bet
  drawdown: BankrollDrawdownRow[];           // [] when no_bet
  edge_sensitivity: BankrollSensitivityRow[]; // [] when no_bet
  caveats: string[];                         // honesty strings, render verbatim
};

/** Live monitoring alert payload — surfaced on slate cards / detail panel.
 *  Verification language only; never a "pick". */
export type LiveAlertPayload = {
  kind: string;
  severity: string;
  side: "HOME" | "AWAY";
  headline: string;
  detail: string;
  label: string;
  pregame_tier: string;
  pregame_lean: string;
  pregame_win_prob: number;
  bullpen_vuln: number;
};

/** Live in-game state for a single game (monitoring only). */
export type LiveState = {
  game_id: number;
  status: string;
  is_live: boolean;
  captured_at: string | null;
  stale: boolean;
  inning: number | null;
  inning_half: "top" | "bottom" | null;
  outs: number | null;
  bases: { first: boolean; second: boolean; third: boolean } | null;
  home_score: number | null;
  away_score: number | null;
  current_pitcher: {
    id: number | null;
    name: string | null;
    team_id: number | null;
    pitch_count: number | null;
  } | null;
  alert: LiveAlertPayload | null;
};

// ── Model edge (+EV) — model vig-free prob MINUS book Shin no-vig prob ───────
// The purest edge signal: where the model's true-price estimate disagrees with
// the no-vig market, for the model's lean side. Positive = model thinks the
// fair price is better than the de-vigged market = genuine edge (independent of
// vig and of the tier heuristic; realized edge shows up as CLV). VERIFICATION,
// NOT a guaranteed-winners list. All fields additive — older payloads omit it.
//
// model_edge.<mkt> is null (render an honest "no market" cell, excluded from
// ranking — never a fabricated 0 edge) when that market has no two-sided
// same-book price (live_odds.<mkt>.fair == null) or, for a PASS total, when the
// total line is null. model_edge itself is null only when the game has no
// analysis at all.
export type ModelEdge = {
  side: "home" | "away" | "over" | "under";   // the lean, or model-implied side on PASS
  line?: number | null;                        // total only: the total line
  tier: string;                                // 'STRONG LEAN' | 'LEAN' | 'PASS'
  actionable: boolean;                         // false when no directional lean (PASS/model-implied side)
  model_prob: number;                          // leaned-side vig-free model prob (q_p_shrunk / qt_p_shrunk), 0..1
  novig_prob: number;                          // leaned-side Shin no-vig market prob, 0..1
  edge: number;                                // model_prob - novig_prob, signed, 4dp
  hold_pct: number | null;                     // book overround from live_odds.<mkt>.fair; null when no fair block
  movement_agreement: "toward" | "away" | "neutral" | null; // from live_odds.<mkt>.movement
};

export type ModelEdgeBundle = {
  moneyline: ModelEdge | null;
  total: ModelEdge | null;
};

/** Returned by /games/slate — one entry per game, everything bundled. */
export type SlateGame = {
  game_id: number;
  game_date: string;
  status: string;
  venue: string;
  home_team_id: number;
  home_team_abbr: string;
  away_team_id: number;
  away_team_abbr: string;
  home_probable_starter_id: number | null;
  away_probable_starter_id: number | null;
  home_score: number | null;
  away_score: number | null;
  home_bullpen: BullpenData | null;
  away_bullpen: BullpenData | null;
  analysis: GameAnalysis | null;
  live_odds: LiveOdds | null;
  live?: LiveState | null;
  // First-pitch time (UTC, ISO8601). Additive — older payloads may omit it.
  game_time_utc?: string | null;
  // Per-market +EV edge (model vig-free prob − book no-vig prob). Additive;
  // null only when the game has no analysis at all. See ModelEdge above.
  model_edge?: ModelEdgeBundle | null;
};

export type CalibrationBucket = {
  midpoint: number;
  n: number;
  actual_win_rate: number | null;
};

export type TierHitRate = {
  tier: string;
  n: number;
  hit_rate: number | null;
};

export type BacktestResult = {
  start_date: string;
  end_date: string;
  n: number;
  brier_score: number | null;
  calibration: CalibrationBucket[];
  tier_hit_rates: TierHitRate[];
  flat_pnl: number[];
  kelly_pnl: number[];
  kelly_bankroll: number[];
  flat_pnl_total: number;
  kelly_pnl_total: number;
  game_ids: number[];
};

// ── Track record (live-tracked picks, not a replay) ─────────────────────────
export type TrackRecordSummarySlice = {
  n: number;
  settled: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  units_wagered: number;
  units_net: number;
  roi: number | null;
  win_rate: number | null;
  win_rate_ci_low: number | null;
  win_rate_ci_high: number | null;
};

export type TrackRecordTier = {
  tier: string;
  n: number;
  settled: number;
  wins: number;
  win_rate: number | null;
  win_rate_ci_low: number | null;
  win_rate_ci_high: number | null;
};

export type TrackRecordPnlPoint = {
  bet_id: number;
  game_date: string;
  cum_units: number;
};

export type TrackRecordCalibrationBucket = {
  midpoint: number;
  n: number;
  actual_win_rate: number | null;
};

export type TrackRecordEdgeRealization = {
  n: number;
  mean_model_prob: number | null;
  actual_win_rate: number | null;
  mean_predicted_edge: number | null;
  realized_outperformance: number | null;
};

export type TrackRecordSnapshotCoverage = {
  source: string;       // "live" | "replay-YYYY-MM-DD" | "replay-YYYY-MM-DD-no-odds" | "null"
  n: number;
};

// ── CLV (closing-line value) aggregates ─────────────────────────────────────
// The sharpest available evidence of genuine edge: did the model's pick price
// beat the market's closing price? All percentages are prob-points (closing
// vig-free implied prob − price-taken vig-free implied prob).
export type TrackRecordClvCoverage = {
  n_settled: number;
  n_with_clv: number;
  n_no_close_captured: number;
  n_one_sided: number;
  n_total_line_mismatch: number;
  coverage_pct: number | null;
};

export type TrackRecordClvTierSlice = {
  tier: "STRONG LEAN" | "LEAN" | string;
  n_eligible: number;
  pct_beat_close: number | null;
  avg_clv_pct: number | null;
  ci_low: number | null;
  ci_high: number | null;
};

export type TrackRecordClvMarketSlice = {
  market: "moneyline" | "total" | string;
  n_eligible: number;
  pct_beat_close: number | null;
  avg_clv_pct: number | null;
  ci_low: number | null;
  ci_high: number | null;
};

export type TrackRecordClvVsResult = {
  beat_and_won: number;
  beat_and_lost: number;
  missed_and_won: number;
  missed_and_lost: number;
};

export type TrackRecordClv = {
  clv_coverage: TrackRecordClvCoverage;
  pct_beat_close: number | null;
  beat_close_n: number;
  n_eligible: number;
  pct_beat_close_ci_low: number | null;
  pct_beat_close_ci_high: number | null;
  avg_clv_pct: number | null;
  median_clv_pct: number | null;
  avg_price_clv: number | null;
  clv_by_tier: TrackRecordClvTierSlice[];
  clv_by_market: TrackRecordClvMarketSlice[];
  clv_vs_result: TrackRecordClvVsResult;
};

export type TrackRecordResult = {
  start: string | null;
  end: string | null;
  summary: {
    combined: TrackRecordSummarySlice;
    ml: TrackRecordSummarySlice;
    total: TrackRecordSummarySlice;
  };
  tier_hit_rates: TrackRecordTier[];
  pnl_curve: TrackRecordPnlPoint[];
  calibration: TrackRecordCalibrationBucket[];
  brier_score: number | null;
  edge_realization: TrackRecordEdgeRealization;
  snapshot_coverage: TrackRecordSnapshotCoverage[];
  // Additive — older payloads may omit this entirely.
  clv?: TrackRecordClv | null;
};

export const api = {
  games: (date: string) => get<Game[]>(`/games?game_date=${date}`),
  slate: (date: string) => get<SlateGame[]>(`/games/slate?game_date=${date}`),
  bundle: (gameId: number, asOf: string) => get<GameBundle>(`/games/${gameId}/bundle?as_of=${asOf}`),
  // Live in-game state is polled on a short interval — never cache it.
  live: (gameId: number) => get<LiveState>(`/games/${gameId}/live`, TTL_NONE),
  weather: (gameId: number) => get<WeatherData>(`/games/${gameId}/weather`),
  odds: (gameId: number) => get<unknown[]>(`/games/${gameId}/odds`),
  bullpen: (teamId: number, date: string) =>
    get<BullpenData>(`/teams/${teamId}/bullpen?as_of=${date}`),
  pitcher: (id: number, asOf: string) => get<PitcherForm>(`/pitchers/${id}/form?as_of=${asOf}`),
  polishReport: (markdown: string) =>
    post<{ markdown: string; polished: boolean; method: "sdk" | "cli" | "none" }>("/report/polish", { markdown }),
  analyze: (gameId: number, asOf: string) =>
    get<GameAnalysis>(`/games/${gameId}/analyze?as_of=${asOf}`),
  picks: (date: string) =>
    get<GameAnalysis[]>(`/games/picks?game_date=${date}`),
  batting: (teamId: number, date: string) =>
    get<TeamBatting>(`/teams/${teamId}/batting?as_of=${date}&window=l10`),
  context: (gameId: number, asOf: string) =>
    get<GameContext>(`/games/${gameId}/context?as_of=${asOf}`),
  reportMarkdown: async (date: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API}/report?date=${date}`);
      if (!res.ok) return null;
      return res.text();
    } catch {
      return null;
    }
  },
  quantVerify: (modelProb: number, sideOdds: number, otherOdds: number, evidence: number) =>
    get<QuantVerify>(
      `/quant/verify?model_prob=${modelProb}&side_odds=${sideOdds}&other_odds=${otherOdds}&evidence_quality=${evidence}`,
    ),
  // ── Beat-the-Book pricing layer ────────────────────────────────────────────
  // Per-market fair (no-vig) value + book hold for a single game.
  fairValue: (gameId: number) => get<FairValueResult>(`/games/${gameId}/fair-value`),
  // Stateless profit-boost EV check. odds != 0, boostPct >= 0, fairProb in (0,1).
  boostEv: (odds: number, boostPct: number, fairProb: number) =>
    post<BoostEv>("/tools/boost-ev", {
      american_odds: odds,
      boost_pct: boostPct,
      fair_prob: fairProb,
    }),
  // Stateless parlay / SGP checker. >=2 legs (each american != 0); offered != 0.
  // Returns the compounded book hold + independence-basis EV. Never a pick.
  parlayEv: (params: ParlayEvBody) => post<ParlayEv>("/tools/parlay-ev", params),
  // Stateless Kelly stake / risk-of-ruin calculator. bankroll > 0, american != 0,
  // fair_prob (vig-free) in (0,1). Returns recommended fractional-Kelly stake,
  // log-growth, an honest risk-of-drawdown estimate + edge-sensitivity. Never a pick.
  bankroll: (params: BankrollRiskBody) => post<BankrollRisk>("/tools/bankroll", params),
  // ── Tracker ──────────────────────────────────────────────────────────────
  trackerBets: (params?: { date_from?: string; date_to?: string; market?: string; game_date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.game_date) qs.set("game_date", params.game_date);
    if (params?.date_from) qs.set("date_from", params.date_from);
    if (params?.date_to) qs.set("date_to", params.date_to);
    if (params?.market) qs.set("market", params.market);
    const q = qs.toString();
    return get<BetRecord[]>(`/tracker/bets${q ? "?" + q : ""}`, TTL_TRACKER);
  },
  trackerCreateBet: (payload: BetCreatePayload) =>
    post<BetRecord>("/tracker/bets", payload, TRACKER_BUST),
  trackerSettleBet: (id: number, result: "WIN" | "LOSS" | "PUSH", units_returned?: number) =>
    patch<BetRecord>(`/tracker/bets/${id}`, { result, units_returned }, TRACKER_BUST),
  trackerDeleteBet: (id: number) => del(`/tracker/bets/${id}`, TRACKER_BUST),
  trackerSummary: (params?: { date_from?: string; date_to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.date_from) qs.set("date_from", params.date_from);
    if (params?.date_to) qs.set("date_to", params.date_to);
    const q = qs.toString();
    return get<TrackerSummary>(`/tracker/summary${q ? "?" + q : ""}`, TTL_TRACKER);
  },
  trackerAutoTrack: (date: string) =>
    post<{ created: number; skipped: number; date: string }>(
      `/tracker/auto-track?game_date=${date}`,
      {},
      TRACKER_BUST,
    ),
  trackerAutoSettle: (date: string) =>
    post<{ date: string; settled: number; skipped_not_final: number; skipped_no_score: number; bets: object[] }>(
      `/tracker/auto-settle?game_date=${date}`,
      {},
      TRACKER_BUST,
    ),
  adminRunIngestion: (date: string) =>
    post<{ job_id: string; as_of: string; status: string }>(
      `/admin/run-ingestion?game_date=${date}`,
      {},
      ["/admin/ingestion-jobs"],
    ),
  // Job status + job list are polled while a run is in flight — always fresh.
  adminIngestionStatus: (jobId: string, tail?: number) =>
    get<{
      job_id: string;
      status: string;
      started_at: string;
      as_of: string;
      error: string | null;
      log_lines_total: number;
      log_tail: string[];
    }>(`/admin/ingestion-status/${jobId}${tail ? `?tail=${tail}` : ""}`, TTL_NONE),
  adminIngestionJobs: () =>
    get<
      Array<{
        job_id: string;
        status: string;
        started_at: string;
        as_of: string;
        log_lines_total: number;
        error: string | null;
      }>
    >(`/admin/ingestion-jobs`, TTL_NONE),
  backtest: (start: string, end: string) =>
    get<BacktestResult>(`/backtest?start=${start}&end=${end}`),
  trackRecord: (start?: string, end?: string) => {
    const qs = new URLSearchParams();
    if (start) qs.set("start", start);
    if (end) qs.set("end", end);
    const q = qs.toString();
    return get<TrackRecordResult>(`/tracker/track-record${q ? "?" + q : ""}`, TTL_TRACKER);
  },
  chat: (message: string, date?: string) =>
    post<{ answer: string; intent: string; sources_count: number }>(
      "/chat",
      { message, date },
    ),
};

export type QuantVerify = {
  prop_vig_free: number;
  shin_vig_free: number;
  shin_z: number;
  booksum: number;
  p_model: number;
  p_shrunk: number;
  shrink_weight: number;
  edge_naive: number;
  edge_quant: number;
  edge_sd: number;
  prob_positive: number;
  ci_low: number;
  ci_high: number;
  effective_n: number;
  kelly_full: number;
  kelly_sized: number;
  kelly_multiplier: number;
  growth_rate: number;
  doubling_bets: number | null;
  ev_per_dollar: number;
  recommendation: string;
};

// ── Tracker types ──────────────────────────────────────────────────────────

export type BetRecord = {
  id: number;
  game_id: number;
  game_date: string;
  market: "moneyline" | "total";
  selection: string;
  american_odds: number;
  units: number;
  result: "WIN" | "LOSS" | "PUSH" | null;
  units_returned: number | null;
  tier: string;
  home_team_abbr: string;
  away_team_abbr: string;
  total_line: number | null;
  projected_total: number | null;
  created_at: string | null;
  game_time_utc: string | null;
  game_status: string | null;
  // ── Closing-line value (CLV) — additive, may be absent on older payloads ──
  // The closing line is the last pre-first-pitch market snapshot for the
  // picked side. When no honest close exists, every field is null and
  // clv_source explains why; the UI must render "no close captured" — never a
  // fabricated number.
  closing_odds?: number | null;          // american odds of picked-side close
  closing_line?: number | null;          // total line; null for moneyline
  closing_implied_prob?: number | null;  // Shin vig-free closing prob, 4dp
  clv_pct?: number | null;               // closing_implied_prob − market_implied_prob; + = beat close
  beat_close?: boolean | null;
  clv_source?:
    | "live"
    | "no_close_captured"
    | "no_first_pitch"
    | "one_sided_close"
    | "total-line-mismatch"
    | "no_pick_anchor"
    | string                              // backfill-YYYY-MM-DD
    | null;
  closing_captured_at?: string | null;   // ISO8601
};

export type BetCreatePayload = {
  game_id: number;
  game_date: string;
  market: "moneyline" | "total";
  selection: string;
  american_odds: number;
  units?: number;
  tier: string;
  home_team_abbr: string;
  away_team_abbr: string;
  total_line?: number | null;
  projected_total?: number | null;
};

export type TrackerSummaryGroup = {
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  units_wagered: number;
  units_net: number;
};

export type TrackerSummary = {
  ml: TrackerSummaryGroup;
  total: TrackerSummaryGroup;
  combined: TrackerSummaryGroup;
};
