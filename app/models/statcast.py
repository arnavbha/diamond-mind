"""Statcast-derived expected-stat aggregates (Path B, pillar 1).

Stores ONE row per (pitcher, game_date) holding raw sums + counts — never raw
pitch rows (storage discipline: pitch-level full-season is huge; Render free
Postgres is small). Window stats (SEASON / last-N-days) are computed on demand
by summing rows with `game_date <= as_of`, exactly like recent_form does over
PitcherGameLog. That keeps everything as_of-bounded and leak-free: a window for
a game on date D never sees rows dated D or later when the caller passes
as_of = D - 1.

Rates are derived at window time from the stored sums/counts so aggregation is
exact (sum the sums, divide once):
    csw_pct       = csw / pitches
    whiff_pct     = whiffs / swings
    xwoba_contact = xwoba_contact_sum / batted_balls
    avg_velo      = velo_sum / velo_n

Why these beat ERA/FIP: they are lower-variance, more predictive of FUTURE
performance, and let the model back regression candidates (ugly ERA, good
underlying) before the market adjusts. That is the edge thesis under test.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, Float, Integer, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class StatcastPitcherGame(Base):
    """Per-pitcher, per-game Statcast aggregate. Upserted by (pitcher_id, game_date)."""

    __tablename__ = "statcast_pitcher_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pitcher_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    game_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    pitches: Mapped[int] = mapped_column(Integer, default=0)
    csw: Mapped[int] = mapped_column(Integer, default=0)          # called + swinging strikes
    swings: Mapped[int] = mapped_column(Integer, default=0)
    whiffs: Mapped[int] = mapped_column(Integer, default=0)
    batted_balls: Mapped[int] = mapped_column(Integer, default=0)
    xwoba_contact_sum: Mapped[float] = mapped_column(Float, default=0.0)  # Σ xwOBA over batted balls
    velo_sum: Mapped[float] = mapped_column(Float, default=0.0)           # Σ release_speed
    velo_n: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        Index("ix_statcast_pitcher_date", "pitcher_id", "game_date", unique=True),
    )


class StatcastTeamOffenseGame(Base):
    """Per-team, per-game offensive Statcast aggregate (batting team's batted balls).

    Upserted by (team_abbr, game_date). xwoba_contact_sum / batted_balls = team
    xwOBA-on-contact, an expected-offense signal that leads runs/wOBA. Windows
    summed game_date <= as_of (leak-safe).
    """

    __tablename__ = "statcast_team_offense_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_abbr: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    game_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    batted_balls: Mapped[int] = mapped_column(Integer, default=0)
    xwoba_contact_sum: Mapped[float] = mapped_column(Float, default=0.0)
    hard_hit: Mapped[int] = mapped_column(Integer, default=0)   # launch_speed >= 95 mph

    __table_args__ = (
        Index("ix_statcast_team_off_date", "team_abbr", "game_date", unique=True),
    )
