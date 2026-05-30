"""Live game state — one mutable row per in-progress game.

Populated by the live-poll step in the periodic /admin/tick (which calls
MLBStatsClient.fetch_live for watchlisted in-progress games). Unlike the
append-only odds/weather snapshot tables, this is upserted by primary key:
there is exactly one row per game, overwritten on each tick with the latest
captured state. `captured_at` makes staleness self-evident to the UI.

Monitoring-only. No betting math is stored here — this table feeds structural
"Monitoring alert — not a pick" surfaces on the slate, nothing more.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class LiveGameState(Base):
    """Latest captured live state for a single game. Upserted by PK."""

    __tablename__ = "live_game_states"

    game_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("games.id"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(32))
    inning: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    inning_half: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    outs: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    on_first: Mapped[bool] = mapped_column(Boolean, default=False)
    on_second: Mapped[bool] = mapped_column(Boolean, default=False)
    on_third: Mapped[bool] = mapped_column(Boolean, default=False)
    home_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    away_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Denormalized pitcher name so a never-before-seen reliever doesn't violate
    # the players FK (the id FK is nullable and best-effort).
    current_pitcher_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("players.id"), nullable=True
    )
    current_pitcher_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    current_pitcher_team_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    pitch_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
