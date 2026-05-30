"""Regression: auto-track away-ML odds lookup must read captured market price.

The away-side moneyline branch of POST /tracker/auto-track used to query
``odds_snapshots`` with ``market == 'h2h'``. 'h2h' is a PROVIDER input key that
both writers normalize to 'moneyline' before any row is written
(app/ingestion/odds_api.py::_normalize_market maps 'h2h'->'moneyline';
app/ingestion/espn_odds.py writes market='moneyline' directly). So the query
matched ZERO rows and the away bet was always tagged with the analyzer's modeled
``ml_american_odds`` instead of the real captured price.

These tests pin the canonical behaviour of the extracted helper
``_latest_away_ml_odds`` against BOTH provider selection encodings:
  - ESPN: selection is the lowercase ABBREVIATION ('bos')
  - the-odds-api: selection is the lowercase FULL team name ('boston red sox')
and prove that a non-canonical 'h2h' market filter returns nothing.
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
        ])
        s.commit()
        yield s


def _add_ml(db, *, selection, odds, captured_at, market="moneyline", gid=10):
    db.add(OddsSnapshotRow(
        game_id=gid, bookmaker="draftkings", market=market,
        selection=selection, american_odds=odds, line=None, captured_at=captured_at,
    ))
    db.commit()


def test_resolves_espn_abbr_encoding(db):
    # ESPN writes the away ML selection as a lowercase ABBREVIATION.
    _add_ml(db, selection="nyy", odds=-150, captured_at=NOW)
    _add_ml(db, selection="bos", odds=+135, captured_at=NOW)
    assert _latest_away_ml_odds(db, 10, "BOS") == 135


def test_resolves_oddsapi_fullname_encoding(db):
    # the-odds-api writes the lowercase FULL team name.
    _add_ml(db, selection="new york yankees", odds=-150, captured_at=NOW)
    _add_ml(db, selection="boston red sox", odds=+140, captured_at=NOW)
    assert _latest_away_ml_odds(db, 10, "BOS") == 140


def test_picks_most_recent_when_multiple(db):
    _add_ml(db, selection="bos", odds=+120, captured_at=NOW - timedelta(minutes=30))
    _add_ml(db, selection="bos", odds=+145, captured_at=NOW)
    assert _latest_away_ml_odds(db, 10, "BOS") == 145


def test_returns_none_when_no_away_row(db):
    # Only the home side captured — caller falls back to analysis odds.
    _add_ml(db, selection="nyy", odds=-150, captured_at=NOW)
    assert _latest_away_ml_odds(db, 10, "BOS") is None


def test_non_canonical_h2h_market_matches_zero_rows(db):
    # Proof of the original bug: nothing is ever written with market='h2h', so a
    # query filtering on it returns no rows — which is exactly why the old code
    # silently fell back to the analyzer's modeled odds.
    _add_ml(db, selection="bos", odds=+135, captured_at=NOW)
    h2h_rows = db.execute(
        select(OddsSnapshotRow).where(OddsSnapshotRow.market == "h2h")
    ).scalars().all()
    assert h2h_rows == []
    # The canonical helper still finds the real captured price.
    assert _latest_away_ml_odds(db, 10, "BOS") == 135
