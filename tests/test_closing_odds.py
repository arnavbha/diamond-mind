"""Closing-odds capture tests.

Covers the reviewer's scenarios plus an end-to-end proof that a captured
snapshot is resolved by clv.py as the close and yields a non-null CLV — proving
the persisted selection encoding matches what the resolver expects.

Scenarios:
  1. In-window pre-start game IS captured (and end-to-end CLV resolves it).
  2. Started / in-progress game is SKIPPED (no ESPN call, no row).
  3. Recently-captured game is SKIPPED by dedup (no ESPN call, no new row).
  4. ESPN-empty persists NOTHING (no fake data), counted under `failed`.
  5. Total leg end-to-end: over/under captured pre-pitch resolves CLV.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.contracts import OddsSnapshot
from app.database import Base
import app.models.odds  # noqa: F401 — register OddsSnapshotRow
import app.models.games  # noqa: F401 — register Game
import app.models.entities  # noqa: F401 — register Team
from app.models.entities import Team
from app.models.games import Game
from app.models.odds import OddsSnapshotRow
from app.betting.clv import compute_clv_for_bet
import app.ingestion.closing_odds as cap
from app.ingestion.closing_odds import capture_closing_odds


NOW = datetime(2026, 5, 30, 23, 0, tzinfo=timezone.utc)


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
        # Teams referenced by _ingest_odds_and_weather's session.get(Team, ...)
        s.add_all([
            Team(id=1, abbr="NYY", name="New York Yankees"),
            Team(id=2, abbr="BOS", name="Boston Red Sox"),
        ])
        s.commit()
        yield s


@pytest.fixture(autouse=True)
def _no_weather(monkeypatch):
    # Keep the canonical writer offline/deterministic: no weather network call.
    monkeypatch.setattr(
        "scripts.run_pregame_update.fetch_weather",
        lambda *a, **k: None,
    )
    # Event-id mapping is a no-op in tests (we set odds_event_id directly).
    monkeypatch.setattr(
        "scripts.run_pregame_update._map_odds_event_ids",
        lambda *a, **k: None,
    )
    # Force the free-first / no-paid-quota default unless a test overrides.
    monkeypatch.setattr(
        cap, "get_settings",
        lambda: SimpleNamespace(has_odds_api=False, preferred_bookmaker="draftkings"),
    )


def _add_game(db, *, gid=10, minutes_to_pitch=8, status="Scheduled", event_id="evt-10"):
    db.add(Game(
        id=gid,
        game_date=NOW.date(),
        game_time_utc=NOW + timedelta(minutes=minutes_to_pitch),
        home_team_id=1,
        away_team_id=2,
        venue="Yankee Stadium",
        status=status,
        odds_event_id=event_id,
    ))
    db.commit()


def _ml_total_snaps(game_id, captured_at):
    """Mirror espn_odds.fetch_odds output: lowercase abbr ML + over/under total."""
    return [
        OddsSnapshot(game_id=game_id, bookmaker="draftkings", market="moneyline",
                     selection="nyy", american_odds=-150, line=None, captured_at=captured_at),
        OddsSnapshot(game_id=game_id, bookmaker="draftkings", market="moneyline",
                     selection="bos", american_odds=+130, line=None, captured_at=captured_at),
        OddsSnapshot(game_id=game_id, bookmaker="draftkings", market="total",
                     selection="over", american_odds=-110, line=8.5, captured_at=captured_at),
        OddsSnapshot(game_id=game_id, bookmaker="draftkings", market="total",
                     selection="under", american_odds=-110, line=8.5, captured_at=captured_at),
    ]


def _patch_espn(monkeypatch, fetch_fn):
    """Patch the ESPN provider as seen by _ingest_odds_and_weather."""
    monkeypatch.setattr(
        "app.ingestion.espn_odds.fetch_odds",
        fetch_fn,
    )


# ── Scenario 1: in-window pre-start game IS captured ──────────────────────────
def test_inwindow_game_is_captured(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8, status="Scheduled")

    calls = []

    def fake_fetch(game_id, event_id, home_team_name="", away_team_name=""):
        calls.append(game_id)
        return _ml_total_snaps(game_id, NOW)  # captured_at=NOW < game_time_utc

    _patch_espn(monkeypatch, fake_fetch)

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    db.commit()

    assert cov["games_today"] == 1
    assert cov["games_in_window"] == 1
    assert cov["captured"] == 1
    assert cov["source_espn"] == 1
    assert cov["failed"] == 0
    assert cov["snapshots_written"] == 4
    assert calls == [10]

    rows = db.execute(
        select(func.count()).select_from(OddsSnapshotRow)
        .where(OddsSnapshotRow.game_id == 10)
    ).scalar()
    assert rows == 4


# ── End-to-end: captured row resolves as the close (ML) ───────────────────────
def test_endtoend_ml_clv_resolves(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    _patch_espn(monkeypatch, lambda *a, **k: _ml_total_snaps(a[0], NOW))

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    db.commit()
    assert cov["captured"] == 1

    bet = SimpleNamespace(
        game_id=10, market="moneyline", selection="NYY", total_line=None,
        home_team_abbr="NYY", away_team_abbr="BOS",
        american_odds=+120, market_implied_prob=0.5,
    )
    game = db.get(Game, 10)
    out = compute_clv_for_bet(db, bet, game)

    # The snapshot selection was "nyy" (lowercase abbr) — resolver must match it
    # to the bet's "NYY" pick. closing_odds non-null proves the encoding matches.
    assert out["closing_odds"] == -150
    assert out["clv_source"] != "no_close_captured"
    assert out["clv_source"] != "no_first_pitch"
    assert out["closing_captured_at"] is not None


# ── Scenario 5: total leg end-to-end ──────────────────────────────────────────
def test_endtoend_total_clv_resolves(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    _patch_espn(monkeypatch, lambda *a, **k: _ml_total_snaps(a[0], NOW))

    capture_closing_odds(db, NOW, today=NOW.date())
    db.commit()

    bet = SimpleNamespace(
        game_id=10, market="total", selection="OVER", total_line=8.5,
        home_team_abbr="NYY", away_team_abbr="BOS",
        american_odds=-105, market_implied_prob=0.5,
    )
    out = compute_clv_for_bet(db, bet, db.get(Game, 10))

    assert out["closing_line"] == 8.5
    assert out["closing_odds"] is not None
    assert out["clv_source"] in ("live", "one_sided_close")


# ── Scenario 2: started / in-progress game is SKIPPED ─────────────────────────
def test_started_game_is_skipped(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8, status="In Progress")

    calls = []
    _patch_espn(monkeypatch, lambda *a, **k: calls.append(a[0]) or [])

    cov = capture_closing_odds(db, NOW, today=NOW.date())

    assert cov["games_in_window"] == 0
    assert cov["captured"] == 0
    assert cov["skipped_not_in_window"] == 1
    assert calls == []  # ESPN never called for a started game


def test_past_first_pitch_game_is_skipped(db, monkeypatch):
    # Pre-start status but game_time already passed (now > gt) → lower-bound guard.
    _add_game(db, minutes_to_pitch=-2, status="Scheduled")

    calls = []
    _patch_espn(monkeypatch, lambda *a, **k: calls.append(a[0]) or [])

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    assert cov["games_in_window"] == 0
    assert cov["skipped_not_in_window"] == 1
    assert calls == []


def test_far_out_game_is_skipped(db, monkeypatch):
    # Pre-start but starts in 40 min — outside the 15-min window.
    _add_game(db, minutes_to_pitch=40, status="Scheduled")

    calls = []
    _patch_espn(monkeypatch, lambda *a, **k: calls.append(a[0]) or [])

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    assert cov["games_in_window"] == 0
    assert cov["skipped_not_in_window"] == 1
    assert calls == []


# ── Scenario 3: recently-captured game is SKIPPED by dedup ─────────────────────
def test_recent_capture_is_deduped(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    # A snapshot landed 2 min ago — within the 10-min dedup window.
    db.add(OddsSnapshotRow(
        game_id=10, bookmaker="dk", market="moneyline", selection="nyy",
        line=None, american_odds=-150, captured_at=NOW - timedelta(minutes=2),
    ))
    db.commit()

    calls = []
    _patch_espn(monkeypatch, lambda *a, **k: calls.append(a[0]) or _ml_total_snaps(a[0], NOW))

    cov = capture_closing_odds(db, NOW, today=NOW.date())

    assert cov["games_in_window"] == 0
    assert cov["skipped_recent"] == 1
    assert cov["captured"] == 0
    assert calls == []  # dedup short-circuits before any ESPN call


def test_old_capture_is_not_deduped(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    # A snapshot from 30 min ago — older than the 10-min dedup window.
    db.add(OddsSnapshotRow(
        game_id=10, bookmaker="dk", market="moneyline", selection="nyy",
        line=None, american_odds=-150, captured_at=NOW - timedelta(minutes=30),
    ))
    db.commit()

    _patch_espn(monkeypatch, lambda *a, **k: _ml_total_snaps(a[0], NOW))

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    assert cov["games_in_window"] == 1
    assert cov["captured"] == 1


# ── Scenario 4: ESPN-empty persists nothing ───────────────────────────────────
def test_espn_empty_persists_nothing(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    _patch_espn(monkeypatch, lambda *a, **k: [])  # ESPN returns [] (failure)

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    db.commit()

    assert cov["games_in_window"] == 1
    assert cov["captured"] == 0
    assert cov["failed"] == 1
    assert cov["snapshots_written"] == 0

    rows = db.execute(
        select(func.count()).select_from(OddsSnapshotRow)
        .where(OddsSnapshotRow.game_id == 10)
    ).scalar()
    assert rows == 0  # NO FAKE DATA — nothing persisted


# ── Paid fallback only fires when ESPN empty AND has_odds_api ──────────────────
def test_paid_fallback_when_espn_empty(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    monkeypatch.setattr(
        cap, "get_settings",
        lambda: SimpleNamespace(has_odds_api=True, preferred_bookmaker="draftkings"),
    )
    _patch_espn(monkeypatch, lambda *a, **k: [])  # ESPN dry

    paid_calls = []

    def paid_fetch(game_id, event_id, home_team_name="", away_team_name=""):
        paid_calls.append(game_id)
        return _ml_total_snaps(game_id, NOW)

    monkeypatch.setattr("app.ingestion.odds_api.fetch_odds", paid_fetch)

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    db.commit()

    assert paid_calls == [10]
    assert cov["captured"] == 1
    assert cov["source_oddsapi"] == 1
    assert cov["source_espn"] == 0


def test_paid_not_called_when_espn_works(db, monkeypatch):
    _add_game(db, minutes_to_pitch=8)
    monkeypatch.setattr(
        cap, "get_settings",
        lambda: SimpleNamespace(has_odds_api=True, preferred_bookmaker="draftkings"),
    )
    _patch_espn(monkeypatch, lambda *a, **k: _ml_total_snaps(a[0], NOW))

    paid_calls = []
    monkeypatch.setattr(
        "app.ingestion.odds_api.fetch_odds",
        lambda *a, **k: paid_calls.append(a[0]) or [],
    )

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    assert cov["source_espn"] == 1
    assert paid_calls == []  # quota never burned when ESPN works


# ── Edge: empty slate is a no-op ──────────────────────────────────────────────
def test_empty_slate_noop(db, monkeypatch):
    _patch_espn(monkeypatch, lambda *a, **k: [])
    cov = capture_closing_odds(db, NOW, today=NOW.date())
    assert cov["games_today"] == 0
    assert cov["games_in_window"] == 0
    assert cov["captured"] == 0


# ── Edge: game_time_utc is None is skipped ────────────────────────────────────
def test_null_game_time_skipped(db, monkeypatch):
    db.add(Game(
        id=11, game_date=NOW.date(), game_time_utc=None,
        home_team_id=1, away_team_id=2, status="Scheduled", odds_event_id="e",
    ))
    db.commit()
    calls = []
    _patch_espn(monkeypatch, lambda *a, **k: calls.append(a[0]) or [])

    cov = capture_closing_odds(db, NOW, today=NOW.date())
    assert cov["games_in_window"] == 0
    assert cov["skipped_not_in_window"] == 1
    assert calls == []


# ── Bound: qualifying list is capped before network calls ─────────────────────
def test_max_games_cap(db, monkeypatch):
    for i in range(20):
        db.add(Game(
            id=100 + i, game_date=NOW.date(),
            game_time_utc=NOW + timedelta(minutes=5),
            home_team_id=1, away_team_id=2, status="Scheduled",
            odds_event_id=f"e{i}",
        ))
    db.commit()

    calls = []
    _patch_espn(monkeypatch, lambda *a, **k: calls.append(a[0]) or _ml_total_snaps(a[0], NOW))

    cov = capture_closing_odds(db, NOW, today=NOW.date(), max_games=15)
    assert cov["games_in_window"] == 15
    assert len(calls) == 15  # never fetched more than the cap
