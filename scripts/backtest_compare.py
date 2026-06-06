"""Honest before/after backtest: raw model vs Platt-calibrated.

Chronological split (no leakage, no circularity): fit the Platt map on the
TRAIN window, evaluate raw vs calibrated on the HOLDOUT window only. Replays
leak-free (as_of = game_date - 1) with DM_CALIBRATION=off so we get the RAW home
prob, then apply the train-fitted Platt externally for the calibrated variant.

Reports on the holdout:
  * Brier raw vs calibrated (calibration quality)
  * ML betting vs Shin-devigged market at edge thresholds: n, win%, ROI
  * heavy-favorite bucket (odds <= -150) — the bleed we are trying to kill

Honest framing: calibration is expected to LOWER Brier, CUT volume, and shrink
the heavy-fav bucket. It is NOT expected to manufacture ROI edge. ROI is shown
vs the implicit 0% (break-even-after-vig) bar; sustained >0 across the split
would indicate edge, which we do not expect from calibration alone.

Usage:
    .venv/bin/python scripts/backtest_compare.py
    .venv/bin/python scripts/backtest_compare.py --train-frac 0.6
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import timedelta

os.environ.setdefault("DM_CALIBRATION", "off")  # replay RAW; calibrate externally
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.games import Game  # noqa: E402
from app.models.entities import Team  # noqa: E402
from app.models.odds import OddsSnapshotRow  # noqa: E402
from app.betting.quant import shin_probabilities  # noqa: E402
from app.betting.calibration import fit_platt, apply_platt  # noqa: E402
from app.betting.clv import _norm_abbr, _resolve_to_abbr, _to_utc  # noqa: E402


def _payout(a: int) -> float:
    return a / 100.0 if a > 0 else 100.0 / abs(a)


def _brier(p, y) -> float:
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def _pre_pitch_ml(db, g, hn, an):
    start = _to_utc(g.game_time_utc)
    rows = db.execute(select(OddsSnapshotRow).where(
        OddsSnapshotRow.game_id == g.id,
        OddsSnapshotRow.market.in_(("moneyline", "h2h")),
    )).scalars().all()
    ho = ao = None
    ht = at = None
    for r in rows:
        if not isinstance(r.american_odds, int) or r.american_odds == 0:
            continue
        cap = _to_utc(r.captured_at)
        if start and cap and cap >= start:
            continue
        ab = _norm_abbr(_resolve_to_abbr(r.selection))
        if ab == hn and (ht is None or (cap and cap > ht)):
            ho, ht = r.american_odds, cap
        elif ab == an and (at is None or (cap and cap > at)):
            ao, at = r.american_odds, cap
    return ho, ao


def _ml_sweep(rows, thresholds):
    """rows: (p_home, mph, mpa, ho, ao, home_won). Bet best positive-edge side."""
    out = []
    for thr in thresholds:
        n = w = 0
        u = 0.0
        for ph, mph, mpa, ho, ao, hw in rows:
            eh, ea = ph - mph, (1 - ph) - mpa
            if eh >= ea:
                edge, home, odds = eh, True, ho
            else:
                edge, home, odds = ea, False, ao
            if edge < thr:
                continue
            n += 1
            won = (hw == 1) if home else (hw == 0)
            if won:
                w += 1
                u += _payout(odds)
            else:
                u -= 1.0
        out.append({"thr": thr, "n": n, "win": (w / n if n else 0), "u": u, "roi": (u / n if n else 0)})
    return out


def _print_sweep(title, rows):
    print(f"\n{title}")
    print(f"  {'min_edge':>8}{'n':>5}{'win%':>7}{'units':>9}{'roi':>8}")
    for s in rows:
        print(f"  {s['thr']:>8.2f}{s['n']:>5}{s['win']:>7.0%}{s['u']:>+9.2f}u{s['roi']:>+8.0%}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-frac", type=float, default=0.6)
    args = ap.parse_args()

    from app.betting.analysis_builder import build_game_analysis

    db = SessionLocal()
    try:
        games = list(db.execute(select(Game).where(
            Game.home_score.is_not(None), Game.away_score.is_not(None)
        ).order_by(Game.game_date.asc(), Game.id.asc())).scalars())

        split = int(len(games) * args.train_frac)
        train_games, holdout_games = games[:split], games[split:]
        print(f"{len(games)} games | train {len(train_games)} "
              f"({train_games[0].game_date}..{train_games[-1].game_date}) | "
              f"holdout {len(holdout_games)} "
              f"({holdout_games[0].game_date}..{holdout_games[-1].game_date})")

        # ── Fit Platt on TRAIN (all completed games — calibration label set) ──
        tr_p, tr_y = [], []
        for g in train_games:
            a = build_game_analysis(g.id, g.game_date - timedelta(days=1), db)
            if a is None:
                continue
            tr_p.append(float(a.model_home_win_prob))
            tr_y.append(1.0 if g.home_score > g.away_score else 0.0)
        a_pl, b_pl = fit_platt(np.array(tr_p), np.array(tr_y))
        print(f"Train Platt: a={a_pl:.4f} b={b_pl:.4f}  (n={len(tr_p)})")

        # ── Evaluate HOLDOUT ──────────────────────────────────────────────────
        ho_raw_p, ho_cal_p, ho_y = [], [], []
        ml_rows_raw, ml_rows_cal = [], []
        heavy_raw = [0, 0]   # n, wins on odds<=-150 (raw, edge>=0.04)
        for g in holdout_games:
            a = build_game_analysis(g.id, g.game_date - timedelta(days=1), db)
            if a is None:
                continue
            raw = float(a.model_home_win_prob)
            cal = apply_platt(raw, a_pl, b_pl)
            hw = 1 if g.home_score > g.away_score else 0
            ho_raw_p.append(raw); ho_cal_p.append(cal); ho_y.append(hw)

            home = db.get(Team, g.home_team_id)
            away = db.get(Team, g.away_team_id)
            if not home or not away:
                continue
            ho, ao = _pre_pitch_ml(db, g, _norm_abbr(home.abbr), _norm_abbr(away.abbr))
            if ho is None or ao is None:
                continue
            mph, mpa, _z, _b = shin_probabilities(ho, ao)
            ml_rows_raw.append((raw, mph, mpa, ho, ao, hw))
            ml_rows_cal.append((cal, mph, mpa, ho, ao, hw))
            # heavy-fav bucket (raw lean side odds <= -150, edge>=0.04)
            eh, ea = raw - mph, (1 - raw) - mpa
            if eh >= ea:
                edge, odds, won = eh, ho, (hw == 1)
            else:
                edge, odds, won = ea, ao, (hw == 0)
            if edge >= 0.04 and odds <= -150:
                heavy_raw[0] += 1
                heavy_raw[1] += 1 if won else 0

        print(f"\nHoldout Brier:  raw={_brier(ho_raw_p, ho_y):.4f}  "
              f"calibrated={_brier(ho_cal_p, ho_y):.4f}  "
              f"base_rate={_brier([np.mean(ho_y)]*len(ho_y), ho_y):.4f}")
        print(f"Holdout games with ML odds: {len(ml_rows_raw)}")

        thresholds = [0.0, 0.02, 0.04, 0.06, 0.08]
        _print_sweep("RAW model — holdout ML vs market:", _ml_sweep(ml_rows_raw, thresholds))
        _print_sweep("CALIBRATED — holdout ML vs market:", _ml_sweep(ml_rows_cal, thresholds))

        hn, hw_ = heavy_raw
        print(f"\nHeavy-fav bucket (raw, odds<=-150, edge>=0.04): "
              f"{hn} bets, win {hw_/hn if hn else 0:.0%}  "
              f"-- calibration shrinks these toward 0.5 so far fewer clear the edge bar.")
        print("\nHonest read: lower Brier + fewer bets = more honest model. "
              "ROI is NOT expected to turn edge-positive from calibration alone.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
