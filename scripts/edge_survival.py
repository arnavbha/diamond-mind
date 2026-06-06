"""Edge-survival check (Phase 1 follow-up).

Question: after removing lookahead AND applying the Platt calibration map, does
ANY profitable ML slice survive vs the market?

Method (all leak-free, read-only, no DB writes):
  1. Replay every completed game at as_of = game_date - 1.
  2. cal_p_home = platt(model_home_win_prob) using configs/calibration.json.
  3. Pull the latest PRE-FIRST-PITCH h2h odds (home + away), Shin-devig to a
     vig-free market prob per side.
  4. edge_side = cal_p_side - market_p_side. Bet the side with the larger
     positive edge if it clears the threshold.
  5. Sweep thresholds; report n_bets, win%, ROI, units (flat 1u) for BOTH the
     RAW model prob and the CALIBRATED prob, so we can see what calibration does.

If even the best threshold yields negative/zero ROI on a non-trivial n, the ML
model has no edge to optimize and Bayesian search is premature.

Usage:
    .venv/bin/python scripts/edge_survival.py
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.games import Game  # noqa: E402
from app.models.odds import OddsSnapshotRow  # noqa: E402
from app.betting.quant import shin_probabilities  # noqa: E402
from app.betting.clv import _norm_abbr, _resolve_to_abbr, _to_utc  # noqa: E402

_EPS = 1e-6


def _logit(p):
    p = min(max(p, _EPS), 1 - _EPS)
    return np.log(p / (1 - p))


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def apply_platt(p, a, b):
    return float(_sigmoid(a * _logit(p) + b))


def _payout(american: int) -> float:
    if american > 0:
        return american / 100.0
    if american < 0:
        return 100.0 / abs(american)
    return 1.0


def _pre_pitch_h2h(db, game, home_abbr, away_abbr):
    """Latest pre-first-pitch h2h american odds for (home, away). None if missing."""
    start = _to_utc(game.game_time_utc)
    rows = db.execute(
        select(OddsSnapshotRow).where(
            OddsSnapshotRow.game_id == game.id,
            OddsSnapshotRow.market.in_(("moneyline", "h2h")),
        )
    ).scalars().all()
    hn, an = _norm_abbr(home_abbr), _norm_abbr(away_abbr)
    home_o = away_o = None
    home_t = away_t = None
    for r in rows:
        if not isinstance(r.american_odds, int) or r.american_odds == 0:
            continue
        cap = _to_utc(r.captured_at)
        if start is not None and cap is not None and cap >= start:
            continue  # strictly pre-pitch
        abbr = _norm_abbr(_resolve_to_abbr(r.selection))
        if abbr == hn and (home_t is None or (cap and cap > home_t)):
            home_o, home_t = r.american_odds, cap
        elif abbr == an and (away_t is None or (cap and cap > away_t)):
            away_o, away_t = r.american_odds, cap
    return home_o, away_o


def _sweep(rows, use_calibrated, thresholds):
    """rows: list of (cal_p_home, raw_p_home, mkt_p_home, mkt_p_away,
    home_odds, away_odds, home_won). Returns per-threshold stats."""
    out = []
    for thr in thresholds:
        n = w = 0
        units = 0.0
        for cal_h, raw_h, mph, mpa, ho, ao, hw in rows:
            p_home = cal_h if use_calibrated else raw_h
            edge_home = p_home - mph
            edge_away = (1 - p_home) - mpa
            if edge_home >= edge_away:
                side_edge, bet_home, odds = edge_home, True, ho
            else:
                side_edge, bet_home, odds = edge_away, False, ao
            if side_edge < thr:
                continue
            n += 1
            won = (hw == 1) if bet_home else (hw == 0)
            if won:
                w += 1
                units += _payout(odds)
            else:
                units -= 1.0
        roi = (units / n) if n else 0.0
        wr = (w / n) if n else 0.0
        out.append({"thr": thr, "n": n, "win%": wr, "units": units, "roi": roi})
    return out


def _print(title, stats):
    print(f"\n{title}")
    print(f"  {'min_edge':>8} {'n':>5} {'win%':>6} {'units':>9} {'roi':>8}")
    for s in stats:
        print(f"  {s['thr']:>8.2f} {s['n']:>5} {s['win%']:>6.1%} {s['units']:>+9.2f}u {s['roi']:>+8.1%}")


def main() -> None:
    from app.betting.analysis_builder import build_game_analysis

    cfg = json.load(open("configs/calibration.json"))
    a_pl = cfg["moneyline"]["platt"]["a"]
    b_pl = cfg["moneyline"]["platt"]["b"]
    print(f"Platt map: a={a_pl} b={b_pl}")

    db = SessionLocal()
    try:
        games = list(db.execute(
            select(Game).where(
                Game.home_score.is_not(None), Game.away_score.is_not(None)
            ).order_by(Game.game_date.asc(), Game.id.asc())
        ).scalars())

        from app.models.entities import Team
        rows = []
        no_odds = 0
        for g in games:
            a = build_game_analysis(g.id, g.game_date - timedelta(days=1), db)
            if a is None:
                continue
            home = db.get(Team, g.home_team_id)
            away = db.get(Team, g.away_team_id)
            if not home or not away:
                continue
            ho, ao = _pre_pitch_h2h(db, g, home.abbr, away.abbr)
            if ho is None or ao is None:
                no_odds += 1
                continue
            mph, mpa, _z, _b = shin_probabilities(ho, ao)
            raw_h = float(a.model_home_win_prob)
            cal_h = apply_platt(raw_h, a_pl, b_pl)
            home_won = 1 if g.home_score > g.away_score else 0
            rows.append((cal_h, raw_h, mph, mpa, ho, ao, home_won))

        print(f"\nGames with leak-free analysis + pre-pitch h2h odds: {len(rows)}"
              f"  (skipped {no_odds} missing odds)")
        if not rows:
            print("No games with usable odds — cannot assess edge.")
            return

        thresholds = [0.0, 0.02, 0.04, 0.06, 0.08, 0.10]
        _print("RAW model edge vs market:", _sweep(rows, False, thresholds))
        _print("CALIBRATED (Platt) edge vs market:", _sweep(rows, True, thresholds))

        # Closing-line-style sanity: mean market vig-free home prob vs actual
        mph_arr = np.array([r[2] for r in rows])
        hw_arr = np.array([r[6] for r in rows])
        print(f"\nMarket calibration check: mean mkt P(home)={mph_arr.mean():.3f} "
              f"actual home win={hw_arr.mean():.3f}  (market should track actual)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
