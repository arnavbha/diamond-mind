"""FastAPI routes — data query layer for the web frontend.

All endpoints are read-only. They query the DB via Track A's form helpers
and return dataclass-compatible JSON. The Next.js/React frontend (Track B)
consumes these via HTTP.

Run with:
    uvicorn app.api.routes:app --reload --port 8000
"""

from __future__ import annotations

import dataclasses
import logging
import math
import os
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session

from app.config import get_settings
from app.contracts import PitcherFormWindow, TrendLabel, WindowKey
from app.database import SessionLocal, engine, Base
from app.ingestion.park_factors import get_park_factor
from app.features.recent_form import (
    FIP_CONSTANT,
    build_bullpen_state,
    build_hitter_form_window,
    build_starter_form_window,
    build_team_form_window,
    load_hitter_form_window,
    load_team_form_window,
)
from app.features.bullpen_vulnerability import score_bullpen
from app.models.entities import Player, Team
from app.models.games import Game, PitcherGameLog, PlayerGameLog, TeamGameLog
from app.models.tracker import BetRecord, ExcludedPick, compute_units_returned

# Import all models so Base.metadata knows about every table, then create
# any that don't exist yet (safe on both SQLite and Postgres — additive only).
import app.models.players  # noqa: F401
import app.models.bullpen  # noqa: F401
import app.models.odds     # noqa: F401
import app.models.reports  # noqa: F401
Base.metadata.create_all(engine)

# Additive column migrations that `create_all` can't handle on existing tables.
from app.migrations import apply_lightweight_migrations  # noqa: E402
apply_lightweight_migrations(engine)

app = FastAPI(
    title="Diamond Mind API",
    description=(
        "Deterministic MLB betting intelligence. All analysis is math-based — "
        "no LLM inference, no fabricated stats. Data sourced from MLB Stats API "
        "and The Odds API."
    ),
    version="0.4.0",
    docs_url="/docs",
    redoc_url="/redoc",
)


def _warmup_today() -> None:
    """Pre-warm the analysis cache for today's slate in the background.

    Runs once at startup in a daemon thread so the first real request is served
    from cache instead of computing everything cold. Uses the same parallelism
    as the slate endpoint (ThreadPoolExecutor, one session per thread).
    """
    today = date.today()
    try:
        with SessionLocal() as db:
            from app.models.games import Game as GameModel
            rows = db.execute(
                select(GameModel.id).where(GameModel.game_date == today)
            ).scalars().all()

        if not rows:
            return

        logging.getLogger(__name__).info(
            "Startup warmup: pre-computing analysis for %d games on %s", len(rows), today
        )

        def _warm_one(game_id: int) -> None:
            with SessionLocal() as thread_db:
                _build_analysis_cached(game_id, today, thread_db)

        with ThreadPoolExecutor(max_workers=min(len(rows), 8)) as pool:
            list(pool.map(_warm_one, rows))

        logging.getLogger(__name__).info("Startup warmup complete for %s", today)
    except Exception as exc:
        logging.getLogger(__name__).warning("Startup warmup failed: %s", exc)


@app.on_event("startup")
async def startup_warmup() -> None:
    """Kick off cache warmup in a daemon thread — doesn't block server start."""
    t = threading.Thread(target=_warmup_today, daemon=True, name="cache-warmup")
    t.start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Analysis result cache  (game_id, as_of_date) → (result_dict, expires_at)
# 5-minute TTL — analysis is deterministic given the DB snapshot, but odds
# and ingested stats can change, so we don't cache indefinitely.
# ---------------------------------------------------------------------------
_ANALYSIS_CACHE: Dict[Tuple[int, date], Tuple[Any, float]] = {}
_CACHE_TTL_SECONDS = 300

def _cache_get(game_id: int, as_of: date) -> Optional[Any]:
    entry = _ANALYSIS_CACHE.get((game_id, as_of))
    if entry and time.monotonic() < entry[1]:
        return entry[0]
    _ANALYSIS_CACHE.pop((game_id, as_of), None)
    return None

def _cache_set(game_id: int, as_of: date, value: Any) -> None:
    _ANALYSIS_CACHE[(game_id, as_of)] = (value, time.monotonic() + _CACHE_TTL_SECONDS)

def _cache_invalidate_all() -> int:
    count = len(_ANALYSIS_CACHE)
    _ANALYSIS_CACHE.clear()
    return count


# ---------------------------------------------------------------------------
# Timing middleware — adds X-Response-Time header to every response
# ---------------------------------------------------------------------------
@app.middleware("http")
async def add_timing_header(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - t0) * 1000
    response.headers["X-Response-Time"] = f"{ms:.1f}ms"
    return response


@app.middleware("http")
async def add_cache_control(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path in ("/health", "/cache/clear", "/backtest"):
        response.headers["Cache-Control"] = "no-store"
    elif path == "/model/constants":
        response.headers["Cache-Control"] = "public, max-age=3600"
    elif path in ("/games/slate", "/games/picks") or path.endswith("/analyze") or path.endswith("/context"):
        response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=30"
    elif path.startswith("/games") or path.startswith("/teams") or path.startswith("/pitchers"):
        response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=15"
    return response


def _get_db():
    with SessionLocal() as session:
        yield session


_ADMIN_TOKEN: str | None = os.environ.get("ADMIN_TOKEN")


def _require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Dependency: reject request if ADMIN_TOKEN is set and header doesn't match."""
    if not _ADMIN_TOKEN:
        # Token not configured — open (dev/local mode). Log a warning once.
        return
    if x_admin_token != _ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")


def _dc(obj) -> dict:
    """Serialize a dataclass (including nested ones) to JSON-safe dict."""
    if obj is None:
        return None
    if dataclasses.is_dataclass(obj):
        return {
            k: _dc(v)
            for k, v in dataclasses.asdict(obj).items()
        }
    if isinstance(obj, list):
        return [_dc(item) for item in obj]
    if hasattr(obj, "value"):  # Enum
        return obj.value
    return obj


def _starter_form_or_announced(
    db: Session,
    *,
    pitcher_id: Optional[int],
    window: WindowKey,
    as_of: date,
) -> Optional[PitcherFormWindow]:
    """Return starter form, or a name-only small-sample record for announced SPs."""
    if pitcher_id is None:
        return None
    window_data = build_starter_form_window(
        db,
        pitcher_id=pitcher_id,
        window=window,
        as_of_date=as_of,
    )
    if window_data is not None:
        return window_data

    pitcher = db.get(Player, pitcher_id)
    return PitcherFormWindow(
        pitcher_id=pitcher_id,
        pitcher_name=pitcher.full_name if pitcher is not None else f"Announced starter #{pitcher_id}",
        team_id=(pitcher.current_team_id if pitcher is not None else None) or 0,
        window=window,
        starts=0,
        innings_pitched=0.0,
        era=None,
        whip=None,
        k_per_9=None,
        bb_per_9=None,
        hr_per_9=None,
        avg_innings_per_start=None,
        trend_label=TrendLabel.SMALL_SAMPLE_WARN,
        as_of_date=as_of,
        insufficient_sample=True,
    )


def _safe_rate(num: float, den: float) -> Optional[float]:
    if den == 0:
        return None
    return num / den


def _last_team_game_dates(
    db: Session,
    *,
    team_id: int,
    window: WindowKey,
    as_of: date,
) -> Optional[tuple[date, date]]:
    if window is WindowKey.SEASON:
        return date(as_of.year, 1, 1), as_of
    game_counts = {
        WindowKey.L5: 5,
        WindowKey.L10: 10,
        WindowKey.L20: 20,
    }
    if window not in game_counts:
        raise HTTPException(400, f"Unsupported team window: {window.value}")
    dates = [
        d
        for (d,) in db.execute(
            select(TeamGameLog.game_date)
            .where(TeamGameLog.team_id == team_id, TeamGameLog.game_date <= as_of)
            .order_by(TeamGameLog.game_date.desc())
            .limit(game_counts[window])
        ).all()
    ]
    if not dates:
        return None
    return min(dates), max(dates)


def _pitcher_rows_for_window(
    db: Session,
    *,
    pitcher_id: int,
    window: WindowKey,
    as_of: date,
) -> list[PitcherGameLog]:
    stmt = select(PitcherGameLog).where(
        PitcherGameLog.pitcher_id == pitcher_id,
        PitcherGameLog.game_date <= as_of,
    )
    if window is WindowKey.SEASON:
        return list(
            db.execute(
                stmt.where(PitcherGameLog.game_date >= date(as_of.year, 1, 1))
                .order_by(PitcherGameLog.game_date.desc())
            ).scalars()
        )
    if window is WindowKey.L5:
        limit = 5
    elif window is WindowKey.L10:
        limit = 10
    elif window is WindowKey.L20:
        limit = 20
    elif window is WindowKey.LAST_5_STARTS:
        limit = 5
        stmt = stmt.where(PitcherGameLog.started.is_(True))
    elif window is WindowKey.LAST_10_STARTS:
        limit = 10
        stmt = stmt.where(PitcherGameLog.started.is_(True))
    else:
        raise HTTPException(400, f"Unsupported pitcher window: {window.value}")
    return list(
        db.execute(stmt.order_by(PitcherGameLog.game_date.desc()).limit(limit)).scalars()
    )


@app.get("/health", tags=["meta"])
def health():
    """Fast liveness probe."""
    return {"status": "ok", "version": app.version}


@app.get("/health/detailed", tags=["meta"])
def health_detailed(db: Session = Depends(_get_db)):
    """DB record counts and data-freshness timestamps."""
    from app.models.games import Game, PitcherGameLog, PlayerGameLog, TeamGameLog
    from app.models.odds import OddsSnapshotRow, WeatherSnapshotRow

    def _count(model):
        return db.execute(select(func.count()).select_from(model)).scalar_one()

    def _latest_date(model, col):
        val = db.execute(select(func.max(col))).scalar_one()
        return val.isoformat() if val else None

    games_total      = _count(Game)
    pitcher_logs     = _count(PitcherGameLog)
    player_logs      = _count(PlayerGameLog)
    team_logs        = _count(TeamGameLog)
    odds_snapshots   = _count(OddsSnapshotRow)
    weather_snapshots = _count(WeatherSnapshotRow)

    latest_game      = _latest_date(Game, Game.game_date)
    latest_pitcher   = _latest_date(PitcherGameLog, PitcherGameLog.game_date)
    latest_odds      = db.execute(select(func.max(OddsSnapshotRow.captured_at))).scalar_one()

    return {
        "status": "ok",
        "version": app.version,
        "cache": {
            "entries": len(_ANALYSIS_CACHE),
            "ttl_seconds": _CACHE_TTL_SECONDS,
        },
        "records": {
            "games": games_total,
            "pitcher_logs": pitcher_logs,
            "player_logs": player_logs,
            "team_logs": team_logs,
            "odds_snapshots": odds_snapshots,
            "weather_snapshots": weather_snapshots,
        },
        "freshness": {
            "latest_game_date": latest_game,
            "latest_pitcher_log": latest_pitcher,
            "latest_odds_captured_at": latest_odds.isoformat() if latest_odds else None,
        },
    }


@app.post("/cache/clear", tags=["meta"])
def clear_cache():
    """Flush the analysis result cache (call after ingestion runs)."""
    evicted = _cache_invalidate_all()
    return {"evicted": evicted}


@app.get("/model/constants", tags=["meta"])
def model_constants():
    """Expose all model parameters so the frontend and users can verify the math."""
    from app.betting.game_analyzer import (
        HOME_ADVANTAGE, FIP_SCALE, FIP_CONSTANT, BULLPEN_VULN_SCALE,
        OFFENSE_SCALE, KELLY_FRACTION, WIND_OUT_THRESHOLD_MPH,
        WIND_OUT_DEGREES, REST_ADJ_SHORT, REST_ADJ_LONG,
        TREND_ADJUSTMENTS, RECOMMENDATION_TIERS, PARK_FACTORS,
    )
    return {
        "version": app.version,
        "win_probability": {
            "home_advantage": HOME_ADVANTAGE,
            "home_advantage_note": "2022-2024 MLB home win rate",
            "fip_scale": FIP_SCALE,
            "fip_scale_note": "win-prob shift per 1-run FIP advantage",
            "fip_constant": FIP_CONSTANT,
            "bullpen_vuln_scale": BULLPEN_VULN_SCALE,
            "offense_scale": OFFENSE_SCALE,
        },
        "kelly": {
            "fraction": KELLY_FRACTION,
            "note": "fractional Kelly multiplier (conservative risk management)",
        },
        "weather": {
            "wind_out_threshold_mph": WIND_OUT_THRESHOLD_MPH,
            "wind_out_degrees_range": list(WIND_OUT_DEGREES),
        },
        "rest": {
            "short_rest_days": "< 4",
            "short_rest_adj": REST_ADJ_SHORT,
            "long_rest_days": "≥ 8",
            "long_rest_adj": REST_ADJ_LONG,
            "normal_range": "4–6 days (no adjustment)",
        },
        "trend_adjustments": TREND_ADJUSTMENTS,
        "recommendation_tiers": [
            {"tier": t, "min_edge": me, "min_conf": mc}
            for t, me, mc in RECOMMENDATION_TIERS
        ],
        "park_factors": PARK_FACTORS,
    }


# ---------------------------------------------------------------------------
# Games
# ---------------------------------------------------------------------------

@app.get("/games", tags=["games"])
def list_games(
    game_date: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Return all games scheduled for a date, including team abbreviations."""
    from app.models.entities import Team as TeamModel
    HomeTeam = aliased(TeamModel)
    AwayTeam = aliased(TeamModel)
    rows = db.execute(
        select(Game, HomeTeam, AwayTeam)
        .join(HomeTeam, Game.home_team_id == HomeTeam.id)
        .join(AwayTeam, Game.away_team_id == AwayTeam.id)
        .where(Game.game_date == game_date)
        .order_by(Game.id)
    ).all()
    return [
        {
            "game_id": g.id,
            "game_date": g.game_date.isoformat(),
            "game_time_utc": g.game_time_utc.isoformat() if g.game_time_utc else None,
            "status": g.status,
            "home_team_id": g.home_team_id,
            "home_team_abbr": home.abbr,
            "away_team_id": g.away_team_id,
            "away_team_abbr": away.abbr,
            "venue": g.venue,
            "is_doubleheader": g.is_doubleheader,
            "game_number": g.game_number,
            "home_probable_starter_id": g.home_probable_starter_id,
            "away_probable_starter_id": g.away_probable_starter_id,
            "home_score": g.home_score,
            "away_score": g.away_score,
        }
        for g, home, away in rows
    ]


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

@app.get("/teams", tags=["teams"])
def list_teams(db: Session = Depends(_get_db)):
    teams = db.execute(select(Team)).scalars().all()
    return [
        {"id": t.id, "abbr": t.abbr, "name": t.name,
         "league": t.league, "division": t.division}
        for t in teams
    ]


@app.get("/teams/{team_id}/form", tags=["teams"])
def team_form(
    team_id: int,
    window: str = Query("l10", description="season|l20|l10|l5"),
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    try:
        wk = WindowKey(window)
    except ValueError:
        raise HTTPException(400, f"Unknown window: {window}")

    # Try cached row first, then build fresh.
    w = load_team_form_window(db, team_id=team_id, window=wk, as_of_date=as_of)
    if w is None:
        w = build_team_form_window(db, team_id=team_id, window=wk, as_of_date=as_of)
    if w is None:
        raise HTTPException(404, f"No form data for team {team_id} window={window}")
    return _dc(w)


@app.get("/teams/{team_id}/batting", tags=["teams"])
def team_batting(
    team_id: int,
    window: str = Query("l10", description="season|l20|l10|l5"),
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Aggregate team batting rates from hitter game logs.

    This is intentionally computed from stored box-score counters only. True
    handedness splits require per-PA handedness outcomes and are not available
    in the MVP schema.
    """
    try:
        wk = WindowKey(window)
    except ValueError:
        raise HTTPException(400, f"Unknown window: {window}")

    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(404, f"Team {team_id} not found")

    bounds = _last_team_game_dates(db, team_id=team_id, window=wk, as_of=as_of)
    if bounds is None:
        raise HTTPException(404, f"No batting data for team {team_id}")
    start, end = bounds

    rows = db.execute(
        select(PlayerGameLog).where(
            PlayerGameLog.team_id == team_id,
            PlayerGameLog.game_date >= start,
            PlayerGameLog.game_date <= end,
        )
    ).scalars().all()

    tgl_rows = db.execute(
        select(TeamGameLog.game_id, TeamGameLog.runs).where(
            TeamGameLog.team_id == team_id,
            TeamGameLog.game_date >= start,
            TeamGameLog.game_date <= end,
        )
    ).all()
    game_count = len(tgl_rows)
    total_runs = sum(r for _, r in tgl_rows if r is not None)
    runs_per_game = round(total_runs / game_count, 2) if game_count else None

    pa = sum(r.plate_appearances for r in rows)
    ab = sum(r.at_bats for r in rows)
    hits = sum(r.hits for r in rows)
    doubles = sum(r.doubles for r in rows)
    triples = sum(r.triples for r in rows)
    home_runs = sum(r.home_runs for r in rows)
    walks = sum(r.walks for r in rows)
    strikeouts = sum(r.strikeouts for r in rows)
    hbp = sum(r.hit_by_pitch for r in rows)
    sac_flies = sum(r.sac_flies for r in rows)
    stolen_bases = sum(r.stolen_bases for r in rows)
    caught_stealing = sum(r.caught_stealing for r in rows)
    stolen_base_attempts = stolen_bases + caught_stealing
    singles = hits - doubles - triples - home_runs
    total_bases = singles + 2 * doubles + 3 * triples + 4 * home_runs
    avg = _safe_rate(hits, ab)
    obp = _safe_rate(hits + walks + hbp, ab + walks + hbp + sac_flies)
    slg = _safe_rate(total_bases, ab)
    ops = (obp + slg) if obp is not None and slg is not None else None
    iso = (slg - avg) if slg is not None and avg is not None else None
    woba_denom = ab + walks + hbp + sac_flies
    estimated_woba = _safe_rate(
        0.69 * walks
        + 0.72 * hbp
        + 0.89 * singles
        + 1.27 * doubles
        + 1.62 * triples
        + 2.10 * home_runs,
        woba_denom,
    )
    min_games = 1 if wk is WindowKey.SEASON else 5

    return {
        "team_id": team_id,
        "team_abbr": team.abbr,
        "window": wk.value,
        "as_of_date": as_of.isoformat(),
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "games": game_count,
        "runs_per_game": runs_per_game,
        "plate_appearances": pa,
        "at_bats": ab,
        "hits": hits,
        "doubles": doubles,
        "triples": triples,
        "home_runs": home_runs,
        "walks": walks,
        "strikeouts": strikeouts,
        "hit_by_pitch": hbp,
        "sac_flies": sac_flies,
        "stolen_bases": stolen_bases,
        "caught_stealing": caught_stealing,
        "stolen_base_attempts": stolen_base_attempts,
        "stolen_base_success_rate": _safe_rate(stolen_bases, stolen_base_attempts),
        "batting_avg": avg,
        "on_base_pct": obp,
        "slugging_pct": slg,
        "ops": ops,
        "iso": iso,
        "strikeout_rate": _safe_rate(strikeouts, pa),
        "walk_rate": _safe_rate(walks, pa),
        "estimated_woba": estimated_woba,
        "unsupported": {
            "true_woba": "not stored; estimated_woba uses static linear weights",
            "handedness_splits": "not stored in MVP box-score logs",
        },
        "insufficient_sample": game_count < min_games,
    }


@app.get("/teams/{team_id}/bullpen", tags=["teams"])
def team_bullpen(
    team_id: int,
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    state = build_bullpen_state(db, team_id=team_id, as_of_date=as_of)
    if state is None:
        raise HTTPException(404, f"No bullpen data for team {team_id}")
    return _dc(score_bullpen(state))


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------

@app.get("/players/{player_id}/form", tags=["players"])
def player_form(
    player_id: int,
    window: str = Query("l10"),
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    try:
        wk = WindowKey(window)
    except ValueError:
        raise HTTPException(400, f"Unknown window: {window}")

    w = load_hitter_form_window(db, player_id=player_id, window=wk, as_of_date=as_of)
    if w is None:
        w = build_hitter_form_window(db, player_id=player_id, window=wk, as_of_date=as_of)
    if w is None:
        raise HTTPException(404, f"No form data for player {player_id}")
    return _dc(w)


# ---------------------------------------------------------------------------
# Pitchers
# ---------------------------------------------------------------------------

@app.get("/pitchers/{pitcher_id}/form", tags=["pitchers"])
def pitcher_form(
    pitcher_id: int,
    window: str = Query("last_5_starts"),
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    try:
        wk = WindowKey(window)
    except ValueError:
        raise HTTPException(400, f"Unknown window: {window}")

    w = build_starter_form_window(db, pitcher_id=pitcher_id, window=wk, as_of_date=as_of)
    if w is None:
        raise HTTPException(404, f"No starter form data for pitcher {pitcher_id}")
    return _dc(w)


@app.get("/pitchers/{pitcher_id}/advanced", tags=["pitchers"])
def pitcher_advanced(
    pitcher_id: int,
    window: str = Query("last_5_starts"),
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Aggregate pitcher advanced-ish rates from stored pitching logs.

    FIP uses the MVP constant from the recent-form engine. BABIP is approximate because the
    schema lacks sacrifice and batted-ball detail. Strand rate and true L/R
    splits are explicitly unavailable until richer play-by-play ingestion.
    """
    try:
        wk = WindowKey(window)
    except ValueError:
        raise HTTPException(400, f"Unknown window: {window}")

    pitcher = db.get(Player, pitcher_id)
    rows = _pitcher_rows_for_window(db, pitcher_id=pitcher_id, window=wk, as_of=as_of)
    if not rows:
        raise HTTPException(404, f"No pitching data for pitcher {pitcher_id}")

    appearances = len(rows)
    starts = sum(1 for r in rows if r.started)
    innings = sum(r.innings_pitched for r in rows)
    batters_faced = sum(r.batters_faced for r in rows)
    hits = sum(r.hits_allowed for r in rows)
    earned_runs = sum(r.earned_runs for r in rows)
    walks = sum(r.walks for r in rows)
    strikeouts = sum(r.strikeouts for r in rows)
    home_runs = sum(r.home_runs_allowed for r in rows)
    pitches = sum(r.pitches for r in rows)
    fip = ((13 * home_runs + 3 * walks - 2 * strikeouts) / innings + FIP_CONSTANT) if innings else None
    balls_in_play = batters_faced - strikeouts - walks - home_runs
    babip = _safe_rate(hits - home_runs, balls_in_play)

    return {
        "pitcher_id": pitcher_id,
        "pitcher_name": pitcher.full_name if pitcher else None,
        "throws": pitcher.throws if pitcher else None,
        "team_id": rows[0].team_id,
        "window": wk.value,
        "as_of_date": as_of.isoformat(),
        "start_date": min(r.game_date for r in rows).isoformat(),
        "end_date": max(r.game_date for r in rows).isoformat(),
        "appearances": appearances,
        "starts": starts,
        "innings_pitched": innings,
        "batters_faced": batters_faced,
        "hits_allowed": hits,
        "earned_runs": earned_runs,
        "walks": walks,
        "strikeouts": strikeouts,
        "home_runs_allowed": home_runs,
        "pitches": pitches,
        "era": (earned_runs * 9 / innings) if innings else None,
        "fip": fip,
        "fip_constant": FIP_CONSTANT,
        "babip": babip,
        "whip": _safe_rate(walks + hits, innings),
        "k_rate": _safe_rate(strikeouts, batters_faced),
        "bb_rate": _safe_rate(walks, batters_faced),
        "k_per_9": (strikeouts * 9 / innings) if innings else None,
        "bb_per_9": (walks * 9 / innings) if innings else None,
        "hr_per_9": (home_runs * 9 / innings) if innings else None,
        "avg_pitches_per_start": _safe_rate(pitches, starts),
        "unsupported": {
            "strand_rate": "not stored; needs baserunner/LOB or play-by-play state",
            "left_right_splits": "not stored; needs batter handedness outcomes per PA",
        },
        "insufficient_sample": appearances < 3 or innings < 10,
    }


# ---------------------------------------------------------------------------
# GameBundle — single-call composite for the frontend
# ---------------------------------------------------------------------------

@app.get("/games/{game_id}/bundle", tags=["games"])
def game_bundle(
    game_id: int,
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Return a full GameBundle payload in one call — home/away form, bullpen,
    starters, all windows. Saves multiple round trips from the frontend."""
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(404, f"Game {game_id} not found")

    def _team_form(team_id: int, window: WindowKey):
        w = load_team_form_window(db, team_id=team_id, window=window, as_of_date=as_of)
        if w is None:
            w = build_team_form_window(db, team_id=team_id, window=window, as_of_date=as_of)
        return _dc(w)

    def _starter(pitcher_id):
        return _dc(_starter_form_or_announced(
            db,
            pitcher_id=pitcher_id,
            window=WindowKey.LAST_5_STARTS,
            as_of=as_of,
        ))

    def _bullpen(team_id: int, probable_starter_id: Optional[int] = None):
        exclude = [probable_starter_id] if probable_starter_id else None
        state = build_bullpen_state(db, team_id=team_id, as_of_date=as_of, exclude_pitcher_ids=exclude)
        if state is None:
            return None
        return _dc(score_bullpen(state))

    home_id = game.home_team_id
    away_id = game.away_team_id
    home_team = db.get(Team, home_id)
    away_team = db.get(Team, away_id)

    return {
        "game_id": game_id,
        "game_date": game.game_date.isoformat(),
        "status": game.status,
        "venue": game.venue,
        "home_team_id": home_id,
        "away_team_id": away_id,
        "home_team_abbr": home_team.abbr if home_team else None,
        "away_team_abbr": away_team.abbr if away_team else None,
        "is_doubleheader": game.is_doubleheader,
        "game_number": game.game_number,
        "home_form": {
            "season": _team_form(home_id, WindowKey.SEASON),
            "l10": _team_form(home_id, WindowKey.L10),
            "l5": _team_form(home_id, WindowKey.L5),
        },
        "away_form": {
            "season": _team_form(away_id, WindowKey.SEASON),
            "l10": _team_form(away_id, WindowKey.L10),
            "l5": _team_form(away_id, WindowKey.L5),
        },
        "home_starter": _starter(game.home_probable_starter_id),
        "away_starter": _starter(game.away_probable_starter_id),
        "home_bullpen": _bullpen(home_id, game.home_probable_starter_id),
        "away_bullpen": _bullpen(away_id, game.away_probable_starter_id),
        "park_factors": {
            "venue": game.venue,
            "runs": get_park_factor(game.venue).runs,
            "hr": get_park_factor(game.venue).hr,
            "hits": get_park_factor(game.venue).hits,
            "is_dome": get_park_factor(game.venue).is_dome,
        },
    }


@app.get("/games/{game_id}/context", tags=["games"])
def game_context(
    game_id: int,
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Bundle + analysis + weather in one call.

    Replaces the 4-request waterfall the detail page previously needed:
      bundle, weather, analyze, (batting fetched separately per team).
    Now the detail page only needs this call + one batting call per team.
    Analysis result is cache-backed.
    """
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(404, f"Game {game_id} not found")

    from sqlalchemy import desc as _desc
    from app.models.odds import WeatherSnapshotRow

    def _team_form(team_id: int, window: WindowKey):
        w = load_team_form_window(db, team_id=team_id, window=window, as_of_date=as_of)
        if w is None:
            w = build_team_form_window(db, team_id=team_id, window=window, as_of_date=as_of)
        return _dc(w)

    def _starter(pitcher_id):
        return _dc(_starter_form_or_announced(
            db,
            pitcher_id=pitcher_id,
            window=WindowKey.LAST_5_STARTS,
            as_of=as_of,
        ))

    def _bullpen(team_id: int, probable_starter_id: Optional[int] = None):
        exclude = [probable_starter_id] if probable_starter_id else None
        state = build_bullpen_state(db, team_id=team_id, as_of_date=as_of, exclude_pitcher_ids=exclude)
        if state is None:
            return None
        return _dc(score_bullpen(state))

    home_id = game.home_team_id
    away_id = game.away_team_id
    home_team = db.get(Team, home_id)
    away_team = db.get(Team, away_id)

    weather_row = db.execute(
        select(WeatherSnapshotRow)
        .where(WeatherSnapshotRow.game_id == game_id)
        .order_by(_desc(WeatherSnapshotRow.captured_at))
        .limit(1)
    ).scalar_one_or_none()

    weather = None
    if weather_row:
        weather = {
            "game_id": weather_row.game_id,
            "temperature_f": weather_row.temperature_f,
            "wind_speed_mph": weather_row.wind_speed_mph,
            "wind_direction_deg": weather_row.wind_direction_deg,
            "precipitation_chance": weather_row.precipitation_chance,
            "humidity_pct": weather_row.humidity_pct,
            "is_dome": weather_row.is_dome,
            "captured_at": weather_row.captured_at.isoformat(),
        }

    return {
        "game_id": game_id,
        "game_date": game.game_date.isoformat(),
        "status": game.status,
        "venue": game.venue,
        "home_team_id": home_id,
        "away_team_id": away_id,
        "home_team_abbr": home_team.abbr if home_team else None,
        "away_team_abbr": away_team.abbr if away_team else None,
        "home_form": {
            "season": _team_form(home_id, WindowKey.SEASON),
            "l10": _team_form(home_id, WindowKey.L10),
            "l5": _team_form(home_id, WindowKey.L5),
        },
        "away_form": {
            "season": _team_form(away_id, WindowKey.SEASON),
            "l10": _team_form(away_id, WindowKey.L10),
            "l5": _team_form(away_id, WindowKey.L5),
        },
        "home_starter": _starter(game.home_probable_starter_id),
        "away_starter": _starter(game.away_probable_starter_id),
        "home_bullpen": _bullpen(home_id, game.home_probable_starter_id),
        "away_bullpen": _bullpen(away_id, game.away_probable_starter_id),
        "weather": weather,
        "analysis": _build_analysis_cached(game_id, as_of, db),
    }


# ---------------------------------------------------------------------------
# Park factors
# ---------------------------------------------------------------------------

@app.get("/park-factors")
def park_factors_all():
    """Return park factors for all known venues."""
    from app.ingestion.park_factors import _PARK_FACTORS
    return [
        {"venue": pf.venue, "runs": pf.runs, "hr": pf.hr, "hits": pf.hits, "is_dome": pf.is_dome}
        for pf in _PARK_FACTORS
    ]


@app.get("/park-factors/venue")
def park_factors_venue(venue: str = Query(..., description="Venue name")):
    pf = get_park_factor(venue)
    return {"venue": pf.venue, "runs": pf.runs, "hr": pf.hr, "hits": pf.hits, "is_dome": pf.is_dome}


# ---------------------------------------------------------------------------
# Odds and weather
# ---------------------------------------------------------------------------

@app.get("/games/{game_id}/odds", tags=["games"])
def game_odds(game_id: int, db: Session = Depends(_get_db)):
    """Return the most recent odds snapshots for a game."""
    from sqlalchemy import desc
    from app.models.odds import OddsSnapshotRow
    rows = db.execute(
        select(OddsSnapshotRow)
        .where(OddsSnapshotRow.game_id == game_id)
        .order_by(desc(OddsSnapshotRow.captured_at))
    ).scalars().all()
    return [
        {
            "game_id": r.game_id,
            "bookmaker": r.bookmaker,
            "market": r.market,
            "selection": r.selection,
            "american_odds": r.american_odds,
            "line": r.line,
            "captured_at": r.captured_at.isoformat(),
        }
        for r in rows
    ]


@app.get("/games/{game_id}/weather", tags=["games"])
def game_weather(game_id: int, db: Session = Depends(_get_db)):
    """Return the most recent weather snapshot for a game."""
    from sqlalchemy import desc
    from app.models.odds import WeatherSnapshotRow
    row = db.execute(
        select(WeatherSnapshotRow)
        .where(WeatherSnapshotRow.game_id == game_id)
        .order_by(desc(WeatherSnapshotRow.captured_at))
        .limit(1)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, f"No weather data for game {game_id}")
    return {
        "game_id": row.game_id,
        "temperature_f": row.temperature_f,
        "wind_speed_mph": row.wind_speed_mph,
        "wind_direction_deg": row.wind_direction_deg,
        "precipitation_chance": row.precipitation_chance,
        "humidity_pct": row.humidity_pct,
        "is_dome": row.is_dome,
        "captured_at": row.captured_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Game Analysis — algorithmic betting intelligence
# ---------------------------------------------------------------------------

def _batting_stats_for_team(db: Session, *, team_id: int, as_of: date) -> dict:
    """Return estimated_woba, strikeout_rate, and ISO from L10 batting logs."""
    bounds = _last_team_game_dates(db, team_id=team_id, window=WindowKey.L10, as_of=as_of)
    if bounds is None:
        return {}
    start, end = bounds
    rows = db.execute(
        select(PlayerGameLog).where(
            PlayerGameLog.team_id == team_id,
            PlayerGameLog.game_date >= start,
            PlayerGameLog.game_date <= end,
        )
    ).scalars().all()
    if not rows:
        return {}
    walks = sum(r.walks for r in rows)
    hbp = sum(r.hit_by_pitch for r in rows)
    hits = sum(r.hits for r in rows)
    doubles = sum(r.doubles for r in rows)
    triples = sum(r.triples for r in rows)
    home_runs = sum(r.home_runs for r in rows)
    ab = sum(r.at_bats for r in rows)
    pa = sum(r.plate_appearances for r in rows)
    sac_flies = sum(r.sac_flies for r in rows)
    strikeouts = sum(r.strikeouts for r in rows)
    singles = hits - doubles - triples - home_runs
    total_bases = singles + 2 * doubles + 3 * triples + 4 * home_runs
    denom = ab + walks + hbp + sac_flies
    woba = _safe_rate(
        0.69 * walks + 0.72 * hbp + 0.89 * singles
        + 1.27 * doubles + 1.62 * triples + 2.10 * home_runs,
        denom,
    )
    slg = _safe_rate(total_bases, ab)
    avg = _safe_rate(hits, ab)
    iso = (slg - avg) if slg is not None and avg is not None else None
    k_rate = _safe_rate(strikeouts, pa)
    bb_rate = _safe_rate(walks, pa)
    return {"woba": woba, "iso": iso, "k_rate": k_rate, "bb_rate": bb_rate}


def _estimated_woba_for_team(db: Session, *, team_id: int, as_of: date) -> Optional[float]:
    """Compute estimated wOBA from L10 batting logs for use in game analysis."""
    return _batting_stats_for_team(db, team_id=team_id, as_of=as_of).get("woba")


def _build_analysis(game_id: int, as_of: date, db: Session):
    """Load all data for a game and return a GameAnalysis dataclass.

    Delegates to the shared `app.betting.analysis_builder.build_game_analysis`
    helper (extracted verbatim from this function) so the offline backtest
    engine can replay the model without a circular import. Behavior is
    byte-identical to the previous inline implementation.
    """
    from app.betting.analysis_builder import build_game_analysis

    return build_game_analysis(game_id, as_of, db)


def _build_analysis_cached(game_id: int, as_of: date, db: Session) -> Optional[dict]:
    """Cache-wrapped version of _build_analysis. Returns a dict (already serialized)."""
    cached = _cache_get(game_id, as_of)
    if cached is not None:
        return cached
    result = _build_analysis(game_id, as_of, db)
    if result is None:
        return None
    serialized = _dc(result)
    _cache_set(game_id, as_of, serialized)
    return serialized


@app.get("/games/{game_id}/analyze", tags=["analysis"])
def game_analyze(
    game_id: int,
    as_of: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Run the full deterministic model for a single game.

    Results are cached for 5 minutes per (game_id, as_of) pair.
    Call POST /cache/clear after an ingestion run to force a refresh.
    """
    result = _build_analysis_cached(game_id, as_of, db)
    if result is None:
        raise HTTPException(404, f"Game {game_id} not found")
    return result


@app.get("/games/{game_id}/analyze/f5", tags=["analysis"])
def game_analyze_f5(
    game_id: int,
    as_of: date = Query(..., description="YYYY-MM-DD"),
    home_f5_odds: Optional[int] = Query(None, description="American odds, home F5 ML"),
    away_f5_odds: Optional[int] = Query(None, description="American odds, away F5 ML"),
    db: Session = Depends(_get_db),
):
    """First-5-innings moneyline model — isolates starter skill, excludes bullpen.

    Projection-only unless both F5 odds are supplied (no invented line). Per
    Arnav's Track A/B split; platoon term is 0.0 until L/R splits land.
    """
    import dataclasses
    from app.betting.f5_model import analyze_f5_moneyline

    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(404, f"Game {game_id} not found")
    home_team = db.get(Team, game.home_team_id)
    away_team = db.get(Team, game.away_team_id)

    def _sp(pitcher_id):
        if pitcher_id is None:
            return None
        return build_starter_form_window(
            db, pitcher_id=pitcher_id, window=WindowKey.LAST_5_STARTS, as_of_date=as_of,
        )

    result = analyze_f5_moneyline(
        game_id=game_id,
        home_abbr=home_team.abbr if home_team else "HOM",
        away_abbr=away_team.abbr if away_team else "AWY",
        home_sp=_sp(game.home_probable_starter_id),
        away_sp=_sp(game.away_probable_starter_id),
        home_f5_odds=home_f5_odds,
        away_f5_odds=away_f5_odds,
    )
    return dataclasses.asdict(result)


@app.get("/quant/verify", tags=["analysis"])
def quant_verify(
    model_prob: float = Query(..., ge=0.01, le=0.99, description="model win prob for the side"),
    side_odds: int = Query(..., description="American odds for the side"),
    other_odds: int = Query(..., description="American odds for the opponent"),
    evidence_quality: float = Query(0.7, ge=0.0, le=1.0),
):
    """Run the live quant pipeline for an arbitrary line.

    Single source of truth for the Bet Verifier UI — Shin devig, Bayesian
    shrinkage, edge posterior, uncertainty-adjusted Kelly, log-growth.
    """
    from app.betting.quant import compute_quant_edge, quant_recommendation

    qe = compute_quant_edge(model_prob, side_odds, other_odds, evidence_quality)
    rec = quant_recommendation(qe, model_confidence=model_prob, evidence_quality=evidence_quality)
    return {**dataclasses.asdict(qe), "recommendation": rec}


@app.get("/backtest", tags=["analysis"])
def backtest_range(
    response: Response,
    start: date = Query(..., description="YYYY-MM-DD (inclusive)"),
    end: date = Query(..., description="YYYY-MM-DD (inclusive)"),
    db: Session = Depends(_get_db),
):
    """Deterministic backtest over completed games in [start, end].

    Replays the model on real, completed box scores already in the DB and
    compares predictions to actual outcomes (calibration, tier hit-rate,
    flat & Kelly P&L, bankroll growth, Brier score). No stored prediction
    history is used; nothing is fabricated. A range with no completed games
    honestly returns `n=0` with empty series and `None` scalars.

    Not cached — this is an offline/analytical endpoint, not latency-sensitive.
    """
    if end < start:
        raise HTTPException(422, "end must be on or after start")
    if (end - start).days > 366:
        raise HTTPException(422, "backtest range capped at 366 days; narrow the window")

    from app.betting.backtest import run_backtest

    result = run_backtest(db, start, end)
    response.headers["Cache-Control"] = "no-store"
    return dataclasses.asdict(result)


@app.get("/nba/analyze", tags=["analysis"])
def nba_analyze(
    home_team: str = Query(...),
    away_team: str = Query(...),
    home_net_rating: float = Query(..., description="off_rtg - def_rtg, home"),
    away_net_rating: float = Query(..., description="off_rtg - def_rtg, away"),
    home_ml_odds: Optional[int] = Query(None),
    away_ml_odds: Optional[int] = Query(None),
    home_rest_days: Optional[int] = Query(None),
    away_rest_days: Optional[int] = Query(None),
    home_back_to_back: bool = Query(False),
    away_back_to_back: bool = Query(False),
    evidence_quality: float = Query(0.6, ge=0.0, le=1.0),
):
    """NBA moneyline — quant core ported to basketball.

    On-demand over explicit inputs (no NBA ingestion in this repo; no
    fabricated team data). Routes through the same Shin/Bayesian/Kelly
    pipeline as the MLB models.
    """
    import dataclasses
    from app.betting.nba_model import analyze_nba_game

    result = analyze_nba_game(
        home_team=home_team, away_team=away_team,
        home_net_rating=home_net_rating, away_net_rating=away_net_rating,
        home_ml_odds=home_ml_odds, away_ml_odds=away_ml_odds,
        home_rest_days=home_rest_days, away_rest_days=away_rest_days,
        home_back_to_back=home_back_to_back, away_back_to_back=away_back_to_back,
        evidence_quality=evidence_quality,
    )
    return dataclasses.asdict(result)


@app.get("/games/picks", tags=["analysis"])
def daily_picks(
    game_date: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """All games on a date, analyzed and ranked by model edge.

    STRONG LEAN → LEAN → PASS → AVOID, then by confidence descending.
    Analysis results are cached for 5 minutes.
    """
    from app.models.entities import Team as TeamModel
    HomeTeam = aliased(TeamModel)
    AwayTeam = aliased(TeamModel)
    rows = db.execute(
        select(Game, HomeTeam, AwayTeam)
        .join(HomeTeam, Game.home_team_id == HomeTeam.id)
        .join(AwayTeam, Game.away_team_id == AwayTeam.id)
        .where(Game.game_date == game_date)
        .order_by(Game.id)
    ).all()

    def _analyze_game(game, _home, _away):
        with SessionLocal() as thread_db:
            d = _build_analysis_cached(game.id, game_date, thread_db)
            if d is None:
                return None
            d = dict(d)
            d["game_date"] = game.game_date.isoformat()
            d["venue"] = game.venue
            return d

    if not rows:
        return []

    results = []
    with ThreadPoolExecutor(max_workers=min(len(rows), 8)) as pool:
        futures = {pool.submit(_analyze_game, g, h, a): g.id for g, h, a in rows}
        for fut in as_completed(futures):
            d = fut.result()
            if d is not None:
                results.append(d)

    # Annotate tracked picks (no override). The page used to freeze the
    # tier/lean/odds to BetRecord values when a bet existed, which made
    # /games/picks disagree with /games/{id}/context once lines moved
    # (the same game showed e.g. -115 on /picks and -126 on /game/[id]).
    # Now we leave the live model output intact and only mark the row as
    # tracked + carry the original stake; the tracker page remains the
    # source of truth for "what odds did I actually bet at".
    if results:
        tracked = db.execute(text("""
            SELECT game_id, market, units
            FROM bet_records
            WHERE game_date = :dt
        """), {"dt": game_date.isoformat()}).fetchall()
        by_gm: dict[tuple, float | None] = {}
        for gid, market, units in tracked:
            by_gm[(gid, market)] = float(units) if units is not None else None
        for d in results:
            gid = d.get("game_id")
            if (gid, "moneyline") in by_gm:
                d["ml_locked"] = True
                d["ml_locked_units"] = by_gm[(gid, "moneyline")]
            if (gid, "total") in by_gm:
                d["total_locked"] = True
                d["total_locked_units"] = by_gm[(gid, "total")]

    tier_order = {"STRONG LEAN": 0, "LEAN": 1, "PASS": 2, "AVOID": 3}
    results.sort(key=lambda r: (tier_order.get(r.get("ml_tier", "PASS"), 2), -r.get("ml_confidence", 0)))
    return results


@app.get("/games/slate", tags=["analysis"])
def slate(
    game_date: date = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(_get_db),
):
    """Single-call slate endpoint — replaces N+1 frontend pattern.

    Returns every game on a date with home/away bullpen scores and model
    analysis bundled inline. One HTTP request replaces 1 + 3N requests
    (games list + bullpen×2 + analyze per game).

    Results are cached per (game_id, date).
    """
    from app.models.entities import Team as TeamModel
    HomeTeam = aliased(TeamModel)
    AwayTeam = aliased(TeamModel)

    rows = db.execute(
        select(Game, HomeTeam, AwayTeam)
        .join(HomeTeam, Game.home_team_id == HomeTeam.id)
        .join(AwayTeam, Game.away_team_id == AwayTeam.id)
        .where(Game.game_date == game_date)
        .order_by(Game.id)
    ).all()

    def _bullpen_dict(team_id: int, probable_starter_id: Optional[int] = None):
        exclude = [probable_starter_id] if probable_starter_id else None
        state = build_bullpen_state(db, team_id=team_id, as_of_date=game_date, exclude_pitcher_ids=exclude)
        if state is None:
            return None
        return _dc(score_bullpen(state))

    # Capture immutable metadata before threading (ORM objects not thread-safe)
    game_meta = [
        {
            "game_id": game.id,
            "game_date": game.game_date.isoformat(),
            "status": game.status,
            "venue": game.venue,
            "home_team_id": game.home_team_id,
            "home_team_abbr": home_t.abbr,
            "away_team_id": game.away_team_id,
            "away_team_abbr": away_t.abbr,
            "home_probable_starter_id": game.home_probable_starter_id,
            "away_probable_starter_id": game.away_probable_starter_id,
            "home_score": game.home_score,
            "away_score": game.away_score,
        }
        for game, home_t, away_t in rows
    ]

    def _compute_game(meta: dict) -> dict:
        with SessionLocal() as thread_db:
            def _bp(team_id: int, starter_id: Optional[int] = None):
                exclude = [starter_id] if starter_id else None
                state = build_bullpen_state(thread_db, team_id=team_id, as_of_date=game_date, exclude_pitcher_ids=exclude)
                return _dc(score_bullpen(state)) if state is not None else None

            analysis = _build_analysis_cached(meta["game_id"], game_date, thread_db)
            home_bp = _bp(meta["home_team_id"], meta["home_probable_starter_id"])
            away_bp = _bp(meta["away_team_id"], meta["away_probable_starter_id"])
        return {**meta, "home_bullpen": home_bp, "away_bullpen": away_bp, "analysis": analysis}

    if not game_meta:
        return []

    output_map: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(game_meta), 8)) as pool:
        futures = {pool.submit(_compute_game, m): m["game_id"] for m in game_meta}
        for fut in as_completed(futures):
            result = fut.result()
            output_map[result["game_id"]] = result

    # Live odds: latest moneyline + total snapshot per game.
    game_ids = [m["game_id"] for m in game_meta]
    team_map = {m["game_id"]: (m["home_team_abbr"], m["away_team_abbr"]) for m in game_meta}
    live_odds_map = _latest_odds_by_game(db, game_ids, team_abbr_by_game=team_map)
    for gid, payload in output_map.items():
        payload["live_odds"] = live_odds_map.get(gid)

    # Preserve original game order
    return [output_map[m["game_id"]] for m in game_meta if m["game_id"] in output_map]


def _latest_odds_by_game(
    db: Session,
    game_ids: list[int],
    team_abbr_by_game: Optional[dict[int, tuple[str, str]]] = None,
) -> dict[int, dict]:
    """Latest moneyline + total snapshot per game (cross-DB compatible).

    team_abbr_by_game: {game_id: (home_abbr, away_abbr)} so we can normalize the
    moneyline selection string (which may be a nickname, full name, or city +
    team name from the various providers) to home/away.

    Returns {game_id: {moneyline: {home, away}, total: {line, over, under}, captured_at}}.
    """
    if not game_ids:
        return {}
    placeholders = ",".join(f":g{i}" for i in range(len(game_ids)))
    params: dict = {f"g{i}": gid for i, gid in enumerate(game_ids)}
    rows = db.execute(text(f"""
        SELECT game_id, market, selection, line, american_odds, bookmaker, captured_at
        FROM (
            SELECT
                game_id, market, selection, line, american_odds, bookmaker, captured_at,
                ROW_NUMBER() OVER (
                    PARTITION BY game_id, market, selection
                    ORDER BY captured_at DESC
                ) AS rn
            FROM odds_snapshots
            WHERE game_id IN ({placeholders})
        ) sub
        WHERE rn = 1
    """), params).fetchall()

    # Reuse classifier's team-name → abbr lookup
    from app.chat.classifier import TEAM_NAMES, ALL_ABBRS, ABBR_NORM

    def _resolve_to_abbr(selection: str) -> Optional[str]:
        if not selection:
            return None
        s = selection.strip()
        up = s.upper()
        if up in ALL_ABBRS:
            return up
        # Try TEAM_NAMES (mets, yankees, new york mets, etc.)
        low = s.lower()
        if low in TEAM_NAMES:
            return TEAM_NAMES[low]
        # Try substring match against TEAM_NAMES keys (handles "Mets" vs "mets")
        for name, abbr in TEAM_NAMES.items():
            if name in low or low in name:
                return abbr
        return None

    out: dict[int, dict] = {}
    for r in rows:
        gid, market, selection, line, odds, bookmaker, captured_at = r
        entry = out.setdefault(gid, {"moneyline": {"home": None, "away": None}, "total": None, "captured_at": None})
        if captured_at is None:
            captured_iso = None
        elif isinstance(captured_at, str):
            captured_iso = captured_at  # SQLite returns ISO strings already
        else:
            captured_iso = captured_at.isoformat()  # Postgres returns datetime
        if entry["captured_at"] is None or (captured_iso and captured_iso > entry["captured_at"]):
            entry["captured_at"] = captured_iso

        if market == "moneyline":
            abbr = _resolve_to_abbr(selection)
            if abbr and team_abbr_by_game and gid in team_abbr_by_game:
                home_abbr, away_abbr = team_abbr_by_game[gid]
                # Normalize both sides (e.g. AZ→ARI, ATH→OAK) before comparing
                norm_abbr = ABBR_NORM.get(abbr, abbr)
                norm_home = ABBR_NORM.get(home_abbr, home_abbr)
                norm_away = ABBR_NORM.get(away_abbr, away_abbr)
                if norm_abbr == norm_home:
                    entry["moneyline"]["home"] = odds
                elif norm_abbr == norm_away:
                    entry["moneyline"]["away"] = odds
                else:
                    # Selection didn't match either team — store raw for debugging
                    entry["moneyline"].setdefault("_unmatched", []).append({"selection": selection, "odds": odds})
            else:
                # No team mapping provided — fall back to raw selection key
                entry["moneyline"][selection] = odds
        elif market == "total":
            if entry["total"] is None:
                entry["total"] = {"line": line, "over": None, "under": None, "bookmaker": bookmaker}
            sel_lower = (selection or "").lower()
            if sel_lower == "over":
                entry["total"]["over"] = odds
            elif sel_lower == "under":
                entry["total"]["under"] = odds
    return out


# ---------------------------------------------------------------------------
# LLM polish (optional — stubs if key missing)
# ---------------------------------------------------------------------------


@app.get("/report", tags=["reports"])
def get_report(date: str = Query(..., description="YYYY-MM-DD")):
    """Serve the generated daily report markdown for a date.

    Reads obsidian_vault/Reports/Daily/{date}.md (written by
    scripts/run_daily_report.py). 404 if it hasn't been generated yet.
    """
    from pathlib import Path
    from fastapi.responses import PlainTextResponse

    repo_root = Path(__file__).resolve().parents[2]
    report_path = repo_root / "obsidian_vault" / "Reports" / "Daily" / f"{date}.md"
    if not report_path.is_file():
        raise HTTPException(
            404, f"No report for {date}. Run: python scripts/run_daily_report.py"
        )
    return PlainTextResponse(report_path.read_text(encoding="utf-8"))


@app.post("/report/polish", tags=["reports"])
def polish_report_endpoint(body: dict):
    """Polish a raw Markdown report with Claude.

    Returns {markdown, polished: bool, method: str}.
    polished=False means no LLM was applied (no API key and no CLI found).
    """
    raw = body.get("markdown", "")
    if not raw:
        raise HTTPException(400, "Field 'markdown' is required.")
    from app.config import get_settings
    from app.llm.claude_client import polish_report
    markdown, was_polished = polish_report(raw)
    if not was_polished:
        method = "none"
    elif get_settings().anthropic_api_key:
        method = "sdk"
    else:
        method = "cli"
    return {"markdown": markdown, "polished": was_polished, "method": method}


# ---------------------------------------------------------------------------
# Tracker — picks performance log
# ---------------------------------------------------------------------------

# Tables are created at module load above (Base.metadata.create_all).


class _BetCreate(dict):
    """Thin typed wrapper — FastAPI will parse from JSON body."""


from pydantic import BaseModel as _BaseModel


class BetCreateBody(_BaseModel):
    game_id: int
    game_date: str          # "YYYY-MM-DD"
    market: str             # "moneyline" | "total"
    selection: str          # team abbr or "OVER"/"UNDER"
    american_odds: int
    units: float = 1.0
    tier: str               # "STRONG LEAN" | "LEAN"
    home_team_abbr: str
    away_team_abbr: str
    total_line: Optional[float] = None
    projected_total: Optional[float] = None


class BetSettleBody(_BaseModel):
    result: str                         # "WIN" | "LOSS" | "PUSH"
    units_returned: Optional[float] = None


class OddsSnapshotCreateBody(_BaseModel):
    game_id: int
    bookmaker: str = "draftkings"
    market: str                         # "moneyline" | "total"
    selection: str                      # lower-case team name, "over", or "under"
    american_odds: int
    line: Optional[float] = None
    captured_at: Optional[datetime] = None


class OddsSnapshotBulkBody(_BaseModel):
    snapshots: List[OddsSnapshotCreateBody]
    replace_bookmaker: Optional[str] = None


def _bet_to_dict(b: BetRecord) -> dict:
    return {
        "id": b.id,
        "game_id": b.game_id,
        "game_date": b.game_date.isoformat(),
        "market": b.market,
        "selection": b.selection,
        "american_odds": b.american_odds,
        "units": b.units,
        "result": b.result,
        "units_returned": b.units_returned,
        "tier": b.tier,
        "home_team_abbr": b.home_team_abbr,
        "away_team_abbr": b.away_team_abbr,
        "total_line": b.total_line,
        "projected_total": b.projected_total,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "model_prob": b.model_prob,
        "market_implied_prob": b.market_implied_prob,
        "edge": b.edge,
        "p_edge_positive": b.p_edge_positive,
        "kelly_fraction_raw": b.kelly_fraction_raw,
        "evidence_quality": b.evidence_quality,
        "snapshot_source": b.snapshot_source,
    }


@app.post("/admin/odds-snapshots/bulk", tags=["admin"])
def bulk_create_odds_snapshots(
    body: OddsSnapshotBulkBody,
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Append manually sourced odds snapshots.

    Set replace_bookmaker to first delete existing rows for the submitted
    games/bookmaker. This is intended for emergency manual market fills when an
    upstream odds provider is unavailable.
    """
    from app.models.odds import OddsSnapshotRow

    if not body.snapshots:
        raise HTTPException(400, "snapshots must not be empty")

    game_ids = sorted({snap.game_id for snap in body.snapshots})
    existing_game_ids = set(
        db.execute(select(Game.id).where(Game.id.in_(game_ids))).scalars().all()
    )
    missing = [game_id for game_id in game_ids if game_id not in existing_game_ids]
    if missing:
        raise HTTPException(404, f"Unknown game_id(s): {missing}")

    if body.replace_bookmaker:
        db.execute(
            delete(OddsSnapshotRow).where(
                OddsSnapshotRow.game_id.in_(game_ids),
                OddsSnapshotRow.bookmaker == body.replace_bookmaker,
            )
        )

    now = datetime.utcnow()
    rows = []
    for snap in body.snapshots:
        if snap.market not in {"moneyline", "total"}:
            raise HTTPException(400, f"Unsupported market: {snap.market}")
        rows.append(
            OddsSnapshotRow(
                game_id=snap.game_id,
                bookmaker=snap.bookmaker,
                market=snap.market,
                selection=snap.selection.lower(),
                line=snap.line,
                american_odds=snap.american_odds,
                captured_at=snap.captured_at or now,
            )
        )

    db.add_all(rows)
    db.commit()
    evicted = _cache_invalidate_all()
    return {
        "inserted": len(rows),
        "games": game_ids,
        "replace_bookmaker": body.replace_bookmaker,
        "cache_evicted": evicted,
    }


@app.post("/admin/refresh-slate", tags=["admin"])
def refresh_slate(
    game_date: date = Query(..., description="YYYY-MM-DD — slate date to refresh"),
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Refresh only the schedule/weather rows for a slate.

    This is intentionally much smaller than the full pregame ingestion job. It
    is useful when the remote DB needs today's game rows before a manual odds
    fill, but a long-running Render background ingestion job is unreliable.
    """
    from app.ingestion.mlb_stats_api import MLBStatsClient, ingest_schedule
    from scripts.run_pregame_update import _ingest_odds_and_weather

    with MLBStatsClient() as client:
        game_ids = ingest_schedule(db, client, game_date, game_type="R")

    games = db.execute(select(Game).where(Game.game_date == game_date)).scalars().all()
    _ingest_odds_and_weather(db, games, game_date)
    db.commit()
    evicted = _cache_invalidate_all()
    return {
        "date": game_date.isoformat(),
        "games_upserted": len(game_ids),
        "games_for_date": len(games),
        "cache_evicted": evicted,
    }


@app.get("/tracker/bets", tags=["tracker"])
def list_bets(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    market: Optional[str] = Query(None),
    game_date: Optional[date] = Query(None, description="Shortcut for single-day filter"),
    db: Session = Depends(_get_db),
):
    """Return tracked bets with game time and live status for pending picks."""
    stmt = (
        select(BetRecord, Game.game_time_utc, Game.status)
        .outerjoin(Game, BetRecord.game_id == Game.id)
    )
    if game_date:
        stmt = stmt.where(BetRecord.game_date == game_date)
    else:
        if date_from:
            stmt = stmt.where(BetRecord.game_date >= date_from)
        if date_to:
            stmt = stmt.where(BetRecord.game_date <= date_to)
    if market:
        stmt = stmt.where(BetRecord.market == market)
    stmt = stmt.order_by(BetRecord.game_date.desc(), BetRecord.id.desc())
    rows = db.execute(stmt).all()
    result = []
    for b, game_time_utc, game_status in rows:
        d = _bet_to_dict(b)
        d["game_time_utc"] = game_time_utc.isoformat() if game_time_utc else None
        d["game_status"] = game_status
        result.append(d)
    return result


@app.post("/tracker/bets", tags=["tracker"], status_code=201)
def create_bet(body: BetCreateBody, db: Session = Depends(_get_db)):
    """Track a new bet. Returns the created record."""
    from datetime import date as _date
    gd = _date.fromisoformat(body.game_date)
    record = BetRecord(
        game_id=body.game_id,
        game_date=gd,
        market=body.market,
        selection=body.selection,
        american_odds=body.american_odds,
        units=body.units,
        tier=body.tier,
        home_team_abbr=body.home_team_abbr,
        away_team_abbr=body.away_team_abbr,
        total_line=body.total_line,
        projected_total=body.projected_total,
        result=None,
        units_returned=None,
        created_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _bet_to_dict(record)


@app.patch("/tracker/bets/{bet_id}", tags=["tracker"])
def settle_bet(
    bet_id: int,
    body: BetSettleBody,
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Settle a bet. Auto-computes units_returned if not provided."""
    record = db.get(BetRecord, bet_id)
    if record is None:
        raise HTTPException(404, f"Bet {bet_id} not found")
    valid = {"WIN", "LOSS", "PUSH"}
    if body.result not in valid:
        raise HTTPException(400, f"result must be one of {valid}")
    record.result = body.result
    if body.units_returned is not None:
        record.units_returned = body.units_returned
    else:
        record.units_returned = compute_units_returned(body.result, record.units, record.american_odds)
    db.commit()
    db.refresh(record)
    return _bet_to_dict(record)


@app.delete("/tracker/bets/{bet_id}", tags=["tracker"], status_code=204)
def delete_bet(
    bet_id: int,
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Remove a tracked bet.

    Writes an ExcludedPick tombstone so auto-track won't re-create the bet
    on its next run (the idempotency check covers both BetRecord and ExcludedPick).
    """
    record = db.get(BetRecord, bet_id)
    if record is None:
        raise HTTPException(404, f"Bet {bet_id} not found")
    # Write tombstone before deleting so the game_id/market are still accessible
    tombstone = ExcludedPick(
        game_id=record.game_id,
        game_date=record.game_date,
        market=record.market,
        reason="manually_deleted",
    )
    db.add(tombstone)
    db.delete(record)
    db.commit()
    return None


@app.post("/tracker/exclude", tags=["tracker"], status_code=201)
def exclude_pick(
    game_id: int = Query(...),
    market: str = Query(..., description="moneyline or total"),
    game_date: date = Query(...),
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Directly add an ExcludedPick tombstone (no bet needed).

    Useful to prevent auto-track from creating picks for a game+market pair
    even when no bet was ever tracked (e.g. after a manual daily curation).
    Idempotent — silently skips if an exclusion already exists.
    """
    existing = db.execute(
        select(ExcludedPick).where(
            ExcludedPick.game_id == game_id,
            ExcludedPick.market == market,
        )
    ).scalar_one_or_none()
    if existing:
        return {"status": "already_excluded", "game_id": game_id, "market": market}
    db.add(ExcludedPick(
        game_id=game_id,
        game_date=game_date,
        market=market,
        reason="manual_curation",
    ))
    db.commit()
    return {"status": "excluded", "game_id": game_id, "market": market}


@app.get("/tracker/summary", tags=["tracker"])
def tracker_summary(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(_get_db),
):
    """Return win/loss/units summary split by market and combined."""
    stmt = select(BetRecord)
    if date_from:
        stmt = stmt.where(BetRecord.game_date >= date_from)
    if date_to:
        stmt = stmt.where(BetRecord.game_date <= date_to)
    rows = db.execute(stmt).scalars().all()

    def _stats(bets):
        wins = sum(1 for b in bets if b.result == "WIN")
        losses = sum(1 for b in bets if b.result == "LOSS")
        pushes = sum(1 for b in bets if b.result == "PUSH")
        pending = sum(1 for b in bets if b.result is None)
        wagered = sum(b.units for b in bets)
        net = sum(b.units_returned for b in bets if b.units_returned is not None)
        return {
            "bets": len(bets),
            "wins": wins,
            "losses": losses,
            "pushes": pushes,
            "pending": pending,
            "units_wagered": round(wagered, 2),
            "units_net": round(net, 2),
        }

    ml = [b for b in rows if b.market == "moneyline"]
    total = [b for b in rows if b.market == "total"]
    return {
        "ml": _stats(ml),
        "total": _stats(total),
        "combined": _stats(rows),
    }


# ── /tracker/track-record helpers ────────────────────────────────────────────
# These compute calibration + tier hit rate + P&L over LIVE TRACKED PICKS
# (BetRecord), not a model replay. This is the honest "how have we actually
# done in operation" view. /backtest is the orthogonal R&D tool for replaying
# a model variant over historical games.

_CALIBRATION_BUCKET_EDGES = [round(0.50 + 0.05 * i, 10) for i in range(11)]  # 0.50..1.00
_CALIBRATION_MIDPOINTS = [
    round((_CALIBRATION_BUCKET_EDGES[i] + _CALIBRATION_BUCKET_EDGES[i + 1]) / 2, 10)
    for i in range(10)
]


def _calibration_bucket_index(p: float) -> Optional[int]:
    """Bucket index in [0,9] for a picked-side probability p∈[0.50,1.00]."""
    if p < 0.50 or p > 1.0:
        return None
    if p >= 1.0:
        return 9
    idx = int((p - 0.50) // 0.05)
    if idx < 0 or idx > 9:
        return None
    return idx


def _wilson_ci(wins: int, n: int, z: float = 1.96) -> tuple[Optional[float], Optional[float]]:
    """Wilson score interval for a binomial proportion. (low, high) or (None, None) if n=0.

    More appropriate than normal-approx CI for small/extreme samples — this is
    the standard interval for reporting confidence on bettor win-rates.
    """
    if n == 0:
        return (None, None)
    import math as _m
    phat = wins / n
    denom = 1.0 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    margin = (z * _m.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


@app.get("/tracker/track-record", tags=["tracker"])
def tracker_track_record(
    start: Optional[date] = Query(None),
    end: Optional[date] = Query(None),
    db: Session = Depends(_get_db),
):
    """Honest track-record summary computed from live-tracked picks.

    Source of truth is `BetRecord` (the bets actually logged at pick time),
    not a model replay. This makes the page survivorship-safe — every pick
    that was ever logged appears, settled or pending. It also keeps the
    response fast (one query, in-memory aggregation) so the page can render
    instantly on any date range.

    Calibration / Brier metrics restrict to rows with `model_prob IS NOT NULL`.
    `snapshot_source` lets the UI distinguish live-captured (the truth) from
    replay-backfilled (an approximation, since the live model code may have
    drifted since the pick was originally made).

    Returns enough structure to drive the UI without further math:
      - `summary`: combined + ML + total record (n, w/l/p/pending, ROI, CI)
      - `tier_hit_rates`: per-tier counts, win%, CI
      - `pnl_curve`: ordered list of cumulative flat P&L per settled bet
      - `calibration`: 10 buckets [0.50..1.00] of (n, actual_win_rate) over
        the snapshot slice
      - `brier`: Brier score over the snapshot slice (null when n=0)
      - `edge_realization`: mean predicted edge vs realized win rate over the
        snapshot slice
      - `snapshot_coverage`: count of rows by snapshot_source — exposes the
        live-vs-replay-vs-null split honestly
    """
    stmt = select(BetRecord)
    if start:
        stmt = stmt.where(BetRecord.game_date >= start)
    if end:
        stmt = stmt.where(BetRecord.game_date <= end)
    stmt = stmt.order_by(BetRecord.game_date.asc(), BetRecord.id.asc())
    rows = list(db.execute(stmt).scalars().all())

    def _record(bets):
        wins   = sum(1 for b in bets if b.result == "WIN")
        losses = sum(1 for b in bets if b.result == "LOSS")
        pushes = sum(1 for b in bets if b.result == "PUSH")
        pending = sum(1 for b in bets if b.result is None)
        settled = wins + losses + pushes
        graded = wins + losses                  # exclude pushes from W%
        wagered = sum(b.units for b in bets if b.result is not None)
        net = sum(
            b.units_returned for b in bets
            if b.units_returned is not None
        )
        roi = (net / wagered) if wagered > 0 else None
        win_rate = (wins / graded) if graded > 0 else None
        ci_low, ci_high = _wilson_ci(wins, graded)
        return {
            "n": len(bets),
            "settled": settled,
            "wins": wins,
            "losses": losses,
            "pushes": pushes,
            "pending": pending,
            "units_wagered": round(wagered, 2),
            "units_net": round(net, 2),
            "roi": (None if roi is None else round(roi, 4)),
            "win_rate": (None if win_rate is None else round(win_rate, 4)),
            "win_rate_ci_low":  (None if ci_low  is None else round(ci_low,  4)),
            "win_rate_ci_high": (None if ci_high is None else round(ci_high, 4)),
        }

    ml_rows    = [b for b in rows if b.market == "moneyline"]
    total_rows = [b for b in rows if b.market == "total"]

    # ── Per-tier hit rate (settled only; ML+Total combined per tier) ─────────
    tier_hit_rates = []
    for tier_name in ("STRONG LEAN", "LEAN"):
        bets = [b for b in rows if b.tier == tier_name]
        graded = [b for b in bets if b.result in ("WIN", "LOSS")]
        wins   = sum(1 for b in graded if b.result == "WIN")
        n      = len(graded)
        ci_low, ci_high = _wilson_ci(wins, n)
        tier_hit_rates.append({
            "tier": tier_name,
            "n": len(bets),
            "settled": n,
            "wins": wins,
            "win_rate": (round(wins / n, 4) if n > 0 else None),
            "win_rate_ci_low":  (None if ci_low  is None else round(ci_low,  4)),
            "win_rate_ci_high": (None if ci_high is None else round(ci_high, 4)),
        })

    # ── Flat & Kelly P&L curves (cumulative, settled only, chronological) ────
    flat_pnl_curve: list[dict] = []
    flat_cum = 0.0
    settled_bets_sorted = [b for b in rows if b.units_returned is not None]
    # rows is already ordered (game_date asc, id asc).
    for b in settled_bets_sorted:
        flat_cum += b.units_returned
        flat_pnl_curve.append({
            "bet_id": b.id,
            "game_date": b.game_date.isoformat(),
            "cum_units": round(flat_cum, 4),
        })

    # ── Snapshot-coverage breakdown ──────────────────────────────────────────
    from collections import Counter
    src_counts = Counter((b.snapshot_source or "null") for b in rows)
    snapshot_coverage = [
        {"source": k, "n": v} for k, v in sorted(src_counts.items())
    ]

    # ── Calibration (snapshot slice only) ────────────────────────────────────
    # For each row with model_prob set AND a settled outcome (WIN/LOSS), bucket
    # the picked-side model_prob and tally actual wins.
    bucket_n    = [0] * 10
    bucket_wins = [0] * 10
    brier_sum = 0.0
    brier_n = 0
    edge_sum = 0.0
    edge_n   = 0

    snapshot_bets = [
        b for b in rows
        if b.model_prob is not None and b.result in ("WIN", "LOSS")
    ]
    for b in snapshot_bets:
        # selection_won_int: 1 if pick won, 0 otherwise
        won_int = 1 if b.result == "WIN" else 0

        # Brier — applies to the entire snapshot slice
        brier_sum += (b.model_prob - won_int) ** 2
        brier_n += 1

        # Edge realization: pure mean predicted edge across the slice
        if b.edge is not None:
            edge_sum += b.edge
            edge_n += 1

        # Calibration: only the picked side's >=0.50 prob can bucket
        bi = _calibration_bucket_index(b.model_prob)
        if bi is not None:
            bucket_n[bi] += 1
            bucket_wins[bi] += won_int

    calibration = [
        {
            "midpoint": _CALIBRATION_MIDPOINTS[i],
            "n": bucket_n[i],
            "actual_win_rate": (
                round(bucket_wins[i] / bucket_n[i], 4)
                if bucket_n[i] > 0 else None
            ),
        }
        for i in range(10)
    ]

    brier = round(brier_sum / brier_n, 6) if brier_n > 0 else None

    # Edge realization: predicted-edge mean vs actual outperformance.
    # Compare the slice's mean(model_prob) to slice's actual win rate.
    if snapshot_bets:
        n_slice = len(snapshot_bets)
        mean_model = sum(b.model_prob for b in snapshot_bets) / n_slice
        actual_win = sum(1 for b in snapshot_bets if b.result == "WIN") / n_slice
        mean_edge_implied = (edge_sum / edge_n) if edge_n > 0 else None
        edge_realization = {
            "n": n_slice,
            "mean_model_prob": round(mean_model, 4),
            "actual_win_rate": round(actual_win, 4),
            "mean_predicted_edge": (
                None if mean_edge_implied is None else round(mean_edge_implied, 4)
            ),
            "realized_outperformance": round(actual_win - mean_model, 4),
        }
    else:
        edge_realization = {
            "n": 0,
            "mean_model_prob": None,
            "actual_win_rate": None,
            "mean_predicted_edge": None,
            "realized_outperformance": None,
        }

    return {
        "start": (start.isoformat() if start else None),
        "end":   (end.isoformat()   if end   else None),
        "summary": {
            "combined": _record(rows),
            "ml":       _record(ml_rows),
            "total":    _record(total_rows),
        },
        "tier_hit_rates": tier_hit_rates,
        "pnl_curve": flat_pnl_curve,
        "calibration": calibration,
        "brier_score": brier,
        "edge_realization": edge_realization,
        "snapshot_coverage": snapshot_coverage,
    }


_ACTIONABLE_TIERS = {"STRONG LEAN", "LEAN"}


_UNIT_SCALE = 0.5  # global scale factor — keeps 1u = ~0.5% bankroll at sane exposure


def _pick_snapshot(analysis: dict, market: str) -> dict:
    """Extract the model-state snapshot for a pick from a serialized GameAnalysis.

    Returns a dict of the picked-side probabilities + edge metrics, ready to
    splat into a BetRecord constructor. All fields are picked-side oriented
    (matches `BetRecord.selection`), which is the natural form for calibration
    and Brier-score computation downstream.

    Both ML and Total branches of the model already orient their `*_p_shrunk`
    fields to the leaned side (see game_analyzer.py: `p_lean_side` for totals,
    `q_p_shrunk` for ML), so no per-side flipping is needed here.

    Returns None-valued fields when the underlying analysis lacks real odds
    (q_has_real_odds=False / qt_has_real_odds=False); the row will still be
    written so the pick is tracked, but it won't contribute to calibration.
    """
    if market == "moneyline":
        if not analysis.get("q_has_real_odds"):
            return {}
        return {
            "model_prob":          analysis.get("q_p_shrunk"),
            "market_implied_prob": analysis.get("q_shin_vig_free"),
            "edge":                analysis.get("q_edge_quant"),
            "p_edge_positive":     analysis.get("q_prob_positive"),
            "kelly_fraction_raw":  analysis.get("q_kelly_sized"),
            "evidence_quality":    analysis.get("q_evidence_quality"),
        }
    if market == "total":
        if not analysis.get("qt_has_real_odds"):
            return {}
        p_shrunk = analysis.get("qt_p_shrunk")
        edge     = analysis.get("qt_edge_quant")
        market_implied = (
            p_shrunk - edge if p_shrunk is not None and edge is not None else None
        )
        return {
            "model_prob":          p_shrunk,
            "market_implied_prob": market_implied,
            "edge":                edge,
            "p_edge_positive":     analysis.get("qt_prob_positive"),
            "kelly_fraction_raw":  analysis.get("qt_kelly_sized"),
            # Totals use a single evidence_quality input upstream; reuse the ML
            # field as a proxy — the value driving qt's shrinkage came from the
            # same `total_evidence_quality` term that's not exposed in the
            # serialized dataclass. Fall back to ML evidence_quality.
            "evidence_quality":    analysis.get("q_evidence_quality"),
        }
    return {}


def _kelly_units(kelly_sized: float) -> float:
    """Convert Kelly fraction to units using half-unit rounding, hard cap 1.5u.

    Normalization (1u = 1% of bankroll, scale 0.5x applied):
      < 0.25u raw  → 0.0  (model says no edge; skip)
      0.25u+       → round to nearest 0.5u, cap 3u, then scale by _UNIT_SCALE
      Final range: 0.5u – 1.5u
    """
    raw = kelly_sized * 100
    if raw < 0.25:
        return 0.0
    rounded = math.floor(raw * 2 + 0.5) / 2
    scaled = min(3.0, rounded) * _UNIT_SCALE
    return max(0.5, round(scaled * 2) / 2)  # re-snap to nearest 0.5u, floor 0.5


@app.post("/tracker/auto-track", tags=["tracker"])
def auto_track(
    game_date: date = Query(..., description="YYYY-MM-DD"),
    allow_started: bool = Query(default=False, description="If true, also track picks for games already started (manual backfill only)."),
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Automatically log all non-PASS picks for a date with Kelly-derived units.

    Idempotent — skips any (game_id, market) pair that already has a record.
    Returns a summary of how many bets were created vs already-tracked.
    """
    from app.models.entities import Team as TeamModel
    HomeTeam = aliased(TeamModel)
    AwayTeam = aliased(TeamModel)

    # ── Picks-locked gate ────────────────────────────────────────────────────
    # Auto-track runs multiple times per day (odds updates, cron re-runs). Once
    # any bet exists for this date, the slate is considered locked. New games
    # crossing the LEAN threshold on later runs will NOT be added. This prevents
    # deleted picks from re-appearing as new games or re-analyzed edges.
    # Bypass with allow_started=true for admin manual backfill.
    if not allow_started:
        existing_count = db.execute(
            select(func.count()).where(BetRecord.game_date == game_date)
        ).scalar() or 0
        if existing_count > 0:
            return {
                "created": 0,
                "skipped": existing_count,
                "locked": True,
                "message": f"Picks locked: {existing_count} bets already tracked for {game_date}. "
                           f"Use allow_started=true to force a re-run (admin backfill only).",
            }

    rows = db.execute(
        select(Game, HomeTeam, AwayTeam)
        .join(HomeTeam, Game.home_team_id == HomeTeam.id)
        .join(AwayTeam, Game.away_team_id == AwayTeam.id)
        .where(Game.game_date == game_date)
        .order_by(Game.id)
    ).all()

    created = 0
    skipped = 0
    skipped_started: list[dict] = []  # detailed log of picks lost to first-pitch gate

    from app.models.odds import OddsSnapshotRow

    now_utc = datetime.now(timezone.utc)

    for game, home_t, away_t in rows:
        # Skip games that have already started — picks placed after first pitch
        # are not actionable and should not be tracked. Log explicitly so
        # operators can see WHICH actionable picks were dropped (not just count).
        # Bypass the gate when allow_started=true (admin manual backfill).
        if game.game_time_utc and game.game_time_utc <= now_utc and not allow_started:
            skipped += 1
            # Only flag this as "lost" if the game had a real pick available.
            try:
                a = _build_analysis_cached(game.id, game_date, db) or {}
                if a.get("ml_tier") in _ACTIONABLE_TIERS or a.get("total_tier") in _ACTIONABLE_TIERS:
                    skipped_started.append({
                        "game_id": game.id,
                        "matchup": f"{away_t.abbr}@{home_t.abbr}",
                        "game_time_utc": game.game_time_utc.isoformat(),
                        "ml_tier": a.get("ml_tier"),
                        "total_tier": a.get("total_tier"),
                        "minutes_late": int((now_utc - game.game_time_utc).total_seconds() / 60),
                    })
            except Exception:
                pass
            continue

        analysis = _build_analysis_cached(game.id, game_date, db)
        if analysis is None:
            continue

        home_abbr = home_t.abbr
        away_abbr = away_t.abbr

        # ── Moneyline ────────────────────────────────────────────────────────
        if analysis.get("ml_tier") in _ACTIONABLE_TIERS:
            existing = db.execute(
                select(BetRecord).where(
                    BetRecord.game_id == game.id,
                    BetRecord.market == "moneyline",
                )
            ).scalar_one_or_none()
            excluded = db.execute(
                select(ExcludedPick).where(
                    ExcludedPick.game_id == game.id,
                    ExcludedPick.market == "moneyline",
                )
            ).scalar_one_or_none()
            if existing is None and excluded is None:
                # ml_lean is "HOME" or "AWAY" (not team abbr)
                lean = analysis.get("ml_lean", "")
                if lean == "HOME" or lean == home_abbr:
                    selection = home_abbr
                    odds = analysis.get("ml_american_odds", 0)
                else:
                    selection = away_abbr
                    away_team = db.get(Team, game.away_team_id)
                    away_frag = away_team.name.lower() if away_team else away_abbr.lower()
                    away_odds_row = db.execute(
                        select(OddsSnapshotRow.american_odds)
                        .where(
                            OddsSnapshotRow.game_id == game.id,
                            OddsSnapshotRow.market == "h2h",
                            OddsSnapshotRow.selection.ilike(f"%{away_frag}%"),
                        )
                        .order_by(OddsSnapshotRow.captured_at.desc())
                        .limit(1)
                    ).scalar_one_or_none()
                    odds = away_odds_row if away_odds_row is not None else analysis.get("ml_american_odds", 0)

                units = _kelly_units(analysis.get("q_kelly_sized", 0.01))
                if units == 0.0:
                    skipped += 1
                    continue
                snap = _pick_snapshot(analysis, "moneyline")
                db.add(BetRecord(
                    game_id=game.id,
                    game_date=game_date,
                    market="moneyline",
                    selection=selection,
                    american_odds=int(odds),
                    units=units,
                    tier=analysis["ml_tier"],
                    home_team_abbr=home_abbr,
                    away_team_abbr=away_abbr,
                    total_line=None,
                    projected_total=None,
                    result=None,
                    units_returned=None,
                    created_at=datetime.utcnow(),
                    snapshot_source="live",
                    **snap,
                ))
                created += 1
            else:
                skipped += 1

        # ── Total (over/under) ────────────────────────────────────────────────
        if analysis.get("total_tier") in _ACTIONABLE_TIERS:
            existing = db.execute(
                select(BetRecord).where(
                    BetRecord.game_id == game.id,
                    BetRecord.market == "total",
                )
            ).scalar_one_or_none()
            excluded = db.execute(
                select(ExcludedPick).where(
                    ExcludedPick.game_id == game.id,
                    ExcludedPick.market == "total",
                )
            ).scalar_one_or_none()
            if existing is None and excluded is None:
                total_lean = analysis.get("total_lean", "OVER")
                if total_lean not in ("OVER", "UNDER"):
                    proj = analysis.get("projected_total")
                    line = analysis.get("total_line")
                    total_lean = "OVER" if (proj and line and proj > line) else "UNDER"

                side_frag = "over" if total_lean == "OVER" else "under"
                total_odds_row = db.execute(
                    select(OddsSnapshotRow.american_odds)
                    .where(
                        OddsSnapshotRow.game_id == game.id,
                        OddsSnapshotRow.market == "totals",
                        OddsSnapshotRow.selection.ilike(f"%{side_frag}%"),
                    )
                    .order_by(OddsSnapshotRow.captured_at.desc())
                    .limit(1)
                ).scalar_one_or_none()
                total_odds = int(total_odds_row) if total_odds_row is not None else -110

                units = _kelly_units(analysis.get("qt_kelly_sized", 0.01))
                if units == 0.0:
                    skipped += 1
                    continue
                snap = _pick_snapshot(analysis, "total")
                db.add(BetRecord(
                    game_id=game.id,
                    game_date=game_date,
                    market="total",
                    selection=total_lean,
                    american_odds=total_odds,
                    units=units,
                    tier=analysis["total_tier"],
                    home_team_abbr=home_abbr,
                    away_team_abbr=away_abbr,
                    total_line=analysis.get("total_line"),
                    projected_total=analysis.get("projected_total"),
                    result=None,
                    units_returned=None,
                    created_at=datetime.utcnow(),
                    snapshot_source="live",
                    **snap,
                ))
                created += 1
            else:
                skipped += 1

    db.commit()
    return {
        "created": created,
        "skipped": skipped,
        "skipped_started": skipped_started,
        "date": game_date.isoformat(),
    }


@app.post("/admin/backfill-pick-snapshots", tags=["admin"])
def backfill_pick_snapshots(
    limit: int = Query(default=500, ge=1, le=2000),
    dry_run: bool = Query(default=False),
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """One-shot replay-backfill of model state for BetRecord rows that predate
    live snapshot capture (snapshot_source IS NULL).

    For each candidate row, we call `build_game_analysis(game_id, as_of=game_date, db)`
    and extract the picked-side model state via `_pick_snapshot`. Result is
    persisted with `snapshot_source="replay-<today>"` so downstream calibration
    can distinguish replay-derived rows from live-captured ones.

    Caveats — these matter for honest interpretation downstream:
    1. The model code in this commit may have drifted from the code that
       originally produced the pick. Replay numbers approximate, not recover,
       what the model said at the moment of the pick.
    2. Replay uses current DB state filtered `as_of=game_date`. If any
       backfilling ingestion since the original pick added stats that
       weren't visible at pick time, the replay may use richer data than the
       live model had.

    Both caveats argue for surfacing the replay/live distinction in any UI
    that reports calibration. Cf. snapshot_source on BetRecord.
    """
    from app.betting.analysis_builder import build_game_analysis
    from datetime import date as _date

    candidates = db.execute(
        select(BetRecord)
        .where(BetRecord.snapshot_source.is_(None))
        .order_by(BetRecord.game_date.asc(), BetRecord.id.asc())
        .limit(limit)
    ).scalars().all()

    today_str = _date.today().isoformat()
    tag = f"replay-{today_str}"

    updated = 0
    no_analysis = 0
    no_odds = 0
    skipped_unknown_market = 0

    for bet in candidates:
        analysis_obj = build_game_analysis(bet.game_id, bet.game_date, db)
        if analysis_obj is None:
            no_analysis += 1
            continue

        # _pick_snapshot wants the serialized dict form
        import dataclasses
        analysis = dataclasses.asdict(analysis_obj)

        snap = _pick_snapshot(analysis, bet.market)

        if not snap:
            # No real odds at replay time → can't compute a meaningful snapshot.
            # Still flag the row as replay-attempted so we don't retry forever.
            no_odds += 1
            if not dry_run:
                bet.snapshot_source = f"{tag}-no-odds"
            continue

        if bet.market not in ("moneyline", "total"):
            skipped_unknown_market += 1
            continue

        if not dry_run:
            for field, value in snap.items():
                setattr(bet, field, value)
            bet.snapshot_source = tag

        updated += 1

    if not dry_run:
        db.commit()

    return {
        "candidates": len(candidates),
        "updated": updated,
        "no_analysis": no_analysis,
        "no_odds": no_odds,
        "skipped_unknown_market": skipped_unknown_market,
        "dry_run": dry_run,
        "snapshot_source_tag": tag,
    }


def _auto_settle_impl(db: Session, game_date: date) -> dict:
    """Core settlement logic, callable internally (no admin auth).

    Reads unsettled bets for game_date, settles any whose game reached a terminal
    MLB status with valid scores. Idempotent.
    """
    unsettled = db.execute(
        select(BetRecord)
        .where(BetRecord.game_date == game_date, BetRecord.result.is_(None))
        .order_by(BetRecord.game_id)
    ).scalars().all()

    if not unsettled:
        return {"settled": 0, "skipped_not_final": 0, "skipped_no_score": 0, "date": game_date.isoformat(), "detail": "No unsettled bets found"}

    game_ids = list({b.game_id for b in unsettled})
    games_by_id: dict[int, Game] = {
        g.id: g
        for g in db.execute(select(Game).where(Game.id.in_(game_ids))).scalars().all()
    }
    team_abbrs: dict[int, str] = {
        t.id: t.abbr
        for t in db.execute(select(Team)).scalars().all()
    }

    settled_count = skipped_not_final = skipped_no_score = 0
    results = []

    for bet in unsettled:
        game = games_by_id.get(bet.game_id)
        # MLB terminal statuses: "Final", "Game Over", "Completed Early" (rain/mercy)
        _TERMINAL = ("Final", "Game Over", "Completed Early")
        if game is None or not any(t in game.status for t in _TERMINAL):
            skipped_not_final += 1
            continue

        home_abbr = team_abbrs.get(game.home_team_id, bet.home_team_abbr)
        away_abbr = team_abbrs.get(game.away_team_id, bet.away_team_abbr)

        if bet.market == "moneyline":
            if game.home_score is None or game.away_score is None:
                skipped_no_score += 1
                continue
            if game.home_score == game.away_score:
                result = "PUSH"
            elif bet.selection == home_abbr:
                result = "WIN" if game.home_score > game.away_score else "LOSS"
            else:
                result = "WIN" if game.away_score > game.home_score else "LOSS"

        elif bet.market == "total":
            if game.home_score is None or game.away_score is None or bet.total_line is None:
                skipped_no_score += 1
                continue
            actual = game.home_score + game.away_score
            if actual == bet.total_line:
                result = "PUSH"
            elif bet.selection == "OVER":
                result = "WIN" if actual > bet.total_line else "LOSS"
            else:
                result = "WIN" if actual < bet.total_line else "LOSS"
        else:
            skipped_no_score += 1
            continue

        bet.result = result
        bet.units_returned = compute_units_returned(result, bet.units, bet.american_odds)
        settled_count += 1
        results.append({
            "bet_id": bet.id,
            "game": f"{away_abbr}@{home_abbr}",
            "market": bet.market,
            "selection": bet.selection,
            "result": result,
            "score": f"{game.away_score}-{game.home_score}",
            "units_returned": round(bet.units_returned, 4),
        })

    db.commit()
    return {
        "date": game_date.isoformat(),
        "settled": settled_count,
        "skipped_not_final": skipped_not_final,
        "skipped_no_score": skipped_no_score,
        "bets": results,
    }


@app.post("/tracker/auto-settle", tags=["tracker"])
def auto_settle(
    game_date: date = Query(..., description="YYYY-MM-DD — settle all Final games on this date"),
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Settle all unsettled bets on a date using final scores from the games table.

    Admin-gated wrapper around _auto_settle_impl. Idempotent.
    """
    return _auto_settle_impl(db, game_date)


@app.post("/tracker/normalize-units", tags=["tracker"])
def normalize_units(
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Re-apply the current _kelly_units formula to all existing bet records.

    Treats each bet's stored units value as the raw kelly_sized * 100 input,
    re-normalizes using the half-unit rounding / 3u cap formula, and recomputes
    units_returned for settled bets. Idempotent — safe to run multiple times.

    Returns counts of updated and unchanged records.
    """
    bets = db.execute(select(BetRecord)).scalars().all()
    updated = 0
    unchanged = 0

    for bet in bets:
        # Scale stored units by _UNIT_SCALE, re-snap to nearest 0.5u, floor 0.5u.
        # We scale the stored value directly (not via kelly_sized) because historical
        # bets went through the pre-scale formula and need a proportional reduction.
        scaled = bet.units * _UNIT_SCALE
        new_units = max(0.5, round(scaled * 2) / 2)

        units_changed = abs(new_units - bet.units) > 0.001

        if units_changed:
            bet.units = new_units
            if bet.result is not None:
                bet.units_returned = compute_units_returned(
                    bet.result, bet.units, bet.american_odds
                )
            updated += 1
        else:
            unchanged += 1

    db.commit()
    return {"updated": updated, "unchanged": unchanged, "total": len(bets)}


@app.post("/tracker/apply-gap-taper", tags=["tracker"])
def apply_gap_taper(
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Apply projection-vs-line gap taper to existing total bets.

    For each total bet with a stored projected_total and total_line:
      gap < 0.25  → delete (would not have been tracked)
      gap < 0.50  → halve units (re-snap to nearest 0.5u, floor 0.5u)
      gap >= 0.50 → unchanged

    Moneyline bets are never touched.
    Returns deleted/updated/unchanged counts.
    """
    bets = db.execute(
        select(BetRecord).where(BetRecord.market == "total")
    ).scalars().all()

    deleted   = 0
    updated   = 0
    unchanged = 0
    deleted_ids: list[int] = []

    for bet in bets:
        proj = bet.projected_total
        line = bet.total_line
        if proj is None or line is None:
            unchanged += 1
            continue

        gap = abs(proj - line)

        if gap < 0.25:
            deleted_ids.append(bet.id)
            db.delete(bet)
            deleted += 1

        elif gap < 0.5:
            new_units = max(0.5, round(bet.units * 0.5 * 2) / 2)
            if abs(new_units - bet.units) > 0.001:
                bet.units = new_units
                if bet.result is not None:
                    bet.units_returned = compute_units_returned(
                        bet.result, bet.units, bet.american_odds
                    )
                updated += 1
            else:
                unchanged += 1
        else:
            unchanged += 1

    db.commit()
    return {
        "deleted": deleted,
        "updated": updated,
        "unchanged": unchanged,
        "total": len(bets),
        "deleted_ids": deleted_ids,
    }


# ---------------------------------------------------------------------------
# Admin — server-side ingestion
# Runs run_pregame_update.py as a subprocess so it executes on the Render VM,
# eliminating the ~100ms-per-query network round-trip from local machines.
# ---------------------------------------------------------------------------

_INGESTION_JOBS: Dict[str, Dict] = {}   # job_id → {status, started_at, as_of, log_lines, error}
_INGESTION_LOCK = threading.Lock()


def _run_ingestion_subprocess(job_id: str, as_of: date) -> None:
    job = _INGESTION_JOBS[job_id]
    job["status"] = "running"
    try:
        script = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "run_pregame_update.py")
        script = os.path.abspath(script)
        history_days = os.environ.get("PREGAME_HISTORY_DAYS", "0")  # 0 = full season since Mar 1
        cmd = [sys.executable, script, "--date", as_of.isoformat(), "--history-days", history_days]
        job["log_lines"].append(f"Launching ingestion command: {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        for line in proc.stdout:
            job["log_lines"].append(line.rstrip())
        proc.wait()
        if proc.returncode == 0:
            job["status"] = "done"
        else:
            job["status"] = "error"
            job["error"] = f"Process exited with code {proc.returncode}"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        logging.getLogger("admin.ingestion").exception("Ingestion job %s failed", job_id)


@app.post("/admin/run-ingestion")
def trigger_ingestion(
    game_date: Optional[date] = Query(default=None),
    _: None = Depends(_require_admin),
):
    """
    Trigger a full pregame ingestion run server-side (runs on the Render VM).
    Returns a job_id immediately; poll /admin/ingestion-status/{job_id} for progress.
    Idempotent: if a job is already running for the same date, returns its job_id.
    """
    if game_date is None:
        # Default to "today" in America/New_York — Render runs UTC and a UTC
        # default would roll over to tomorrow's date during the 8 PM ET – 8 PM
        # PT slate, causing the cron-driven ingest to target the wrong slate.
        try:
            from zoneinfo import ZoneInfo
            game_date = datetime.now(ZoneInfo("America/New_York")).date()
        except Exception:
            game_date = date.today()

    with _INGESTION_LOCK:
        # Prevent double-starts for the same date if already in flight
        for jid, job in _INGESTION_JOBS.items():
            if job["as_of"] == game_date.isoformat() and job["status"] == "running":
                return {"job_id": jid, "as_of": game_date.isoformat(), "status": "already_running"}

        job_id = uuid.uuid4().hex[:12]
        _INGESTION_JOBS[job_id] = {
            "status": "queued",
            "started_at": datetime.utcnow().isoformat() + "Z",
            "as_of": game_date.isoformat(),
            "log_lines": [],
            "error": None,
        }

    t = threading.Thread(target=_run_ingestion_subprocess, args=(job_id, game_date), daemon=True)
    t.start()
    return {"job_id": job_id, "as_of": game_date.isoformat(), "status": "queued"}


@app.get("/admin/ingestion-status/{job_id}")
def ingestion_status(job_id: str, tail: int = Query(default=100, ge=1, le=2000)):
    """
    Check the status and recent log output of an ingestion job.
    tail=N returns the last N log lines (default 100).
    """
    job = _INGESTION_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found. It may have expired.")
    return {
        "job_id": job_id,
        "status": job["status"],
        "started_at": job["started_at"],
        "as_of": job["as_of"],
        "error": job["error"],
        "log_lines_total": len(job["log_lines"]),
        "log_tail": job["log_lines"][-tail:],
    }


@app.get("/admin/ingestion-jobs")
def list_ingestion_jobs():
    """List all ingestion jobs (running, done, error) in this server process lifetime."""
    return [
        {
            "job_id": jid,
            "status": job["status"],
            "started_at": job["started_at"],
            "as_of": job["as_of"],
            "log_lines_total": len(job["log_lines"]),
            "error": job["error"],
        }
        for jid, job in _INGESTION_JOBS.items()
    ]


# ---------------------------------------------------------------------------
# Live tick — cron-job.org pings this every minute during game hours
# Refreshes scores, settles bets, kicks off next-day ingestion when all
# today's games are terminal.
# ---------------------------------------------------------------------------

_POST_FINAL_DONE: dict[str, str] = {}   # iso_date → job_id (already kicked off)
_LAST_ESPN_REFRESH: dict[str, datetime] = {}  # iso_date → last ESPN refresh time
_ESPN_REFRESH_INTERVAL_MIN = 20  # how often to refresh odds via ESPN (free, unlimited)
_TICK_LOCK = threading.Lock()

_TERMINAL_STATUSES = ("Final", "Game Over", "Completed Early")


def _snapshot_probable_pitchers(db: Session, game_date: date) -> dict[int, tuple]:
    """Return {game_id: (home_pitcher_id, away_pitcher_id)} for a given date."""
    rows = db.execute(text("""
        SELECT id, home_probable_starter_id, away_probable_starter_id
        FROM games WHERE game_date = :dt
    """), {"dt": game_date.isoformat()}).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


def _today_et() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return date.today()


def _all_today_terminal(db: Session, game_date: date) -> tuple[bool, int, int]:
    """Returns (all_terminal, terminal_count, total_count) for the given date."""
    rows = db.execute(
        select(Game.status).where(Game.game_date == game_date)
    ).scalars().all()
    if not rows:
        return False, 0, 0
    total = len(rows)
    terminal = sum(1 for s in rows if s and any(t in s for t in _TERMINAL_STATUSES))
    return terminal == total, terminal, total


@app.post("/admin/tick")
def live_tick(
    db: Session = Depends(_get_db),
    _: None = Depends(_require_admin),
):
    """Lightweight periodic tick.

    1. Refresh today's schedule (updates game.status + scores from MLB).
    2. Settle any newly-terminal bets.
    3. If all today's games terminal AND post-final pipeline not yet run today,
       kick off ingestion for tomorrow in a background thread.

    Designed to be called every 60s by cron-job.org during game hours.
    Idempotent and cheap.
    """
    from app.ingestion.mlb_stats_api import MLBStatsClient, ingest_schedule

    from app.ingestion import espn_odds as _free_odds

    today = _today_et()
    summary: dict = {"date": today.isoformat()}

    # 1. Snapshot probable pitchers BEFORE refresh so we can detect scratches.
    try:
        pitchers_before = _snapshot_probable_pitchers(db, today)
    except Exception as exc:
        pitchers_before = {}
        summary["pitcher_snapshot_error"] = str(exc)[:200]

    # 2. Refresh today's schedule (cheap MLB API call)
    try:
        with MLBStatsClient() as client:
            game_ids = ingest_schedule(db, client, today, game_type="R")
        db.commit()
        summary["schedule_refreshed"] = len(game_ids)
    except Exception as exc:
        db.rollback()
        summary["schedule_error"] = str(exc)[:200]

    # 3. Detect probable-pitcher changes (scratches, swap-ins)
    try:
        pitchers_after = _snapshot_probable_pitchers(db, today)
    except Exception as exc:
        pitchers_after = {}
        summary["pitcher_snapshot_error_after"] = str(exc)[:200]
    pitcher_changes: list[dict] = []
    for gid, (h_after, a_after) in pitchers_after.items():
        h_before, a_before = pitchers_before.get(gid, (None, None))
        if h_after != h_before or a_after != a_before:
            pitcher_changes.append({"game_id": gid, "home": [h_before, h_after], "away": [a_before, a_after]})
    if pitcher_changes:
        summary["pitcher_changes"] = pitcher_changes

    # 4. Odds management — tiered strategy to preserve paid quota:
    #    a) No odds at all → full paid ingest (cold-start self-heal)
    #    b) Pitcher scratched → paid re-ingest, just affected games
    #    c) Periodic refresh every 20 min via ESPN (free, unlimited)
    try:
        odds_count = db.execute(text("""
            SELECT COUNT(*) FROM odds_snapshots os
            JOIN games g ON os.game_id = g.id
            WHERE g.game_date = :dt
        """), {"dt": today.isoformat()}).scalar() or 0
        games_today = db.execute(
            select(Game).where(Game.game_date == today)
        ).scalars().all()

        from scripts.run_pregame_update import (
            _ingest_odds_and_weather,
            _map_odds_event_ids,
            _pick_odds_provider,
        )

        triggered_refresh = False
        # 4a. Cold start: no odds at all → full paid ingest
        if odds_count == 0 and games_today:
            provider = _pick_odds_provider()
            _map_odds_event_ids(db, today, provider=provider)
            _ingest_odds_and_weather(db, games_today, today, provider=provider)
            db.commit()
            triggered_refresh = True
            summary["odds_action"] = "cold_start_paid"
        # 4b. Pitcher scratch → paid re-ingest for affected games only
        elif pitcher_changes and games_today:
            changed_ids = {c["game_id"] for c in pitcher_changes}
            affected = [g for g in games_today if g.id in changed_ids]
            if affected:
                provider = _pick_odds_provider()
                _map_odds_event_ids(db, today, provider=provider)
                _ingest_odds_and_weather(db, affected, today, provider=provider)
                db.commit()
                triggered_refresh = True
                summary["odds_action"] = f"pitcher_change_paid:{len(affected)}_games"
        # 4c. Periodic ESPN refresh — keeps lines fresh, free
        elif games_today:
            last_refresh = _LAST_ESPN_REFRESH.get(today.isoformat())
            now = datetime.now(timezone.utc)
            if last_refresh is None or (now - last_refresh).total_seconds() / 60 >= _ESPN_REFRESH_INTERVAL_MIN:
                _map_odds_event_ids(db, today, provider=_free_odds)
                _ingest_odds_and_weather(db, games_today, today, provider=_free_odds)
                db.commit()
                _LAST_ESPN_REFRESH[today.isoformat()] = now
                triggered_refresh = True
                summary["odds_action"] = "periodic_espn_refresh"
            else:
                summary["odds_action"] = "skip"

        summary["odds_snapshots"] = db.execute(text("""
            SELECT COUNT(*) FROM odds_snapshots os
            JOIN games g ON os.game_id = g.id
            WHERE g.game_date = :dt
        """), {"dt": today.isoformat()}).scalar() or 0

        if triggered_refresh:
            _cache_invalidate_all()
    except Exception as exc:
        db.rollback()
        summary["odds_error"] = str(exc)[:200]

    # 2. Settle today's bets that just reached terminal
    try:
        settle_result = _auto_settle_impl(db, today)
        summary["settled"] = settle_result.get("settled", 0)
        summary["skipped_not_final"] = settle_result.get("skipped_not_final", 0)
        summary["skipped_no_score"] = settle_result.get("skipped_no_score", 0)
    except Exception as exc:
        db.rollback()
        summary["settle_error"] = str(exc)[:200]

    # 3. Post-final trigger: all today's games done + not already kicked off
    all_done, terminal_count, total_count = _all_today_terminal(db, today)
    summary["terminal_games"] = f"{terminal_count}/{total_count}"

    if all_done and total_count > 0:
        with _TICK_LOCK:
            if today.isoformat() not in _POST_FINAL_DONE:
                # Kick off tomorrow's pregame ingestion in a thread
                tomorrow = today + timedelta(days=1)
                job_id = uuid.uuid4().hex[:12]
                _INGESTION_JOBS[job_id] = {
                    "status": "queued",
                    "started_at": datetime.utcnow().isoformat() + "Z",
                    "as_of": tomorrow.isoformat(),
                    "log_lines": ["Auto-triggered by /admin/tick (post-final)"],
                    "error": None,
                }
                _POST_FINAL_DONE[today.isoformat()] = job_id
                t = threading.Thread(
                    target=_run_ingestion_subprocess,
                    args=(job_id, tomorrow),
                    daemon=True,
                )
                t.start()
                summary["post_final_kicked_off"] = {"job_id": job_id, "for_date": tomorrow.isoformat()}
            else:
                summary["post_final_kicked_off"] = "already_done_today"

    return summary


# ---------------------------------------------------------------------------
# Chat endpoint
# ---------------------------------------------------------------------------

from pydantic import BaseModel as PydanticModel

class ChatRequest(PydanticModel):
    message: str
    date: Optional[str] = None  # ISO date string, defaults to today ET


class ChatResponse(PydanticModel):
    answer: str
    intent: str
    sources_count: int


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(_get_db)):
    from app.chat.classifier import classify
    from app.chat.retrieval import get_context_for_intent
    from app.chat.synthesizer import synthesize

    settings = get_settings()
    if not settings.has_groq:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY not configured")

    today = date.today()
    if req.date:
        try:
            today = date.fromisoformat(req.date)
        except ValueError:
            pass

    classified = classify(req.message, today)
    print(
        f"[CHAT] intent={classified.intent} teams={classified.entities.team_abbrs}"
        f" players={classified.entities.player_names} date={classified.entities.query_date}",
        flush=True,
    )
    docs = get_context_for_intent(
        db=db,
        intent=classified.intent,
        team_abbr=classified.entities.team_abbr,
        team_abbrs=classified.entities.team_abbrs,
        query_date=classified.entities.query_date,
        today=today,
        player_name=classified.entities.player_name,
        player_names=classified.entities.player_names,
    )
    print(f"[CHAT] sources={len(docs)}", flush=True)

    answer = synthesize(
        intent=classified.intent,
        question=req.message,
        context_docs=docs,
        today=today,
        groq_api_key=settings.groq_api_key,
    )

    return ChatResponse(
        answer=answer,
        intent=classified.intent,
        sources_count=len(docs),
    )
