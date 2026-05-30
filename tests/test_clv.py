"""CLV resolver + compute tests.

Covers: pick beats close, pick worse than close, exact match, no pre-start
snapshot (null), a post-first-pitch live snapshot is IGNORED (anti-lookahead),
totals selection + line matching, ML selection matching via abbr resolution,
one-sided close, tz-aware vs naive comparison, and the DB-backed wrapper.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.betting.clv import (
    compute_clv,
    compute_clv_for_bet,
    resolve_closing_snapshots,
)
from app.betting.quant import shin_probabilities


FIRST_PITCH = datetime(2026, 5, 15, 23, 5, tzinfo=timezone.utc)


def _snap(market, selection, odds, *, line=None, minutes_before=10, captured_at=None):
    if captured_at is None:
        captured_at = FIRST_PITCH - timedelta(minutes=minutes_before)
    return SimpleNamespace(
        market=market,
        selection=selection,
        line=line,
        american_odds=odds,
        captured_at=captured_at,
    )


# ── ML selection matching ─────────────────────────────────────────────────────
def test_ml_selection_matching_full_name_and_abbr():
    """Snapshot selection is a full lowercase team name; bet.selection is abbr."""
    snaps = [
        _snap("moneyline", "new york yankees", -150),
        _snap("moneyline", "boston red sox", +130),
    ]
    res = resolve_closing_snapshots(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert res.picked is not None
    assert res.picked.american_odds == -150
    assert res.opponent is not None
    assert res.opponent.american_odds == +130


def test_ml_abbr_alias_az_ari():
    """AZ snapshot abbr must normalize to ARI to match a bet on ARI."""
    snaps = [
        _snap("moneyline", "az", -110),
        _snap("moneyline", "los angeles dodgers", -110),
    ]
    res = resolve_closing_snapshots(
        market="moneyline",
        picked_selection="ARI",
        total_line=None,
        home_abbr="ARI",
        away_abbr="LAD",
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert res.picked is not None and res.picked.american_odds == -110
    assert res.opponent is not None and res.opponent.american_odds == -110


# ── CLV direction: beats / worse / exact ──────────────────────────────────────
def _ml_clv(pick_odds, opp_odds, close_pick_odds, close_opp_odds, market_implied):
    snaps = [
        _snap("moneyline", "new york yankees", close_pick_odds),
        _snap("moneyline", "boston red sox", close_opp_odds),
    ]
    return compute_clv(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=pick_odds,
        market_implied_prob_at_pick=market_implied,
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )


def test_pick_beats_close():
    """Pick taken at +130 (lower implied prob); close moves to -150 (higher
    implied) on the picked side → closing_implied_prob > pick anchor → beat."""
    # market_implied at pick = devig of the pick's own market (pick +130 vs opp -150)
    p_pick, _, _, _ = shin_probabilities(+130, -150)
    out = _ml_clv(
        pick_odds=+130, opp_odds=-150,
        close_pick_odds=-150, close_opp_odds=+130,
        market_implied=round(p_pick, 4),
    )
    assert out["closing_implied_prob"] is not None
    assert out["clv_pct"] is not None
    assert out["clv_pct"] > 0
    assert out["beat_close"] is True
    assert out["clv_source"] == "live"


def test_pick_worse_than_close():
    """Pick taken at -150; close drifts to +130 on the picked side → closing
    implied prob LOWER than pick anchor → clv negative, did not beat."""
    p_pick, _, _, _ = shin_probabilities(-150, +130)
    out = _ml_clv(
        pick_odds=-150, opp_odds=+130,
        close_pick_odds=+130, close_opp_odds=-150,
        market_implied=round(p_pick, 4),
    )
    assert out["clv_pct"] is not None
    assert out["clv_pct"] < 0
    assert out["beat_close"] is False


def test_exact_match_close_equals_pick():
    """Close identical to pick line → clv_pct ≈ 0, beat_close False."""
    p_pick, _, _, _ = shin_probabilities(-150, +130)
    out = _ml_clv(
        pick_odds=-150, opp_odds=+130,
        close_pick_odds=-150, close_opp_odds=+130,
        market_implied=round(p_pick, 4),
    )
    assert out["clv_pct"] == pytest.approx(0.0, abs=1e-4)
    assert out["beat_close"] is False  # strictly > 0 required to beat


# ── Anti-lookahead ────────────────────────────────────────────────────────────
def test_no_pre_start_snapshot_is_null():
    out = compute_clv(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=-150,
        market_implied_prob_at_pick=0.6,
        snapshots=[],
        game_start=FIRST_PITCH,
    )
    assert out["closing_odds"] is None
    assert out["clv_pct"] is None
    assert out["beat_close"] is None
    assert out["clv_source"] == "no_close_captured"


def test_post_first_pitch_snapshot_is_ignored():
    """A live in-game snapshot (captured AFTER first pitch) must NEVER be used."""
    after = FIRST_PITCH + timedelta(minutes=30)
    snaps = [
        _snap("moneyline", "new york yankees", -200, captured_at=after),
        _snap("moneyline", "boston red sox", +170, captured_at=after),
    ]
    out = compute_clv(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=-150,
        market_implied_prob_at_pick=0.6,
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert out["closing_odds"] is None
    assert out["clv_source"] == "no_close_captured"


def test_pre_pitch_chosen_over_later_post_pitch():
    """When both pre- and post-pitch rows exist, the LAST pre-pitch row wins."""
    pre_old = _snap("moneyline", "new york yankees", -120, minutes_before=120)
    pre_new = _snap("moneyline", "new york yankees", -140, minutes_before=5)
    post = _snap("moneyline", "new york yankees", -300,
                 captured_at=FIRST_PITCH + timedelta(minutes=10))
    opp = _snap("moneyline", "boston red sox", +120, minutes_before=5)
    res = resolve_closing_snapshots(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        snapshots=[pre_old, post, pre_new, opp],
        game_start=FIRST_PITCH,
    )
    assert res.picked.american_odds == -140  # latest PRE-pitch, not -300 post


def test_null_game_start():
    out = compute_clv(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=-150,
        market_implied_prob_at_pick=0.6,
        snapshots=[_snap("moneyline", "new york yankees", -150)],
        game_start=None,
    )
    assert out["clv_source"] == "no_first_pitch"
    assert out["closing_odds"] is None


# ── One-sided close ───────────────────────────────────────────────────────────
def test_one_sided_close_stores_price_clv_but_no_devig():
    snaps = [_snap("moneyline", "new york yankees", -150)]  # only picked side
    out = compute_clv(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=-120,
        market_implied_prob_at_pick=0.55,
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert out["closing_implied_prob"] is None
    assert out["clv_pct"] is None
    assert out["closing_odds"] == -150
    assert out["price_clv"] is not None  # picked-side raw price CLV available
    assert out["clv_source"] == "one_sided_close"


# ── Totals ────────────────────────────────────────────────────────────────────
def test_total_selection_and_line_matching():
    snaps = [
        _snap("total", "over", -105, line=8.5),
        _snap("total", "under", -115, line=8.5),
    ]
    p_over, _, _, _ = shin_probabilities(-105, -115)
    out = compute_clv(
        market="total",
        picked_selection="OVER",
        total_line=8.5,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=+100,
        market_implied_prob_at_pick=round(p_over, 4) - 0.03,
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert out["closing_odds"] == -105
    assert out["closing_line"] == 8.5
    assert out["closing_implied_prob"] == pytest.approx(round(p_over, 4), abs=1e-3)
    assert out["clv_source"] == "live"


def test_total_line_mismatch_flagged():
    """Pick at 8.5 but book only has 9.0 pre-pitch → mismatch flag."""
    snaps = [
        _snap("total", "over", -110, line=9.0),
        _snap("total", "under", -110, line=9.0),
    ]
    out = compute_clv(
        market="total",
        picked_selection="OVER",
        total_line=8.5,
        home_abbr="NYY",
        away_abbr="BOS",
        american_odds_at_pick=-110,
        market_implied_prob_at_pick=0.5,
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert out["closing_odds"] == -110
    assert out["closing_line"] == 9.0
    assert out["clv_source"] == "total-line-mismatch"


def test_total_case_insensitive_side():
    snaps = [
        _snap("total", "OVER", -105, line=8.5),
        _snap("total", "UNDER", -115, line=8.5),
    ]
    res = resolve_closing_snapshots(
        market="total",
        picked_selection="UNDER",
        total_line=8.5,
        home_abbr="NYY",
        away_abbr="BOS",
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert res.picked is not None and res.picked.american_odds == -115
    assert res.opponent is not None and res.opponent.american_odds == -105


# ── Timezone: naive (SQLite read-back) vs aware ───────────────────────────────
def test_naive_captured_at_compared_against_aware_first_pitch():
    """SQLite returns naive datetimes; first pitch is tz-aware. Must not raise
    and must correctly treat naive-UTC wall-clock as before/after first pitch."""
    naive_pre = (FIRST_PITCH - timedelta(minutes=10)).replace(tzinfo=None)
    naive_post = (FIRST_PITCH + timedelta(minutes=10)).replace(tzinfo=None)
    snaps = [
        _snap("moneyline", "new york yankees", -150, captured_at=naive_pre),
        _snap("moneyline", "boston red sox", +130, captured_at=naive_pre),
        _snap("moneyline", "new york yankees", -400, captured_at=naive_post),
    ]
    res = resolve_closing_snapshots(
        market="moneyline",
        picked_selection="NYY",
        total_line=None,
        home_abbr="NYY",
        away_abbr="BOS",
        snapshots=snaps,
        game_start=FIRST_PITCH,
    )
    assert res.picked.american_odds == -150  # naive-pre selected, naive-post excluded


def test_no_pick_anchor_when_market_implied_null():
    """No vig-free pick anchor → clv_pct null but closing_implied_prob real."""
    out = _ml_clv(
        pick_odds=-150, opp_odds=+130,
        close_pick_odds=-150, close_opp_odds=+130,
        market_implied=None,
    )
    assert out["closing_implied_prob"] is not None
    assert out["clv_pct"] is None
    assert out["clv_source"] == "no_pick_anchor"


# ── DB-backed wrapper ─────────────────────────────────────────────────────────
@pytest.fixture
def db_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.database import Base
    import app.models.odds  # noqa: F401  — register OddsSnapshotRow on Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as s:
        yield s


def test_compute_clv_for_bet_db_roundtrip(db_session):
    from app.models.odds import OddsSnapshotRow

    db_session.add_all([
        OddsSnapshotRow(
            game_id=1, bookmaker="dk", market="moneyline",
            selection="new york yankees", line=None, american_odds=-150,
            captured_at=FIRST_PITCH - timedelta(minutes=5),
        ),
        OddsSnapshotRow(
            game_id=1, bookmaker="dk", market="moneyline",
            selection="boston red sox", line=None, american_odds=+130,
            captured_at=FIRST_PITCH - timedelta(minutes=5),
        ),
        # post-pitch live row that must be ignored
        OddsSnapshotRow(
            game_id=1, bookmaker="dk", market="moneyline",
            selection="new york yankees", line=None, american_odds=-500,
            captured_at=FIRST_PITCH + timedelta(minutes=20),
        ),
    ])
    db_session.commit()

    p_pick, _, _, _ = shin_probabilities(+130, -150)
    bet = SimpleNamespace(
        game_id=1, market="moneyline", selection="NYY", total_line=None,
        home_team_abbr="NYY", away_team_abbr="BOS",
        american_odds=+130, market_implied_prob=round(p_pick, 4),
    )
    game = SimpleNamespace(game_time_utc=FIRST_PITCH)
    out = compute_clv_for_bet(db_session, bet, game)
    assert out["closing_odds"] == -150  # pre-pitch picked side, not -500 post
    assert out["clv_pct"] is not None and out["clv_pct"] > 0
    assert out["beat_close"] is True
    assert out["clv_source"] == "live"


def test_compute_clv_for_bet_no_game(db_session):
    bet = SimpleNamespace(
        game_id=99, market="moneyline", selection="NYY", total_line=None,
        home_team_abbr="NYY", away_team_abbr="BOS",
        american_odds=-150, market_implied_prob=0.6,
    )
    out = compute_clv_for_bet(db_session, bet, None)
    assert out["closing_odds"] is None
    assert out["clv_source"] in ("no_first_pitch", "no_close_captured")
