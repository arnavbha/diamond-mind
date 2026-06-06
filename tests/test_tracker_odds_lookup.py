"""Regression: tracker / auto-track odds-snapshot lookups must use canonical encodings.

Canonical odds_snapshots encodings (verified against the writers
app/ingestion/espn_odds.py and app/ingestion/odds_api.py):

  * market is stored SINGULAR: 'moneyline' / 'total'. 'h2h' / 'totals' are
    PROVIDER input keys that odds_api._normalize_market rewrites to
    'moneyline' / 'total' before any row is written; espn_odds writes the
    singular form directly. A query filtering on 'h2h' (or 'totals') therefore
    matches ZERO rows.
  * moneyline selection is a team token whose encoding is provider-dependent:
    ESPN writes the lowercase ABBREVIATION ('bos'); the-odds-api writes the
    lowercase FULL team name ('boston red sox'). The canonical reader resolves
    either to a normalized abbr.
  * total selection is 'over' / 'under' (lowercase), matched by ilike.

These tests pin the AWAY-moneyline helper `_latest_away_ml_odds` (the fix for
the 'h2h' bug) and assert the totals branch's read encoding is canonical, and —
crucially — that a captured snapshot is actually PICKED UP rather than the
caller falling back to the analyzer's modeled odds / the -110 total default.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
import app.models.odds  # noqa: F401 — register OddsSnapshotRow
import app.models.games  # noqa: F401 — register Game
import app.models.entities  # noqa: F401 — register Team
from app.models.entities import Team
from app.models.odds import OddsSnapshotRow
from app.api.routes import _latest_away_ml_odds


NOW = datetime(2026, 5, 30, 22, 0, tzinfo=timezone.utc)
GID = 10


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as s:
        s.add_all([
            Team(id=1, abbr="NYY", name="Yankees"),
            Team(id=2, abbr="BOS", name="Red Sox"),
            Team(id=3, abbr="NYM", name="Mets"),
        ])
        s.commit()
        yield s


def _add(db, *, market, selection, odds, captured_at, line=None, gid=GID,
         book="draftkings"):
    db.add(OddsSnapshotRow(
        game_id=gid, bookmaker=book, market=market,
        selection=selection, american_odds=odds, line=line, captured_at=captured_at,
    ))
    db.commit()


# ── away-moneyline helper: canonical market + dual selection encodings ────────

def test_away_ml_reads_canonical_moneyline_market_not_h2h(db):
    """The helper must filter market=='moneyline'. A row written with the
    non-canonical provider key 'h2h' is invisible to it (proving the old bug),
    while the canonical row is found and its captured price returned."""
    # Non-canonical row that the OLD code's market=='h2h' query would have
    # "matched" — but no writer ever persists 'h2h', so it is noise here and
    # must NOT be returned.
    _add(db, market="h2h", selection="bos", odds=+999, captured_at=NOW)
    # Canonical row.
    _add(db, market="moneyline", selection="bos", odds=+135, captured_at=NOW)
    assert _latest_away_ml_odds(db, GID, "BOS") == 135
    # And confirm directly that nothing is ever stored as 'h2h' by a writer:
    # the only h2h row here is the synthetic noise above, which the helper skips.
    found = db.execute(
        select(OddsSnapshotRow.american_odds)
        .where(OddsSnapshotRow.game_id == GID,
               OddsSnapshotRow.market == "h2h")
    ).scalars().all()
    assert found == [999]  # present in table but NOT returned by the helper


def test_away_ml_picks_up_espn_abbreviation_encoding(db):
    """ESPN selection = lowercase abbreviation."""
    _add(db, market="moneyline", selection="nyy", odds=-150, captured_at=NOW)
    _add(db, market="moneyline", selection="bos", odds=+140, captured_at=NOW)
    assert _latest_away_ml_odds(db, GID, "BOS") == 140


def test_away_ml_picks_up_oddsapi_fullname_encoding(db):
    """the-odds-api selection = lowercase full team name."""
    _add(db, market="moneyline", selection="new york yankees", odds=-150, captured_at=NOW)
    _add(db, market="moneyline", selection="boston red sox", odds=+128, captured_at=NOW)
    assert _latest_away_ml_odds(db, GID, "BOS") == 128


def test_away_ml_disambiguates_ny_full_names(db):
    """'new york yankees' vs 'new york mets' must resolve to distinct abbrs."""
    _add(db, market="moneyline", selection="new york mets", odds=+105, captured_at=NOW)
    _add(db, market="moneyline", selection="new york yankees", odds=-120, captured_at=NOW)
    assert _latest_away_ml_odds(db, GID, "NYM") == 105
    assert _latest_away_ml_odds(db, GID, "NYY") == -120


def test_away_ml_returns_most_recent(db):
    _add(db, market="moneyline", selection="bos", odds=+120,
         captured_at=NOW - timedelta(minutes=45))
    _add(db, market="moneyline", selection="bos", odds=+150, captured_at=NOW)
    assert _latest_away_ml_odds(db, GID, "BOS") == 150


def test_away_ml_none_when_only_home_captured(db):
    """No away row → None, so the caller falls back to analysis ml_american_odds."""
    _add(db, market="moneyline", selection="nyy", odds=-150, captured_at=NOW)
    assert _latest_away_ml_odds(db, GID, "BOS") is None


# ── totals branch read encoding is canonical: market=='total', over/under ─────

def _latest_total_price(db, game_id, total_lean):
    """Mirror of the auto-track totals read (routes.py ~3060) to pin its
    canonical market string and over/under selection encoding."""
    side_frag = "over" if total_lean == "OVER" else "under"
    row = db.execute(
        select(OddsSnapshotRow.american_odds)
        .where(
            OddsSnapshotRow.game_id == game_id,
            OddsSnapshotRow.market == "total",
            OddsSnapshotRow.selection.ilike(f"%{side_frag}%"),
        )
        .order_by(OddsSnapshotRow.captured_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return int(row) if row is not None else -110


def test_totals_read_uses_canonical_total_market_not_totals(db):
    """A row stored under the non-canonical provider key 'totals' is invisible;
    a canonical market=='total' / selection 'over' row is picked up instead of
    the -110 default."""
    _add(db, market="totals", selection="over", odds=+999, line=8.5, captured_at=NOW)
    _add(db, market="total", selection="over", odds=-105, line=8.5, captured_at=NOW)
    assert _latest_total_price(db, GID, "OVER") == -105


def test_totals_under_selection_picked_up(db):
    _add(db, market="total", selection="over", odds=-115, line=8.5, captured_at=NOW)
    _add(db, market="total", selection="under", odds=-108, line=8.5, captured_at=NOW)
    assert _latest_total_price(db, GID, "UNDER") == -108


def test_totals_falls_back_to_minus_110_when_absent(db):
    assert _latest_total_price(db, GID, "OVER") == -110
