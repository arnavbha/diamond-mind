"""Live-monitoring tests: parse_live, derive_live_alert, and GET /games/{id}/live.

Monitoring-only feature — these assert the structural alert fires under the
exact conditions in scope (LEAN/STRONG LEAN + starter pulled in innings 2-5),
never otherwise, and that the language stays verification-only (no banned
betting words).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.routes import _get_db, app
from app.database import Base
from app.ingestion.mlb_stats_api import parse_live
from app.live.alerts import derive_live_alert
from app.models.entities import Team
from app.models.games import Game
from app.models.live import LiveGameState


_BANNED_WORDS = ["lock", "guaranteed", "hammer", "free money", "must bet"]


# ---------------------------------------------------------------------------
# parse_live
# ---------------------------------------------------------------------------

LIVE_PAYLOAD = {
    "gameData": {"status": {"detailedState": "In Progress"}},
    "liveData": {
        "linescore": {
            "currentInning": 4,
            "isTopInning": False,
            "outs": 2,
            "offense": {"first": {"id": 1}, "third": {"id": 2}},
            "teams": {"home": {"runs": 3}, "away": {"runs": 1}},
        },
        "plays": {
            "currentPlay": {
                "matchup": {"pitcher": {"id": 999, "fullName": "Relief Guy"}}
            }
        },
        "boxscore": {
            "teams": {
                "home": {
                    "team": {"id": 110},
                    "players": {
                        "ID999": {"stats": {"pitching": {"numberOfPitches": 41}}}
                    },
                },
                "away": {"team": {"id": 111}, "players": {}},
            }
        },
    },
}


def test_parse_live_happy_path():
    snap = parse_live(LIVE_PAYLOAD)
    assert snap.status == "In Progress"
    assert snap.inning == 4
    assert snap.inning_half == "bottom"
    assert snap.outs == 2
    assert snap.on_first is True
    assert snap.on_second is False
    assert snap.on_third is True
    assert snap.home_score == 3
    assert snap.away_score == 1
    assert snap.current_pitcher_id == 999
    assert snap.current_pitcher_name == "Relief Guy"
    assert snap.current_pitcher_team_id == 110
    assert snap.pitch_count == 41


def test_parse_live_empty_payload_no_crash():
    snap = parse_live({})
    assert snap.status is None
    assert snap.inning is None
    assert snap.inning_half is None
    assert snap.outs is None
    assert snap.on_first is False
    assert snap.home_score is None
    assert snap.current_pitcher_id is None
    assert snap.pitch_count is None


def test_parse_live_missing_linescore_no_crash():
    payload = {
        "gameData": {"status": {"detailedState": "In Progress"}},
        "liveData": {"plays": {}},
    }
    snap = parse_live(payload)
    assert snap.status == "In Progress"
    assert snap.inning is None
    assert snap.current_pitcher_id is None


# ---------------------------------------------------------------------------
# derive_live_alert
# ---------------------------------------------------------------------------

def _analysis(tier="LEAN", lean="HOME", home_wp=0.54):
    return {
        "ml_tier": tier,
        "ml_lean": lean,
        "home_team_abbr": "CWS",
        "away_team_abbr": "DET",
        "model_home_win_prob": home_wp,
        "model_away_win_prob": 1.0 - home_wp,
    }


def _game(home_starter=500, away_starter=600):
    return SimpleNamespace(
        home_team_id=110,
        away_team_id=111,
        home_probable_starter_id=home_starter,
        away_probable_starter_id=away_starter,
    )


def _live(current_pitcher_id=999, inning=3):
    return SimpleNamespace(current_pitcher_id=current_pitcher_id, inning=inning)


def _bullpen(vuln=78.0):
    return SimpleNamespace(vulnerability_score=vuln)


def test_alert_fires_on_lean_starter_pulled_inning_3():
    alert = derive_live_alert(_live(999, 3), _analysis(), _game(), _bullpen())
    assert alert is not None
    assert alert["kind"] == "starter_pulled_early"
    assert alert["side"] == "HOME"
    assert alert["bullpen_vuln"] == 78
    assert "78/100" in alert["headline"]
    assert "CWS 54%" in alert["detail"]
    assert alert["label"] == "Monitoring alert — not a pick"
    assert alert["pregame_win_prob"] == pytest.approx(0.54)


def test_alert_fires_on_strong_lean():
    alert = derive_live_alert(_live(999, 5), _analysis(tier="STRONG LEAN"), _game(), _bullpen())
    assert alert is not None
    assert alert["pregame_tier"] == "STRONG LEAN"


def test_alert_none_on_pass():
    assert derive_live_alert(_live(999, 3), _analysis(tier="PASS", lean="PASS"), _game(), _bullpen()) is None


def test_alert_none_inning_too_late():
    assert derive_live_alert(_live(999, 7), _analysis(), _game(), _bullpen()) is None
    assert derive_live_alert(_live(999, 8), _analysis(), _game(), _bullpen()) is None


def test_alert_none_inning_too_early():
    assert derive_live_alert(_live(999, 1), _analysis(), _game(), _bullpen()) is None


def test_alert_none_starter_still_pitching():
    # current pitcher == leaning side's probable starter (home starter 500)
    assert derive_live_alert(_live(500, 3), _analysis(), _game(), _bullpen()) is None


def test_alert_none_null_current_pitcher():
    assert derive_live_alert(_live(None, 3), _analysis(), _game(), _bullpen()) is None


def test_alert_none_null_starter_id():
    assert derive_live_alert(_live(999, 3), _analysis(), _game(home_starter=None), _bullpen()) is None


def test_alert_away_side_uses_away_starter_and_prob():
    alert = derive_live_alert(
        _live(999, 4), _analysis(lean="AWAY", home_wp=0.43), _game(), _bullpen(vuln=65)
    )
    assert alert is not None
    assert alert["side"] == "AWAY"
    assert "DET 57%" in alert["detail"]  # away wp = 1 - 0.43 = 0.57
    assert alert["bullpen_vuln"] == 65


def test_alert_language_is_verification_only():
    alert = derive_live_alert(_live(999, 3), _analysis(), _game(), _bullpen())
    assert alert is not None
    blob = (alert["headline"] + " " + alert["detail"] + " " + alert["label"]).lower()
    assert "not a pick" in blob
    for word in _BANNED_WORDS:
        assert word not in blob


# ---------------------------------------------------------------------------
# GET /games/{id}/live
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    with Session() as session:
        session.add(Team(id=110, abbr="CWS", name="White Sox", league="AL", division="Central"))
        session.add(Team(id=111, abbr="DET", name="Tigers", league="AL", division="Central"))
        session.add(
            Game(
                id=10,
                game_date=date(2026, 5, 15),
                home_team_id=110,
                away_team_id=111,
                status="In Progress",
                home_score=None,
                away_score=None,
            )
        )
        session.commit()

    def override_db():
        with Session() as session:
            yield session

    app.dependency_overrides[_get_db] = override_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_live_endpoint_no_row_returns_no_signal(client):
    res = client.get("/games/10/live")
    assert res.status_code == 200
    data = res.json()
    assert data["game_id"] == 10
    assert data["is_live"] is False
    assert data["alert"] is None
    assert data["stale"] is True
    assert data["captured_at"] is None


def test_live_endpoint_unknown_game_no_signal(client):
    res = client.get("/games/99999/live")
    assert res.status_code == 200
    data = res.json()
    assert data["is_live"] is False
    assert data["alert"] is None
    assert data["stale"] is True
