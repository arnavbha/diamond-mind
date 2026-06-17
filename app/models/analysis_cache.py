"""Persistent analysis cache (final-game tier).

Computed game analysis for a FINAL game is immutable: the score is final and the
pre-game form windows as of the game date never change again. We persist those
serialized results so a cold backend — a restart, or the first visit to a past
date the startup warmup didn't cover — serves them instantly instead of
recomputing the full deterministic model (~3-4s for a slate of 15 games).

Live / scheduled games are deliberately NOT stored here: their inputs (odds,
lineups, weather) still move, so they stay on the short in-memory TTL cache in
app/api/routes.py. Because only immutable finals land here, no time-based
invalidation is needed; /cache/clear truncates the table for a forced recompute.
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AnalysisCacheRow(Base):
    __tablename__ = "analysis_cache"

    # Composite key mirrors the in-memory cache key (game_id, as_of_date).
    game_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    as_of: Mapped[date] = mapped_column(Date, primary_key=True)
    # JSON-serialized analysis dict (the same payload the API returns).
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
