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
// HTTP helpers
// ---------------------------------------------------------------------------
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function patch<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function del(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

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

/** Latest market odds per game — refreshed by /admin/tick. */
export type LiveOdds = {
  moneyline: {
    home: number | null;
    away: number | null;
    bookmaker?: string | null;
    fair?: FairMoneyline | null;
  };
  total: {
    line: number;
    over: number | null;
    under: number | null;
    bookmaker: string;
    fair?: FairTotal | null;
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
  };
  total: {
    offered: { line: number | null; over: number | null; under: number | null } | null;
    bookmaker: string | null;
    fair: FairTotal | null;
    hold_pct: number | null;
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
  live: (gameId: number) => get<LiveState>(`/games/${gameId}/live`),
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
  // ── Tracker ──────────────────────────────────────────────────────────────
  trackerBets: (params?: { date_from?: string; date_to?: string; market?: string; game_date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.game_date) qs.set("game_date", params.game_date);
    if (params?.date_from) qs.set("date_from", params.date_from);
    if (params?.date_to) qs.set("date_to", params.date_to);
    if (params?.market) qs.set("market", params.market);
    const q = qs.toString();
    return get<BetRecord[]>(`/tracker/bets${q ? "?" + q : ""}`);
  },
  trackerCreateBet: (payload: BetCreatePayload) =>
    post<BetRecord>("/tracker/bets", payload),
  trackerSettleBet: (id: number, result: "WIN" | "LOSS" | "PUSH", units_returned?: number) =>
    patch<BetRecord>(`/tracker/bets/${id}`, { result, units_returned }),
  trackerDeleteBet: (id: number) => del(`/tracker/bets/${id}`),
  trackerSummary: (params?: { date_from?: string; date_to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.date_from) qs.set("date_from", params.date_from);
    if (params?.date_to) qs.set("date_to", params.date_to);
    const q = qs.toString();
    return get<TrackerSummary>(`/tracker/summary${q ? "?" + q : ""}`);
  },
  trackerAutoTrack: (date: string) =>
    post<{ created: number; skipped: number; date: string }>(
      `/tracker/auto-track?game_date=${date}`,
      {},
    ),
  trackerAutoSettle: (date: string) =>
    post<{ date: string; settled: number; skipped_not_final: number; skipped_no_score: number; bets: object[] }>(
      `/tracker/auto-settle?game_date=${date}`,
      {},
    ),
  adminRunIngestion: (date: string) =>
    post<{ job_id: string; as_of: string; status: string }>(
      `/admin/run-ingestion?game_date=${date}`,
      {},
    ),
  adminIngestionStatus: (jobId: string, tail?: number) =>
    get<{
      job_id: string;
      status: string;
      started_at: string;
      as_of: string;
      error: string | null;
      log_lines_total: number;
      log_tail: string[];
    }>(`/admin/ingestion-status/${jobId}${tail ? `?tail=${tail}` : ""}`),
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
    >(`/admin/ingestion-jobs`),
  backtest: (start: string, end: string) =>
    get<BacktestResult>(`/backtest?start=${start}&end=${end}`),
  trackRecord: (start?: string, end?: string) => {
    const qs = new URLSearchParams();
    if (start) qs.set("start", start);
    if (end) qs.set("end", end);
    const q = qs.toString();
    return get<TrackRecordResult>(`/tracker/track-record${q ? "?" + q : ""}`);
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
