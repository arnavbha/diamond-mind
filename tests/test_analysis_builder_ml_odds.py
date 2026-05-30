"""Regression: analysis_builder moneyline-odds lookup must use the canonical
odds_snapshots encoding, not a substring match on the team's DB nickname.

THE BUG (pre-fix): `build_game_analysis._get_ml_odds` resolved a team's captured
moneyline price with

    OddsSnapshotRow.selection.ilike(f"%{team.name.lower()}%")

where `team.name` is the MLB Stats API *nickname* ('Yankees', 'Diamondbacks').
But `odds_snapshots.selection` is provider-dependent (verified against the
writers app/ingestion/espn_odds.py and app/ingestion/odds_api.py):

  * ESPN writes the lowercase ABBREVIATION ('nyy', 'ari') — so
    ilike('%yankees%') / ilike('%diamondbacks%') matches ZERO ESPN rows. The
    analyzer then silently fell back to the model's own ml_american_odds, so
    captured ESPN market prices never reached edge/CLV math whenever ESPN was
    the odds source.
  * the-odds-api writes the lowercase FULL team name ('new york yankees') — the
    nickname IS a substring there, so that path happened to work.

THE FIX: resolve every candidate snapshot's `selection` to a normalized abbr
(same approach as routes._latest_away_ml_odds / clv._resolve_ml) and match it to
the team's own abbr. `market` is the canonical singular 'moneyline'.

These tests pin `_latest_ml_odds_for_abbr` (the extracted helper `_get_ml_odds`
delegates to) across BOTH provider encodings, recency, bookmaker precedence,
and the AZ→ARI alias.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
import app.models.odds  # noqa: F401 — register OddsSnapshotRow
import app.models.games  # noqa: F401 — register Game
import app.models.entities  # noqa: F401 — register Team
from app.models.entities import Team
from app.models.odds import OddsSnapshotRow
from app.betting.analysis_builder import _latest_ml_odds_for_abbr


NOW = datetime(2026, 5, 30, 22, 0, tzinfo=timezone.utc)
GID = 77
PREFERRED = "draftkings"


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
            Team(id=4, abbr="ARI", name="Diamondbacks"),
        ])
        s.commit()
        yield s


def _add(db, *, market, selection, odds, captured_at, line=None, gid=GID,
         book=PREFERRED):
    db.add(OddsSnapshotRow(
        game_id=gid, bookmaker=book, market=market,
        selection=selection, american_odds=odds, line=line, captured_at=captured_at,
    ))
    db.commit()


def test_picks_up_espn_abbreviation_encoding(db):
    """ESPN selection = lowercase abbr. A nickname-substring ilike would miss it
    entirely (the bug); abbr resolution finds it."""
    _add(db, market="moneyline", selection="nyy", odds=-150, captured_at=NOW)
    _add(db, market="moneyline", selection="bos", odds=+140, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "NYY", PREFERRED) == -150
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) == 140


def test_espn_abbr_when_nickname_is_not_a_substring(db):
    """'Diamondbacks' nickname is NOT a substring of the ESPN selection 'ari'
    nor of the odds-api 'arizona diamondbacks' in a way the old ilike used —
    abbr resolution handles both."""
    _add(db, market="moneyline", selection="ari", odds=+118, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "ARI", PREFERRED) == 118


def test_picks_up_oddsapi_fullname_encoding(db):
    """the-odds-api selection = lowercase full team name."""
    _add(db, market="moneyline", selection="new york yankees", odds=-150, captured_at=NOW)
    _add(db, market="moneyline", selection="boston red sox", odds=+128, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) == 128


def test_disambiguates_two_new_york_full_names(db):
    _add(db, market="moneyline", selection="new york mets", odds=+105, captured_at=NOW)
    _add(db, market="moneyline", selection="new york yankees", odds=-120, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "NYM", PREFERRED) == 105
    assert _latest_ml_odds_for_abbr(db, GID, "NYY", PREFERRED) == -120


def test_az_alias_normalizes_to_ari(db):
    """odds_snapshots may carry the 'az' abbr; the team is seeded as 'ARI'.
    ABBR_NORM must collapse AZ→ARI on both sides."""
    _add(db, market="moneyline", selection="az", odds=+122, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "ARI", PREFERRED) == 122
    # And a caller passing the AZ alias as the target resolves the same row.
    assert _latest_ml_odds_for_abbr(db, GID, "AZ", PREFERRED) == 122


def test_returns_most_recent(db):
    _add(db, market="moneyline", selection="bos", odds=+120,
         captured_at=NOW - timedelta(minutes=45))
    _add(db, market="moneyline", selection="bos", odds=+150, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) == 150


def test_prefers_preferred_bookmaker(db):
    """When the preferred book has a price it wins, even if a different book's
    row is more recent."""
    _add(db, market="moneyline", selection="bos", odds=+130,
         captured_at=NOW, book=PREFERRED)
    _add(db, market="moneyline", selection="bos", odds=+999,
         captured_at=NOW + timedelta(minutes=5), book="someother")
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) == 130


def test_falls_back_to_any_book_when_preferred_absent(db):
    _add(db, market="moneyline", selection="bos", odds=+144,
         captured_at=NOW, book="someother")
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) == 144


def test_ignores_non_canonical_h2h_market(db):
    """A row written under the provider key 'h2h' (which no writer persists) is
    invisible; only the canonical 'moneyline' row is returned."""
    _add(db, market="h2h", selection="bos", odds=+999, captured_at=NOW)
    _add(db, market="moneyline", selection="bos", odds=+135, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) == 135


def test_none_when_no_row_for_team(db):
    _add(db, market="moneyline", selection="nyy", odds=-150, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, "BOS", PREFERRED) is None


def test_none_target_returns_none(db):
    _add(db, market="moneyline", selection="nyy", odds=-150, captured_at=NOW)
    assert _latest_ml_odds_for_abbr(db, GID, None, PREFERRED) is None
