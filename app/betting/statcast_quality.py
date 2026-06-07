"""Statcast pitcher-quality windows + skill index (Path B, B2).

Computes an as_of-bounded xStat window for a pitcher by summing
StatcastPitcherGame rows with `game_date <= as_of` (leak-safe; the replay path
passes as_of = game_date - 1). Converts the window into a league-relative SKILL
INDEX and an "expected FIP" the existing model can consume in place of the
lagging real FIP.

Edge thesis: xwOBA-on-contact + CSW% are lower-variance and more predictive of
future run prevention than ERA/FIP. Swapping expected-skill for lagging FIP lets
the model back regression candidates before the market adjusts. Whether that
produces edge is decided at B3 by CLV — this module only supplies the input.

League anchors (mean/std over qualified pitchers) are computed once from the
DB and cached, so the skill index is genuinely league-relative, not hardcoded.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models.statcast import StatcastPitcherGame, StatcastTeamOffenseGame

# FIP scale anchor: league-average FIP ~ this. Used to center expected FIP.
_LEAGUE_FIP = 4.10
# 1 std of composite skill maps to this many FIP runs (modest; tunable at B5).
_FIP_PER_SKILL_SD = 0.55
_DEFAULT_LOOKBACK_DAYS = 45
_MIN_PITCHES = 120  # below this the window is too thin to trust

# Team offense: map league-relative xwOBA-on-contact z to a wOBA-scale value the
# model's offense component consumes. League wOBA ~0.320, team spread ~0.015.
_LEAGUE_WOBA = 0.320
_WOBA_PER_OFF_SD = 0.015
_MIN_BATTED_BALLS = 80


def pitcher_xstat_window(
    db: Session,
    pitcher_id: int,
    as_of: date,
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
) -> Optional[dict]:
    """Sum Statcast rows in (as_of - lookback, as_of] -> rate dict, or None.

    Strictly `game_date <= as_of`. None when no rows or below the pitch floor.
    """
    start = as_of - timedelta(days=lookback_days)
    row = db.execute(
        select(
            func.coalesce(func.sum(StatcastPitcherGame.pitches), 0),
            func.coalesce(func.sum(StatcastPitcherGame.csw), 0),
            func.coalesce(func.sum(StatcastPitcherGame.swings), 0),
            func.coalesce(func.sum(StatcastPitcherGame.whiffs), 0),
            func.coalesce(func.sum(StatcastPitcherGame.batted_balls), 0),
            func.coalesce(func.sum(StatcastPitcherGame.xwoba_contact_sum), 0.0),
            func.coalesce(func.sum(StatcastPitcherGame.velo_sum), 0.0),
            func.coalesce(func.sum(StatcastPitcherGame.velo_n), 0),
        ).where(
            StatcastPitcherGame.pitcher_id == pitcher_id,
            StatcastPitcherGame.game_date > start,
            StatcastPitcherGame.game_date <= as_of,
        )
    ).one()
    pitches, csw, swings, whiffs, bb, xws, vs, vn = row
    if pitches < _MIN_PITCHES:
        return None
    return {
        "n_pitches": int(pitches),
        "csw_pct": csw / pitches if pitches else None,
        "whiff_pct": whiffs / swings if swings else None,
        "xwoba_contact": xws / bb if bb else None,
        "avg_velo": vs / vn if vn else None,
    }


@lru_cache(maxsize=8)
def _league_anchors(as_of_iso: str, lookback_days: int) -> dict:
    """League mean/std of csw_pct and xwoba_contact over qualified pitcher windows.

    Cached per (as_of, lookback). Computed from a fresh Session so it is
    independent of the caller's session lifecycle.
    """
    from app.database import SessionLocal
    import statistics as stats

    as_of = date.fromisoformat(as_of_iso)
    db = SessionLocal()
    try:
        pitcher_ids = db.execute(
            select(StatcastPitcherGame.pitcher_id).distinct()
        ).scalars().all()
        csws, xws = [], []
        for pid in pitcher_ids:
            w = pitcher_xstat_window(db, pid, as_of, lookback_days)
            if w and w["csw_pct"] is not None and w["xwoba_contact"] is not None:
                csws.append(w["csw_pct"])
                xws.append(w["xwoba_contact"])
    finally:
        db.close()
    def _ms(xs, dflt_m, dflt_s):
        if len(xs) < 5:
            return dflt_m, dflt_s
        return stats.fmean(xs), (stats.pstdev(xs) or dflt_s)
    csw_m, csw_s = _ms(csws, 0.271, 0.03)
    xw_m, xw_s = _ms(xws, 0.368, 0.03)
    return {"csw_m": csw_m, "csw_s": csw_s, "xw_m": xw_m, "xw_s": xw_s, "n": len(csws)}


def skill_index(db: Session, xstat: dict, as_of: date,
                lookback_days: int = _DEFAULT_LOOKBACK_DAYS) -> Optional[float]:
    """Composite league-relative skill z (higher = better pitcher).

    +CSW% is good; -xwOBA-on-contact is good. Equal-weight average of the two
    z-scores. None if inputs missing.
    """
    if xstat is None or xstat.get("csw_pct") is None or xstat.get("xwoba_contact") is None:
        return None
    a = _league_anchors(as_of.isoformat(), lookback_days)
    z_csw = (xstat["csw_pct"] - a["csw_m"]) / a["csw_s"]
    z_xw = -(xstat["xwoba_contact"] - a["xw_m"]) / a["xw_s"]  # lower contact = better
    return 0.5 * (z_csw + z_xw)


def expected_fip(db: Session, pitcher_id: int, as_of: date,
                 lookback_days: int = _DEFAULT_LOOKBACK_DAYS) -> Optional[float]:
    """xStat-derived expected FIP for a pitcher, or None when data is thin.

    expected_fip = LEAGUE_FIP - skill_z * FIP_PER_SKILL_SD
    (better skill -> lower FIP). Clamped to a sane [1.5, 7.0] range to match the
    model's own FIP handling.
    """
    w = pitcher_xstat_window(db, pitcher_id, as_of, lookback_days)
    if w is None:
        return None
    sk = skill_index(db, w, as_of, lookback_days)
    if sk is None:
        return None
    fip = _LEAGUE_FIP - sk * _FIP_PER_SKILL_SD
    return round(min(7.0, max(1.5, fip)), 2)


# ── Team offense (hitter-xwOBA probe) ─────────────────────────────────────────
def team_xwoba_window(
    db: Session, team_abbr: str, as_of: date, lookback_days: int = _DEFAULT_LOOKBACK_DAYS
) -> Optional[float]:
    """Team xwOBA-on-contact over (as_of - lookback, as_of], or None if thin."""
    start = as_of - timedelta(days=lookback_days)
    bb, xws = db.execute(
        select(
            func.coalesce(func.sum(StatcastTeamOffenseGame.batted_balls), 0),
            func.coalesce(func.sum(StatcastTeamOffenseGame.xwoba_contact_sum), 0.0),
        ).where(
            StatcastTeamOffenseGame.team_abbr == team_abbr,
            StatcastTeamOffenseGame.game_date > start,
            StatcastTeamOffenseGame.game_date <= as_of,
        )
    ).one()
    if bb < _MIN_BATTED_BALLS:
        return None
    return xws / bb


@lru_cache(maxsize=8)
def _offense_anchors(as_of_iso: str, lookback_days: int) -> dict:
    """League mean/std of team xwOBA-on-contact over qualified teams (cached)."""
    from app.database import SessionLocal
    import statistics as stats

    as_of = date.fromisoformat(as_of_iso)
    db = SessionLocal()
    try:
        abbrs = db.execute(select(StatcastTeamOffenseGame.team_abbr).distinct()).scalars().all()
        vals = []
        for ab in abbrs:
            v = team_xwoba_window(db, ab, as_of, lookback_days)
            if v is not None:
                vals.append(v)
    finally:
        db.close()
    if len(vals) < 5:
        return {"m": 0.368, "s": 0.02, "n": len(vals)}
    return {"m": stats.fmean(vals), "s": (stats.pstdev(vals) or 0.02), "n": len(vals)}


def effective_team_woba(
    db: Session, team_abbr: str, as_of: date, lookback_days: int = _DEFAULT_LOOKBACK_DAYS
) -> Optional[float]:
    """xStat-derived effective team wOBA (wOBA scale), or None if thin.

    effective_woba = LEAGUE_WOBA + offense_z * WOBA_PER_OFF_SD, where offense_z is
    league-relative team xwOBA-on-contact. Clamped to a sane wOBA range.
    """
    v = team_xwoba_window(db, team_abbr, as_of, lookback_days)
    if v is None:
        return None
    a = _offense_anchors(as_of.isoformat(), lookback_days)
    z = (v - a["m"]) / a["s"]
    woba = _LEAGUE_WOBA + z * _WOBA_PER_OFF_SD
    return round(min(0.400, max(0.260, woba)), 3)
