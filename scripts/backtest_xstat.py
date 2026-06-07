"""B3 GO/NO-GO gate: does the xStat variant beat the base model AND the market?

Replays every completed game leak-free (as_of = game_date - 1) under BOTH model
variants (base FIP vs xStat expected-FIP), with calibration off (testing raw
model signal). Reports, on a chronological holdout:
  * Brier vs base-rate — does xStat predict better?
  * Walk-forward monthly beat-market ROI at edge>=0.04 — does it beat the line,
    stably across months (not one hot month)?

Decision rule (honest, pre-registered):
  PASS  -> xStat beats base on Brier AND shows >=+2% ROI vs market in BOTH
           months (stable). Then continue B4.
  FAIL  -> otherwise. xStat doesn't rescue the model; reposition the product.

Usage: .venv/bin/python scripts/backtest_xstat.py
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import timedelta

os.environ["DM_CALIBRATION"] = "off"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.games import Game  # noqa: E402
from app.models.entities import Team  # noqa: E402
from app.models.odds import OddsSnapshotRow  # noqa: E402
from app.betting.quant import shin_probabilities  # noqa: E402
from app.betting.clv import _norm_abbr, _resolve_to_abbr, _to_utc  # noqa: E402


def _payout(a):
    return a / 100.0 if a > 0 else 100.0 / abs(a)


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


def replay_variant(db, games, variant: str):
    """Return per-game rows: (game_date, p_home, mph, mpa, ho, ao, home_won)."""
    os.environ["DM_MODEL_VARIANT"] = variant
    from app.betting.analysis_builder import build_game_analysis

    rows = []
    for g in games:
        a = build_game_analysis(g.id, g.game_date - timedelta(days=1), db)
        if a is None:
            continue
        home = db.get(Team, g.home_team_id)
        away = db.get(Team, g.away_team_id)
        if not home or not away:
            continue
        ho, ao = _pre_pitch_ml(db, g, _norm_abbr(home.abbr), _norm_abbr(away.abbr))
        if ho is None or ao is None:
            continue
        mph, mpa, _z, _b = shin_probabilities(ho, ao)
        rows.append((g.game_date, float(a.model_home_win_prob), mph, mpa, ho, ao,
                     1 if g.home_score > g.away_score else 0))
    return rows


def brier(rows):
    p = np.array([r[1] for r in rows]); y = np.array([r[6] for r in rows])
    base = np.full(len(y), y.mean())
    return float(np.mean((p - y) ** 2)), float(np.mean((base - y) ** 2)), len(rows)


def monthly_beat_market(rows, thr=0.04):
    mon = defaultdict(lambda: [0, 0, 0.0])
    for d, ph, mph, mpa, ho, ao, hw in rows:
        eh, ea = ph - mph, (1 - ph) - mpa
        if eh >= ea:
            edge, home, odds = eh, True, ho
        else:
            edge, home, odds = ea, False, ao
        if edge < thr:
            continue
        m = d.strftime("%Y-%m")
        won = (hw == 1) if home else (hw == 0)
        mon[m][0] += 1; mon[m][1] += 1 if won else 0
        mon[m][2] += _payout(odds) if won else -1.0
    return mon


def main():
    db = SessionLocal()
    try:
        games = list(db.execute(select(Game).where(
            Game.home_score.is_not(None), Game.away_score.is_not(None)
        ).order_by(Game.game_date.asc(), Game.id.asc())).scalars())

        for variant in ("off", "xstat"):
            rows = replay_variant(db, games, variant)
            br, base_br, n = brier(rows)
            print(f"\n=== variant={variant} ===")
            print(f"  Brier model={br:.4f}  base_rate={base_br:.4f}  "
                  f"{'BEATS base' if br < base_br else 'WORSE than base'}  (n={n} w/ odds)")
            mon = monthly_beat_market(rows)
            print(f"  beat-market @edge>=0.04 by month:")
            tot = [0, 0, 0.0]
            for m in sorted(mon):
                nn, w, u = mon[m]; tot[0]+=nn; tot[1]+=w; tot[2]+=u
                print(f"    {m}  n={nn:>3} win={w/nn if nn else 0:>4.0%} {u:>+7.2f}u roi={u/nn if nn else 0:>+5.0%}")
            print(f"    TOTAL n={tot[0]} win={tot[1]/tot[0] if tot[0] else 0:.0%} "
                  f"{tot[2]:+.2f}u roi={tot[2]/tot[0] if tot[0] else 0:+.0%}")
        print("\nPASS = xstat beats base Brier AND >=+2% ROI vs market in BOTH months.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
