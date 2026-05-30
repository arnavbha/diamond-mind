"""BetRecord — picks performance tracker model.

Each row represents a single tracked bet (moneyline or total).
Result is null until settled. units_returned is computed on settlement.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BetRecord(Base):
    __tablename__ = "bet_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    game_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market: Mapped[str] = mapped_column(String(16), nullable=False)        # "moneyline" | "total"
    selection: Mapped[str] = mapped_column(String(32), nullable=False)     # team abbr (ML) or "OVER"/"UNDER"
    american_odds: Mapped[int] = mapped_column(Integer, nullable=False)
    units: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    result: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)        # "WIN"|"LOSS"|"PUSH"|null
    units_returned: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # null until settled
    tier: Mapped[str] = mapped_column(String(16), nullable=False)          # "STRONG LEAN"|"LEAN"
    home_team_abbr: Mapped[str] = mapped_column(String(8), nullable=False)
    away_team_abbr: Mapped[str] = mapped_column(String(8), nullable=False)
    total_line: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # for O/U picks
    projected_total: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # model projection
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # ── Model state at pick time ──────────────────────────────────────────────
    # Captured from GameAnalysis when the pick is auto-tracked. Required for
    # honest calibration / Brier / edge-realization analysis. Nullable because
    # picks created before 2026-05-26 predate this capture.
    model_prob: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    market_implied_prob: Mapped[Optional[float]] = mapped_column(Float, nullable=True)   # Shin vig-free for the picked side
    edge: Mapped[Optional[float]] = mapped_column(Float, nullable=True)                  # honest edge = model_prob − market_implied_prob
    p_edge_positive: Mapped[Optional[float]] = mapped_column(Float, nullable=True)       # P(edge > 0)
    kelly_fraction_raw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)    # pre-discretization Kelly fraction
    evidence_quality: Mapped[Optional[float]] = mapped_column(Float, nullable=True)      # shrinkage weight ∈ [0,1]
    # "live" = captured at auto-track time. "replay-<YYYY-MM-DD>" = backfilled
    # by re-running the model over the historical game on that date. Replay
    # rows must be flagged in any analysis surfaced to users (the live model
    # code may have drifted since the pick was originally made).
    snapshot_source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # ── Closing Line Value (CLV) ──────────────────────────────────────────────
    # Computed deterministically at settle time (and via POST /admin/backfill-clv)
    # from the LAST odds_snapshots row for this bet's (game_id, market, selection)
    # whose captured_at is STRICTLY BEFORE first pitch (games.game_time_utc).
    # All nullable: if no pre-first-pitch snapshot was ever captured, every field
    # stays null and clv_source records the honest reason — we NEVER fabricate a
    # close. See app/betting/clv.py for the resolver + math.
    closing_odds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    closing_line: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    closing_implied_prob: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    closing_captured_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    clv_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    beat_close: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # 'live' (settle) | 'no_close_captured' | 'one_sided_close'
    # | 'total-line-mismatch' | 'no_first_pitch' | 'backfill-<YYYY-MM-DD>'
    clv_source: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)


class ExcludedPick(Base):
    """Tombstone for manually-deleted auto-track picks.

    When a bet is deleted via DELETE /tracker/bets/{id}, a row is written here
    so that auto-track's idempotency check still finds a record and doesn't
    re-create the bet on the next run.
    """
    __tablename__ = "excluded_picks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    game_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    excluded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def decimal_odds(american_odds: int) -> float:
    """Convert American odds to decimal odds."""
    if american_odds >= 0:
        return 1.0 + american_odds / 100.0
    return 1.0 + 100.0 / abs(american_odds)


def compute_units_returned(result: str, units: float, american_odds: int) -> float:
    """Compute units returned for a settled bet."""
    if result == "WIN":
        return units * (decimal_odds(american_odds) - 1.0)
    if result == "LOSS":
        return -units
    if result == "PUSH":
        return 0.0
    raise ValueError(f"Unknown result: {result!r}")
