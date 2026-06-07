"""Statcast ingestion (Path B, pillar 1) — pitcher expected-stat aggregates.

Pulls pitch-level data from baseball-savant via pybaseball for a date range,
aggregates to ONE row per (pitcher, game_date), and upserts into
statcast_pitcher_games. Never stores raw pitches (storage discipline).

Aggregates stored as sums + counts so window rates are exact when summed over
`game_date <= as_of`:
    csw          = called_strike + swinging_strike(+blocked)
    swings       = swinging(+blocked) + foul + foul_tip + hit_into_play
    whiffs       = swinging_strike + swinging_strike_blocked
    batted_balls = pitches with type == 'X' and a non-null xwOBA estimate
    xwoba_contact_sum = Σ estimated_woba_using_speedangle over batted balls
    velo_sum / velo_n = Σ / count of release_speed

LEAK DISCIPLINE: callers compute windows with `game_date <= as_of`; the replay
path passes as_of = game_date - 1 so a game never sees its own day. This module
only ingests raw daily aggregates — it makes no as_of decisions itself.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.statcast import StatcastPitcherGame, StatcastTeamOffenseGame

log = logging.getLogger("ingestion.statcast")

# Pitch `description` buckets.
_WHIFF = {"swinging_strike", "swinging_strike_blocked"}
_SWING = _WHIFF | {"foul", "foul_tip", "hit_into_play", "foul_pitchout"}
_CALLED = {"called_strike"}


def _fetch_statcast(start: date, end: date):
    """Thin wrapper around pybaseball.statcast (deferred import + quiet)."""
    import warnings

    warnings.filterwarnings("ignore")
    from pybaseball import statcast

    return statcast(start_dt=start.isoformat(), end_dt=end.isoformat())


def _num(x) -> Optional[float]:
    """Coerce to float, returning None for NaN / pandas NA / non-numeric."""
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN check (f != f is True only for NaN)


def aggregate_pitcher_games(df) -> dict[tuple[int, date], dict]:
    """Pure aggregation: pitch-level DataFrame -> {(pitcher_id, game_date): sums}."""
    out: dict[tuple[int, date], dict] = {}
    if df is None or len(df) == 0:
        return out

    cols = df.columns
    has_xwoba = "estimated_woba_using_speedangle" in cols
    for row in df.itertuples(index=False):
        pid = getattr(row, "pitcher", None)
        gd = getattr(row, "game_date", None)
        if pid is None or gd is None:
            continue
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            continue
        # game_date may be a Timestamp/str
        gd = gd.date() if hasattr(gd, "date") else date.fromisoformat(str(gd)[:10])
        key = (pid, gd)
        agg = out.setdefault(key, dict(
            pitches=0, csw=0, swings=0, whiffs=0, batted_balls=0,
            xwoba_contact_sum=0.0, velo_sum=0.0, velo_n=0,
        ))
        agg["pitches"] += 1
        desc = getattr(row, "description", None)
        if desc in _WHIFF:
            agg["whiffs"] += 1
        if desc in _WHIFF or desc in _CALLED:
            agg["csw"] += 1
        if desc in _SWING:
            agg["swings"] += 1
        velo = _num(getattr(row, "release_speed", None))
        if velo is not None:
            agg["velo_sum"] += velo
            agg["velo_n"] += 1
        ptype = getattr(row, "type", None)
        if ptype == "X" and has_xwoba:
            xw = _num(getattr(row, "estimated_woba_using_speedangle", None))
            if xw is not None:
                agg["batted_balls"] += 1
                agg["xwoba_contact_sum"] += xw
    return out


def aggregate_team_offense(df) -> dict[tuple[str, date], dict]:
    """Pure aggregation: pitch-level DataFrame -> {(team_abbr, game_date): offense sums}.

    Batting team = away_team if inning_topbot startswith 'T' else home_team.
    Only batted balls (type=='X') with a non-null xwOBA estimate count.
    """
    out: dict[tuple[str, date], dict] = {}
    if df is None or len(df) == 0:
        return out
    if "estimated_woba_using_speedangle" not in df.columns:
        return out
    for row in df.itertuples(index=False):
        if getattr(row, "type", None) != "X":
            continue
        xw = _num(getattr(row, "estimated_woba_using_speedangle", None))
        if xw is None:
            continue
        topbot = str(getattr(row, "inning_topbot", "") or "")
        home_t = getattr(row, "home_team", None)
        away_t = getattr(row, "away_team", None)
        bat_team = away_t if topbot[:1].upper() == "T" else home_t
        if not bat_team:
            continue
        gd = getattr(row, "game_date", None)
        if gd is None:
            continue
        gd = gd.date() if hasattr(gd, "date") else date.fromisoformat(str(gd)[:10])
        key = (str(bat_team), gd)
        agg = out.setdefault(key, dict(batted_balls=0, xwoba_contact_sum=0.0, hard_hit=0))
        agg["batted_balls"] += 1
        agg["xwoba_contact_sum"] += xw
        ls = _num(getattr(row, "launch_speed", None))
        if ls is not None and ls >= 95.0:
            agg["hard_hit"] += 1
    return out


def upsert_team_offense_game(session: Session, team_abbr: str, game_date: date, agg: dict) -> None:
    existing = session.execute(
        select(StatcastTeamOffenseGame).where(
            StatcastTeamOffenseGame.team_abbr == team_abbr,
            StatcastTeamOffenseGame.game_date == game_date,
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = StatcastTeamOffenseGame(team_abbr=team_abbr, game_date=game_date)
        session.add(existing)
    existing.batted_balls = agg["batted_balls"]
    existing.xwoba_contact_sum = round(agg["xwoba_contact_sum"], 4)
    existing.hard_hit = agg["hard_hit"]


def upsert_pitcher_game(session: Session, pitcher_id: int, game_date: date, agg: dict) -> None:
    existing = session.execute(
        select(StatcastPitcherGame).where(
            StatcastPitcherGame.pitcher_id == pitcher_id,
            StatcastPitcherGame.game_date == game_date,
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = StatcastPitcherGame(pitcher_id=pitcher_id, game_date=game_date)
        session.add(existing)
    existing.pitches = agg["pitches"]
    existing.csw = agg["csw"]
    existing.swings = agg["swings"]
    existing.whiffs = agg["whiffs"]
    existing.batted_balls = agg["batted_balls"]
    existing.xwoba_contact_sum = round(agg["xwoba_contact_sum"], 4)
    existing.velo_sum = round(agg["velo_sum"], 2)
    existing.velo_n = agg["velo_n"]


def ingest_statcast_range(session: Session, start: date, end: date) -> int:
    """Fetch [start, end], aggregate, upsert per (pitcher, game_date). Returns rows upserted."""
    log.info("Statcast pull %s → %s …", start, end)
    df = _fetch_statcast(start, end)
    aggs = aggregate_pitcher_games(df)
    for (pid, gd), agg in aggs.items():
        upsert_pitcher_game(session, pid, gd, agg)
    off = aggregate_team_offense(df)
    for (team, gd), agg in off.items():
        upsert_team_offense_game(session, team, gd, agg)
    session.commit()
    log.info("Statcast upserted %d pitcher-game + %d team-offense rows.", len(aggs), len(off))
    return len(aggs)
