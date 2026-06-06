"""Retrodictive slate replay: what would the TRACKER have shown under new rules?

Mirrors the auto-track pick engine over every completed game (leak-free,
as_of = game_date - 1) and grades the picks vs real outcomes. Runs 4 variants:

  baseline   : no calibration, no -150 ML cap   (old behaviour)
  +cap       : -150 ML cap only
  +calib     : Platt calibration only
  +both      : calibration + cap                 (current prod logic)

For each variant: per-market (ML / totals) n, win%, units, ROI, and combined.
Units replicate routes._kelly_units. ML/total odds are the latest PRE-PITCH
snapshot for the leaned side. Pushes dropped.

Honest framing: this is ONE outcome-draw of one sample. It shows whether the
new rules reduced harm on the games we actually saw -- not proof of edge.

Usage:
    .venv/bin/python scripts/replay_slate.py
"""
from __future__ import annotations

import math
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.games import Game  # noqa: E402
from app.models.entities import Team  # noqa: E402
from app.models.odds import OddsSnapshotRow  # noqa: E402
from app.betting.clv import _norm_abbr, _resolve_to_abbr, _to_utc  # noqa: E402

_ACTIONABLE = {"STRONG LEAN", "LEAN"}
_UNIT_SCALE = 0.5
_ML_MAX_JUICE = -150


def _kelly_units(kelly_sized: float) -> float:
    raw = kelly_sized * 100
    if raw < 0.25:
        return 0.0
    rounded = math.floor(raw * 2 + 0.5) / 2
    scaled = min(3.0, rounded) * _UNIT_SCALE
    return max(0.5, round(scaled * 2) / 2)


def _payout(a: int) -> float:
    return a / 100.0 if a > 0 else 100.0 / abs(a)


def _pre_pitch(db, g, market):
    """Return latest pre-pitch snapshots for a market as list of (selection,line,odds)."""
    start = _to_utc(g.game_time_utc)
    rows = db.execute(select(OddsSnapshotRow).where(
        OddsSnapshotRow.game_id == g.id,
        OddsSnapshotRow.market.in_((market, "h2h") if market == "moneyline" else (market,)),
    )).scalars().all()
    out = []
    for r in rows:
        if not isinstance(r.american_odds, int) or r.american_odds == 0:
            continue
        cap = _to_utc(r.captured_at)
        if start and cap and cap >= start:
            continue
        out.append((r.selection, r.line, r.american_odds, cap))
    return out


def _ml_odds(db, g, home_abbr, away_abbr, lean):
    hn, an = _norm_abbr(home_abbr), _norm_abbr(away_abbr)
    want = hn if lean == "HOME" else an
    best = None
    best_t = None
    for sel, _line, odds, cap in _pre_pitch(db, g, "moneyline"):
        if _norm_abbr(_resolve_to_abbr(sel)) == want and (best_t is None or (cap and cap > best_t)):
            best, best_t = odds, cap
    return best


def _total_odds(db, g, line, side):
    want = side.lower()  # 'over'/'under'
    best = None
    best_t = None
    for sel, ln, odds, cap in _pre_pitch(db, g, "total"):
        if (sel or "").lower() == want and ln is not None and abs(ln - line) < 1e-6 \
                and (best_t is None or (cap and cap > best_t)):
            best, best_t = odds, cap
    return best


def replay(db, games, calibration: bool, cap: bool):
    os.environ["DM_CALIBRATION"] = "on" if calibration else "off"
    from app.betting.analysis_builder import build_game_analysis

    ml = {"n": 0, "w": 0, "u": 0.0}
    tot = {"n": 0, "w": 0, "u": 0.0}
    for g in games:
        a = build_game_analysis(g.id, g.game_date - timedelta(days=1), db)
        if a is None:
            continue
        home = db.get(Team, g.home_team_id)
        away = db.get(Team, g.away_team_id)
        if not home or not away:
            continue
        home_won = g.home_score > g.away_score
        total_runs = g.home_score + g.away_score

        # ── Moneyline ──
        if a.ml_tier in _ACTIONABLE and a.ml_lean in ("HOME", "AWAY"):
            odds = _ml_odds(db, g, home.abbr, away.abbr, a.ml_lean)
            if odds is not None and not (cap and odds <= _ML_MAX_JUICE):
                units = _kelly_units(a.q_kelly_sized)
                if units > 0:
                    won = home_won if a.ml_lean == "HOME" else (not home_won)
                    ml["n"] += 1
                    if won:
                        ml["w"] += 1; ml["u"] += _payout(odds) * units
                    else:
                        ml["u"] -= units

        # ── Total ──
        if a.total_tier in _ACTIONABLE and a.total_lean in ("OVER", "UNDER") and a.total_line is not None:
            odds = _total_odds(db, g, a.total_line, a.total_lean)
            if odds is not None and total_runs != a.total_line:
                units = _kelly_units(a.qt_kelly_sized)
                if units > 0:
                    won = (total_runs > a.total_line) if a.total_lean == "OVER" else (total_runs < a.total_line)
                    tot["n"] += 1
                    if won:
                        tot["w"] += 1; tot["u"] += _payout(odds) * units
                    else:
                        tot["u"] -= units
    return ml, tot


def _fmt(label, ml, tot):
    cn = ml["n"] + tot["n"]
    cu = ml["u"] + tot["u"]
    cw = ml["w"] + tot["w"]

    def line(name, d):
        n, w, u = d["n"], d["w"], d["u"]
        wr = (w / n) if n else 0
        # ROI on units staked is approx; report units net + win% + units/bet
        return f"    {name:<10} n={n:>4}  win={wr:>4.0%}  net={u:>+8.2f}u"
    print(f"\n  {label}")
    print(line("ML", ml))
    print(line("Totals", tot))
    print(f"    {'COMBINED':<10} n={cn:>4}  win={(cw/cn if cn else 0):>4.0%}  net={cu:>+8.2f}u")


def main() -> None:
    db = SessionLocal()
    try:
        games = list(db.execute(select(Game).where(
            Game.home_score.is_not(None), Game.away_score.is_not(None)
        ).order_by(Game.game_date.asc(), Game.id.asc())).scalars())
        print(f"Replaying {len(games)} completed games (leak-free), grading vs outcomes.")
        print("Units = routes._kelly_units; pre-pitch odds; pushes dropped.")

        for label, calib, cap in [
            ("baseline (no calib, no cap)", False, False),
            ("+cap only (-150)", False, True),
            ("+calibration only", True, False),
            ("+both  = PROD", True, True),
        ]:
            ml, tot = replay(db, games, calib, cap)
            _fmt(label, ml, tot)
        print("\nOne sample, one outcome-draw. Shows harm reduction on THIS period, "
              "not proof of edge.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
