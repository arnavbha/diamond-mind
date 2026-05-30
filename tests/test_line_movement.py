"""Tests for app.betting.line_movement — net single-book line movement.

Covers the reviewer's three worked examples (sign discipline in vig-free space),
the C2 american-non-linearity trap, totals line-move dominance, and every empty
state (single_snapshot, one_sided, no_first_pitch, no_book_snapshots), plus the
same-book / pre-pitch-only guards.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.betting.line_movement import (
    MIN_PROB_MOVE,
    compute_movement,
    resolve_open_close_snapshots,
)


FIRST_PITCH = datetime(2026, 5, 30, 23, 5, tzinfo=timezone.utc)


class Snap:
    """Plain test snapshot (duck-typed like an OddsSnapshotRow)."""

    def __init__(self, market, selection, american_odds, captured_at, line=None, bookmaker="draftkings"):
        self.market = market
        self.selection = selection
        self.american_odds = american_odds
        self.captured_at = captured_at
        self.line = line
        self.bookmaker = bookmaker


def _t(minutes_before_pitch: int) -> datetime:
    return FIRST_PITCH - timedelta(minutes=minutes_before_pitch)


def ml(selection, odds, mins_before, **kw):
    return Snap("moneyline", selection, odds, _t(mins_before), **kw)


def tot(selection, odds, mins_before, line, **kw):
    return Snap("total", selection, odds, _t(mins_before), line=line, **kw)


# ── Worked example 1: home favorite shortens → toward home ────────────────────
def test_home_favorite_shortens_toward():
    snaps = [
        ml("NYY", -130, 180), ml("BOS", +110, 180),   # open
        ml("NYY", -150, 10), ml("BOS", +130, 10),     # close
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "live"
    assert mv["side"] == "home"
    assert mv["open"]["american"] == -130
    assert mv["close"]["american"] == -150
    assert mv["devig_prob_delta"] > MIN_PROB_MOVE      # shortened our way
    assert mv["agreement"] == "toward"
    assert mv["label"] == "confirmation"


# ── Worked example 2: underdog lengthens → away (fade) ────────────────────────
def test_underdog_lengthens_away():
    snaps = [
        ml("BOS", +120, 200), ml("NYY", -140, 200),   # open
        ml("BOS", +150, 5), ml("NYY", -170, 5),        # close
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="away", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "live"
    assert mv["side"] == "away"
    assert mv["devig_prob_delta"] < -MIN_PROB_MOVE     # our side lengthened
    assert mv["agreement"] == "away"
    assert mv["label"] == "fade"


# ── Worked example 3: total line 8.5 → 9.0, OVER pick → toward (line-driven) ───
def test_total_line_up_over_pick_toward():
    snaps = [
        tot("over", -110, 180, 8.5), tot("under", -110, 180, 8.5),
        tot("over", -105, 10, 9.0), tot("under", -115, 10, 9.0),
    ]
    mv = compute_movement(
        market="total", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="over",
    )
    assert mv["source"] == "live"
    assert mv["side"] == "over"
    assert mv["line_delta"] == pytest.approx(0.5)
    # Line move dominates; do NOT devig across different lines.
    assert mv["devig_prob_delta"] is None
    assert mv["agreement"] == "toward"
    assert mv["label"] == "confirmation"


def test_total_line_down_over_pick_away():
    snaps = [
        tot("over", -110, 180, 8.5), tot("under", -110, 180, 8.5),
        tot("over", -110, 10, 8.0), tot("under", -110, 10, 8.0),
    ]
    mv = compute_movement(
        market="total", snapshots=snaps, game_start=FIRST_PITCH, leaned_side="over",
    )
    assert mv["line_delta"] == pytest.approx(-0.5)
    assert mv["agreement"] == "away"      # line DOWN (fewer runs) is bad for OVER


def test_total_line_up_under_pick_away():
    snaps = [
        tot("over", -110, 180, 8.5), tot("under", -110, 180, 8.5),
        tot("over", -110, 10, 9.0), tot("under", -110, 10, 9.0),
    ]
    mv = compute_movement(
        market="total", snapshots=snaps, game_start=FIRST_PITCH, leaned_side="under",
    )
    assert mv["line_delta"] == pytest.approx(0.5)
    assert mv["agreement"] == "away"    # line UP (more runs) is bad for UNDER


# ── C2: american non-linearity trap (+105 → -105) must classify on prob ───────
def test_american_crossover_classifies_on_prob_not_price():
    # +105 → -105 is a ~210-cent american swing but only ~5 vig-free prob points.
    snaps = [
        ml("NYY", +105, 180), ml("BOS", -105, 180),
        ml("NYY", -105, 10), ml("BOS", +105, 10),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["agreement"] == "toward"          # our side shortened
    # ~2.4 vig-free points — small and finite, NOT the 210-cent american swing.
    assert 0.0 < mv["devig_prob_delta"] < 0.05
    assert mv["american_delta"] == -210          # display only


# ── Vig-only move: both prices move, no-vig prob barely shifts → neutral ──────
def test_vig_only_move_is_neutral():
    # Both sides get more expensive symmetrically (book widens hold); the no-vig
    # prob on either side is ~unchanged.
    snaps = [
        ml("NYY", -110, 180), ml("BOS", -110, 180),
        ml("NYY", -120, 10), ml("BOS", -120, 10),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert abs(mv["devig_prob_delta"]) <= MIN_PROB_MOVE
    assert mv["agreement"] == "neutral"
    assert mv["label"] == "flat"


# ── Empty state: single pre-pitch snapshot → insufficient, NOT neutral ────────
def test_single_snapshot_empty_state():
    snaps = [ml("NYY", -130, 60), ml("BOS", +110, 60)]  # one capture only
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "single_snapshot"
    assert mv["agreement"] is None          # never "neutral"
    assert mv["label"] is None
    assert mv["open"]["american"] == -130
    assert mv["close"]["american"] == -130


# ── Empty state: no first pitch → window undefined ────────────────────────────
def test_no_first_pitch_empty_state():
    snaps = [ml("NYY", -130, 60), ml("NYY", -150, 10)]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=None,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "no_first_pitch"
    assert mv["agreement"] is None


# ── Empty state: all snapshots after first pitch (in-game only) ───────────────
def test_only_post_pitch_rows_no_book_snapshots():
    after = FIRST_PITCH + timedelta(minutes=30)
    snaps = [
        Snap("moneyline", "NYY", -130, after),
        Snap("moneyline", "NYY", -150, after + timedelta(minutes=10)),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "no_book_snapshots"


def test_post_pitch_row_never_used_as_close():
    # Pre-pitch open + close, plus a LATER in-game row that must be excluded.
    after = FIRST_PITCH + timedelta(minutes=30)
    snaps = [
        ml("NYY", -130, 180), ml("BOS", +110, 180),
        ml("NYY", -150, 10), ml("BOS", +130, 10),
        Snap("moneyline", "NYY", -300, after),   # in-game — must be ignored
        Snap("moneyline", "BOS", +260, after),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["close"]["american"] == -150    # the pre-pitch close, NOT -300


# ── One-sided endpoint: only our side at open → price-only, no confident verdict
def test_one_sided_endpoint_price_only():
    # Open has only NYY (our side); close has both.
    snaps = [
        ml("NYY", -130, 180),                  # open, one-sided
        ml("NYY", -150, 10), ml("BOS", +130, 10),  # close, two-sided
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "one_sided"
    assert mv["devig_prob_delta"] is not None     # raw price-implied fallback
    assert mv["agreement"] in ("toward", "away", "neutral")  # lower confidence


# ── PASS lean: raw movement, but no toward/away verdict ───────────────────────
def test_pass_lean_no_agreement():
    snaps = [
        ml("NYY", -130, 180), ml("BOS", +110, 180),
        ml("NYY", -150, 10), ml("BOS", +130, 10),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="PASS", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["source"] == "live"
    assert mv["side"] == "market"
    assert mv["agreement"] is None
    assert mv["label"] is None
    assert mv["american_delta"] is not None     # raw movement still surfaced


# ── ml_lean stored as HOME/AWAY (uppercase) resolves correctly ────────────────
def test_uppercase_lean_resolves():
    snaps = [
        ml("NYY", -130, 180), ml("BOS", +110, 180),
        ml("NYY", -150, 10), ml("BOS", +130, 10),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="HOME", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["side"] == "home"
    assert mv["agreement"] == "toward"


# ── Same-book guard: zero-price sentinel rows are filtered out ─────────────────
def test_zero_price_sentinel_filtered():
    snaps = [
        ml("NYY", 0, 200), ml("BOS", 0, 200),       # sentinel — ignored
        ml("NYY", -130, 180), ml("BOS", +110, 180),
        ml("NYY", -150, 10), ml("BOS", +130, 10),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    # open must be -130 (the sentinel -130-minute row is dropped), not 0.
    assert mv["open"]["american"] == -130


# ── Selection resolution: full team names resolve to the right side ───────────
def test_full_team_name_selection_resolves():
    snaps = [
        ml("New York Yankees", -130, 180), ml("Boston Red Sox", +110, 180),
        ml("New York Yankees", -150, 10), ml("Boston Red Sox", +130, 10),
    ]
    mv = compute_movement(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        leaned_side="home", home_abbr="NYY", away_abbr="BOS",
    )
    assert mv["side"] == "home"
    assert mv["agreement"] == "toward"


# ── resolve_open_close_snapshots picks earliest=open, latest=close ────────────
# ── Endpoint wiring: movement is attached to slate live_odds + fair-value ─────
def test_movement_wired_into_endpoints():
    from datetime import date

    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.api.routes import _ANALYSIS_CACHE, _get_db, app
    from app.config import get_settings
    from app.database import Base
    from app.models.entities import Team
    from app.models.games import Game
    from app.models.odds import OddsSnapshotRow

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    book = get_settings().preferred_bookmaker
    first_pitch = datetime(2026, 5, 15, 23, 5, tzinfo=timezone.utc)

    def snap(selection, odds, mins_before, market="moneyline", line=None):
        return OddsSnapshotRow(
            game_id=10, bookmaker=book, market=market, selection=selection,
            line=line, american_odds=odds, captured_at=first_pitch - timedelta(minutes=mins_before),
        )

    with Session() as s:
        s.add(Team(id=110, abbr="BAL", name="Orioles", league="AL", division="East"))
        s.add(Team(id=111, abbr="BOS", name="Red Sox", league="AL", division="East"))
        s.add(Game(
            id=10, game_date=date(2026, 5, 15), game_time_utc=first_pitch.replace(tzinfo=None),
            home_team_id=110, away_team_id=111, venue="Camden", status="Preview",
            is_doubleheader=False, game_number=1,
        ))
        # Open + close, both sides, BAL (home) shortens.
        s.add_all([
            snap("orioles", -120, 180), snap("red sox", +100, 180),
            snap("orioles", -150, 10), snap("red sox", +130, 10),
        ])
        s.commit()

    _ANALYSIS_CACHE.clear()
    app.dependency_overrides[_get_db] = lambda: Session()
    try:
        client = TestClient(app)
        fv = client.get("/games/10/fair-value")
        assert fv.status_code == 200
        body = fv.json()
        mv = body["moneyline"]["movement"]
        assert mv is not None
        assert mv["source"] == "live"
        assert mv["open"]["american"] == -120
        assert mv["close"]["american"] == -150
        # total block carries an honest empty state (no total snapshots captured).
        assert body["total"]["movement"]["source"] == "no_book_snapshots"

        slate = client.get("/games/slate?game_date=2026-05-15")
        assert slate.status_code == 200
        games = slate.json()
        assert games and "movement" in games[0]["live_odds"]["moneyline"]
    finally:
        app.dependency_overrides.pop(_get_db, None)
        _ANALYSIS_CACHE.clear()


def test_resolver_open_is_earliest_close_is_latest():
    snaps = [
        ml("NYY", -130, 180), ml("NYY", -140, 90), ml("NYY", -150, 10),
        ml("BOS", +110, 180), ml("BOS", +130, 10),
    ]
    res = resolve_open_close_snapshots(
        market="moneyline", snapshots=snaps, game_start=FIRST_PITCH,
        home_abbr="NYY", away_abbr="BOS",
    )
    home_ep = res["home"]
    assert home_ep.open.american_odds == -130     # earliest
    assert home_ep.close.american_odds == -150    # latest
    assert home_ep.distinct_captures == 3
