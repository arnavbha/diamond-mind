"""Phase 7 tests: MLB Stats API parse helpers and DB upserts."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.database import Base
from app.ingestion.mlb_stats_api import (
    _parse_ip,
    ingest_boxscore,
    ingest_schedule,
    ingest_teams,
    parse_boxscore,
    parse_player_detail,
    parse_roster,
    parse_schedule,
    parse_teams,
    upsert_player,
    upsert_team,
)
from app.models.entities import Player, Team
from app.models.games import Game, PitcherGameLog, PlayerGameLog, TeamGameLog


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    engine.dispose()


SCHEDULE_PAYLOAD = {
    "dates": [{
        "date": "2026-05-15",
        "games": [
            {
                "gamePk": 778001,
                "gameDate": "2026-05-15T23:05:00Z",
                "status": {"detailedState": "Scheduled"},
                "doubleHeader": "N",
                "gameNumber": 1,
                "venue": {"name": "Citizens Bank Park"},
                "teams": {
                    "home": {
                        "team": {"id": 143},
                        "probablePitcher": {"id": 554430, "fullName": "Zack Wheeler"},
                    },
                    "away": {
                        "team": {"id": 121},
                        "probablePitcher": {"id": 592789, "fullName": "Sean Manaea"},
                    },
                },
            },
            {
                "gamePk": 778002,
                "status": {"detailedState": "Final"},
                "doubleHeader": "N",
                "gameNumber": 1,
                "venue": {"name": "Citi Field"},
                "teams": {
                    "home": {"team": {"id": 121}},
                    "away": {"team": {"id": 143}},
                },
            },
        ],
    }],
}

TEAMS_PAYLOAD = {
    "teams": [
        {
            "id": 143,
            "abbreviation": "PHI",
            "teamName": "Phillies",
            "league": {"name": "National League"},
            "division": {"name": "NL East"},
        },
        {
            "id": 121,
            "abbreviation": "NYM",
            "teamName": "Mets",
            "league": {"name": "National League"},
            "division": {"name": "NL East"},
        },
    ]
}

ROSTER_PAYLOAD = {
    "roster": [
        {"person": {"id": 547180, "fullName": "Bryce Harper"}, "position": {"abbreviation": "1B"}},
        {"person": {"id": 554430, "fullName": "Zack Wheeler"}, "position": {"abbreviation": "P"}},
    ]
}

PLAYER_PAYLOAD = {
    "people": [{
        "id": 554430,
        "fullName": "Zack Wheeler",
        "primaryPosition": {"abbreviation": "P"},
        "batSide": {"code": "L"},
        "pitchHand": {"code": "R"},
        "currentTeam": {"id": 143},
    }]
}

BOXSCORE_PAYLOAD = {
    "teams": {
        "home": {
            "team": {"id": 143},
            "teamStats": {
                "batting": {"runs": 5, "hits": 9},
                "fielding": {"errors": 0},
            },
            "battingOrder": [],
            "players": {
                "ID554430": {
                    "person": {"id": 554430, "fullName": "Zack Wheeler"},
                    "position": {"abbreviation": "P"},
                    "stats": {
                        "pitching": {
                            "gamesPlayed": 1,
                            "gamesStarted": 1,
                            "inningsPitched": "6.0",
                            "battersFaced": 22,
                            "hits": 4,
                            "earnedRuns": 1,
                            "baseOnBalls": 1,
                            "strikeOuts": 8,
                            "homeRuns": 0,
                            "numberOfPitches": 94,
                        },
                        "batting": {},
                    },
                },
                "ID547180": {
                    "person": {"id": 547180, "fullName": "Bryce Harper"},
                    "position": {"abbreviation": "1B"},
                    "stats": {
                        "pitching": {},
                        "batting": {
                            "plateAppearances": 4,
                            "atBats": 4,
                            "hits": 2,
                            "doubles": 1,
                            "triples": 0,
                            "homeRuns": 1,
                            "baseOnBalls": 0,
                            "hitByPitch": 0,
                            "sacFlies": 0,
                            "strikeOuts": 1,
                            "stolenBases": 1,
                            "caughtStealing": 1,
                        },
                    },
                },
            },
        },
        "away": {
            "team": {"id": 121},
            "teamStats": {
                "batting": {"runs": 2, "hits": 5},
                "fielding": {"errors": 1},
            },
            "battingOrder": [],
            "players": {
                "ID592789": {
                    "person": {"id": 592789, "fullName": "Sean Manaea"},
                    "position": {"abbreviation": "P"},
                    "stats": {
                        "pitching": {
                            "gamesPlayed": 1,
                            "gamesStarted": 1,
                            "inningsPitched": "5.2",
                            "battersFaced": 24,
                            "hits": 7,
                            "earnedRuns": 4,
                            "baseOnBalls": 2,
                            "strikeOuts": 5,
                            "homeRuns": 1,
                            "numberOfPitches": 98,
                        },
                        "batting": {},
                    },
                },
            },
        },
    }
}


# ---------------------------------------------------------------------------
# Pure parse tests
# ---------------------------------------------------------------------------

def test_parse_ip():
    assert _parse_ip("6.0") == pytest.approx(6.0)
    assert _parse_ip("6.1") == pytest.approx(6 + 1/3)
    assert _parse_ip("6.2") == pytest.approx(6 + 2/3)
    assert _parse_ip("0.0") == pytest.approx(0.0)


def test_parse_schedule():
    games = parse_schedule(SCHEDULE_PAYLOAD)
    assert len(games) == 2
    g = games[0]
    assert g.game_pk == 778001
    assert g.game_date == date(2026, 5, 15)
    assert g.home_team_id == 143
    assert g.away_team_id == 121
    assert g.home_probable_pitcher_id == 554430
    assert g.home_probable_pitcher_name == "Zack Wheeler"
    assert g.away_probable_pitcher_id == 592789
    assert g.away_probable_pitcher_name == "Sean Manaea"
    assert g.double_header == "N"


def test_parse_schedule_missing_probable():
    g = parse_schedule(SCHEDULE_PAYLOAD)[1]
    assert g.home_probable_pitcher_id is None
    assert g.away_probable_pitcher_id is None


def test_parse_schedule_game_time_utc():
    """game_time_utc parsed from MLB gameDate (ISO-8601 UTC) into tz-aware datetime."""
    from datetime import datetime, timezone
    games = parse_schedule(SCHEDULE_PAYLOAD)
    g0 = games[0]
    assert g0.game_time_utc == datetime(2026, 5, 15, 23, 5, 0, tzinfo=timezone.utc)
    # Second game has no gameDate → None
    assert games[1].game_time_utc is None


def test_parse_schedule_game_time_utc_invalid_payload():
    """Malformed gameDate strings degrade to None, not exceptions."""
    payload = {"dates": [{"date": "2026-05-15", "games": [{
        "gamePk": 1, "gameDate": "not-a-date",
        "status": {"detailedState": "Scheduled"},
        "teams": {"home": {"team": {"id": 1}}, "away": {"team": {"id": 2}}},
    }]}]}
    assert parse_schedule(payload)[0].game_time_utc is None


def test_parse_teams():
    teams = parse_teams(TEAMS_PAYLOAD)
    assert len(teams) == 2
    phi = next(t for t in teams if t["id"] == 143)
    assert phi["abbr"] == "PHI"
    assert phi["name"] == "Phillies"
    assert phi["division"] == "NL East"


def test_parse_roster():
    players = parse_roster(ROSTER_PAYLOAD)
    assert len(players) == 2
    harper = next(p for p in players if p["id"] == 547180)
    assert harper["full_name"] == "Bryce Harper"
    assert harper["primary_position"] == "1B"


def test_parse_player_detail():
    d = parse_player_detail(PLAYER_PAYLOAD)
    assert d["id"] == 554430
    assert d["throws"] == "R"
    assert d["current_team_id"] == 143


def test_parse_boxscore_team_runs():
    batters, pitchers, home, away = parse_boxscore(BOXSCORE_PAYLOAD, 778001, date(2026, 5, 15))
    assert home.runs == 5
    assert away.runs == 2
    assert home.won is True
    assert away.won is False


def test_parse_boxscore_pitcher_lines():
    _, pitchers, _, _ = parse_boxscore(BOXSCORE_PAYLOAD, 778001, date(2026, 5, 15))
    wheeler = next(p for p in pitchers if p.player_id == 554430)
    assert wheeler.started is True
    assert wheeler.innings_pitched == pytest.approx(6.0)
    assert wheeler.strikeouts == 8
    assert wheeler.pitches == 94


def test_parse_boxscore_batter_lines():
    batters, _, _, _ = parse_boxscore(BOXSCORE_PAYLOAD, 778001, date(2026, 5, 15))
    harper = next(b for b in batters if b.player_id == 547180)
    assert harper.hits == 2
    assert harper.home_runs == 1
    assert harper.stolen_bases == 1
    assert harper.caught_stealing == 1


# ---------------------------------------------------------------------------
# DB upsert tests
# ---------------------------------------------------------------------------

def test_upsert_team_creates_and_updates(db):
    upsert_team(db, {"id": 143, "abbr": "PHI", "name": "Phillies", "league": "NL", "division": "NL East"})
    db.flush()
    assert db.get(Team, 143).abbr == "PHI"

    # update
    upsert_team(db, {"id": 143, "abbr": "PHI", "name": "Philadelphia Phillies", "league": "NL", "division": "NL East"})
    db.flush()
    assert db.get(Team, 143).name == "Philadelphia Phillies"


def test_upsert_player_creates_and_updates(db):
    upsert_player(db, {"id": 554430, "full_name": "Zack Wheeler", "primary_position": "P", "throws": "R", "current_team_id": None})
    db.flush()
    assert db.get(Player, 554430).full_name == "Zack Wheeler"

    upsert_player(db, {"id": 554430, "full_name": "Zack Wheeler", "current_team_id": 143})
    db.flush()
    assert db.get(Player, 554430).current_team_id == 143


def test_ingest_teams(db):
    class _FakeClient:
        def fetch_teams(self):
            return TEAMS_PAYLOAD

    count = ingest_teams(db, _FakeClient())
    assert count == 2
    assert db.get(Team, 143) is not None
    assert db.get(Team, 121) is not None


def test_ingest_schedule(db):
    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.flush()

    class _FakeClient:
        def fetch_schedule(self, d, game_type=None):
            assert game_type is None
            return SCHEDULE_PAYLOAD

    pks = ingest_schedule(db, _FakeClient(), date(2026, 5, 15))
    assert set(pks) == {778001, 778002}
    g = db.get(Game, 778001)
    assert g.home_team_id == 143
    assert g.home_probable_starter_id == 554430
    # game_time_utc carried through from MLB Stats API gameDate field.
    # SQLite strips tzinfo so compare naive components (PostgreSQL keeps it).
    from datetime import datetime
    assert g.game_time_utc is not None
    assert g.game_time_utc.replace(tzinfo=None) == datetime(2026, 5, 15, 23, 5, 0)
    assert db.get(Player, 554430).full_name == "Zack Wheeler"
    assert db.get(Player, 554430).primary_position == "P"


def test_ingest_schedule_passes_game_type(db):
    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.flush()

    class _FakeClient:
        seen_game_type = None

        def fetch_schedule(self, d, game_type=None):
            self.seen_game_type = game_type
            return SCHEDULE_PAYLOAD

    client = _FakeClient()
    ingest_schedule(db, client, date(2026, 5, 15), game_type="R")
    assert client.seen_game_type == "R"


def test_ingest_boxscore(db):
    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.add(Player(id=554430, full_name="Zack Wheeler", primary_position="P"))
    db.add(Player(id=547180, full_name="Bryce Harper", primary_position="1B"))
    db.add(Player(id=592789, full_name="Sean Manaea", primary_position="P"))
    db.add(Game(
        id=778001, game_date=date(2026, 5, 15), status="Final",
        home_team_id=143, away_team_id=121, venue="Citizens Bank Park",
        is_doubleheader=False, game_number=1,
    ))
    db.flush()

    class _FakeClient:
        def fetch_boxscore(self, pk):
            return BOXSCORE_PAYLOAD

    ingest_boxscore(db, _FakeClient(), 778001, date(2026, 5, 15))

    from sqlalchemy import select
    team_logs = db.execute(select(TeamGameLog)).scalars().all()
    assert len(team_logs) == 2

    phi_log = next(t for t in team_logs if t.team_id == 143)
    assert phi_log.runs == 5
    assert phi_log.runs_allowed == 2
    assert phi_log.won is True

    pitcher_logs = db.execute(select(PitcherGameLog)).scalars().all()
    assert len(pitcher_logs) == 2
    wheeler = next(p for p in pitcher_logs if p.pitcher_id == 554430)
    assert wheeler.innings_pitched == pytest.approx(6.0)
    assert wheeler.strikeouts == 8

    batter_logs = db.execute(select(PlayerGameLog)).scalars().all()
    harper = next(b for b in batter_logs if b.player_id == 547180)
    assert harper.home_runs == 1


def test_ingest_boxscore_seeds_missing_players(db):
    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.add(Game(
        id=778001, game_date=date(2026, 5, 15), status="Final",
        home_team_id=143, away_team_id=121, venue="Citizens Bank Park",
        is_doubleheader=False, game_number=1,
    ))
    db.flush()

    class _FakeClient:
        def fetch_boxscore(self, pk):
            return BOXSCORE_PAYLOAD

    ingest_boxscore(db, _FakeClient(), 778001, date(2026, 5, 15))

    wheeler = db.get(Player, 554430)
    harper = db.get(Player, 547180)
    assert wheeler is not None
    assert wheeler.full_name == "Zack Wheeler"
    assert wheeler.primary_position == "P"
    assert harper is not None
    assert harper.full_name == "Bryce Harper"
    assert harper.primary_position == "1B"


def test_ingest_boxscore_idempotent(db):
    """Re-ingesting the same box score should not duplicate rows."""
    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.add(Player(id=554430, full_name="Zack Wheeler", primary_position="P"))
    db.add(Player(id=547180, full_name="Bryce Harper", primary_position="1B"))
    db.add(Player(id=592789, full_name="Sean Manaea", primary_position="P"))
    db.add(Game(
        id=778001, game_date=date(2026, 5, 15), status="Final",
        home_team_id=143, away_team_id=121, venue="Citizens Bank Park",
        is_doubleheader=False, game_number=1,
    ))
    db.flush()

    class _FakeClient:
        def fetch_boxscore(self, pk):
            return BOXSCORE_PAYLOAD

    ingest_boxscore(db, _FakeClient(), 778001, date(2026, 5, 15))
    ingest_boxscore(db, _FakeClient(), 778001, date(2026, 5, 15))

    from sqlalchemy import select
    assert len(db.execute(select(PitcherGameLog)).scalars().all()) == 2
    assert len(db.execute(select(TeamGameLog)).scalars().all()) == 2


# ---------------------------------------------------------------------------
# Score write-back tests
# ---------------------------------------------------------------------------

def test_ingest_boxscore_writes_game_scores(db):
    """ingest_boxscore() must update Game.home_score / Game.away_score."""
    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.add(Player(id=554430, full_name="Zack Wheeler", primary_position="P"))
    db.add(Player(id=547180, full_name="Bryce Harper", primary_position="1B"))
    db.add(Player(id=592789, full_name="Sean Manaea", primary_position="P"))
    db.add(Game(
        id=778001, game_date=date(2026, 5, 15), status="Final",
        home_team_id=143, away_team_id=121, venue="Citizens Bank Park",
        is_doubleheader=False, game_number=1,
    ))
    db.flush()

    class _FakeClient:
        def fetch_boxscore(self, pk):
            return BOXSCORE_PAYLOAD

    ingest_boxscore(db, _FakeClient(), 778001, date(2026, 5, 15))

    game = db.get(Game, 778001)
    assert game.home_score == 5   # PHI runs from BOXSCORE_PAYLOAD
    assert game.away_score == 2   # NYM runs from BOXSCORE_PAYLOAD


SCHEDULE_PAYLOAD_WITH_SCORES = {
    "dates": [{
        "date": "2026-05-15",
        "games": [{
            "gamePk": 778003,
            "status": {"detailedState": "Final"},
            "doubleHeader": "N",
            "gameNumber": 1,
            "venue": {"name": "Citizens Bank Park"},
            "teams": {
                "home": {"team": {"id": 143}, "score": 7},
                "away": {"team": {"id": 121}, "score": 3},
            },
        }],
    }],
}


def test_upsert_game_writes_scores_from_schedule_for_terminal_game(db):
    """upsert_game() must write home_score/away_score when the status is terminal
    and the schedule payload includes scores."""
    from app.ingestion.mlb_stats_api import upsert_game

    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    # First pass: create the game as Scheduled (no scores).
    db.add(Game(
        id=778003, game_date=date(2026, 5, 15), status="Scheduled",
        home_team_id=143, away_team_id=121, venue="Citizens Bank Park",
        is_doubleheader=False, game_number=1,
    ))
    db.flush()

    # Second pass: schedule poll returns Final with scores.
    scheduled = parse_schedule(SCHEDULE_PAYLOAD_WITH_SCORES)
    assert len(scheduled) == 1
    g = scheduled[0]
    assert g.home_score == 7
    assert g.away_score == 3

    upsert_game(db, g)
    db.flush()

    game = db.get(Game, 778003)
    assert game.status == "Final"
    assert game.home_score == 7
    assert game.away_score == 3


def test_upsert_game_does_not_overwrite_scores_for_non_terminal_game(db):
    """upsert_game() must NOT write scores when the status is not terminal."""
    from app.ingestion.mlb_stats_api import upsert_game

    db.add(Team(id=143, abbr="PHI", name="Phillies"))
    db.add(Team(id=121, abbr="NYM", name="Mets"))
    db.add(Game(
        id=778004, game_date=date(2026, 5, 15), status="In Progress",
        home_team_id=143, away_team_id=121, venue="Citizens Bank Park",
        is_doubleheader=False, game_number=1,
        home_score=None, away_score=None,
    ))
    db.flush()

    # Schedule payload with a mid-game score but non-terminal status.
    in_progress_payload = {
        "dates": [{
            "date": "2026-05-15",
            "games": [{
                "gamePk": 778004,
                "status": {"detailedState": "In Progress"},
                "doubleHeader": "N",
                "gameNumber": 1,
                "venue": {"name": "Citizens Bank Park"},
                "teams": {
                    "home": {"team": {"id": 143}, "score": 2},
                    "away": {"team": {"id": 121}, "score": 1},
                },
            }],
        }],
    }
    [g] = parse_schedule(in_progress_payload)
    upsert_game(db, g)
    db.flush()

    game = db.get(Game, 778004)
    assert game.home_score is None
    assert game.away_score is None
