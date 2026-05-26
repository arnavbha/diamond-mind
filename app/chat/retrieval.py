"""SQL retrieval functions — one per intent.

Each function takes a db session + entities and returns a list of
plain dicts (context documents) to pass to the synthesizer.
Never generates SQL dynamically — all queries are parameterized templates.
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rows(db: Session, sql: str, params: dict) -> list[dict]:
    result = db.execute(text(sql), params)
    cols = list(result.keys())
    return [dict(zip(cols, row)) for row in result.fetchall()]


# Cached player name list for fuzzy matching. Refreshes after TTL.
_NAME_CACHE: dict[str, Any] = {"ts": 0.0, "names": [], "by_name": {}}
_NAME_CACHE_TTL = 3600  # 1 hour


def _load_player_names(db: Session) -> tuple[list[str], dict[str, dict]]:
    """Cached load of all player full names + metadata for fuzzy matching."""
    now = time.time()
    if now - _NAME_CACHE["ts"] < _NAME_CACHE_TTL and _NAME_CACHE["names"]:
        return _NAME_CACHE["names"], _NAME_CACHE["by_name"]
    rows = _rows(db, """
        SELECT id, full_name, primary_position, bats, throws, current_team_id
        FROM players
    """, {})
    by_name: dict[str, dict] = {r["full_name"]: r for r in rows if r.get("full_name")}
    names = list(by_name.keys())
    _NAME_CACHE.update({"ts": now, "names": names, "by_name": by_name})
    return names, by_name


def _resolve_player_fuzzy(
    db: Session,
    candidate: str,
    cutoff: int = 75,
) -> list[dict]:
    """Find player rows by name. LIKE first; rapidfuzz fallback on miss.

    Returns up to 3 player rows. Empty list if no plausible match.
    """
    # Exact / substring (LIKE) first — cheap and precise
    name_parts = candidate.strip().split()
    if not name_parts:
        return []
    like_clauses = " AND ".join(f"full_name LIKE :p{i}" for i in range(len(name_parts)))
    params: dict = {f"p{i}": f"%{part}%" for i, part in enumerate(name_parts)}
    hits = _rows(db, f"""
        SELECT id, full_name, primary_position, bats, throws, current_team_id
        FROM players
        WHERE {like_clauses}
        LIMIT 3
    """, params)
    if hits:
        return hits

    # Fuzzy fallback
    try:
        from rapidfuzz import process, fuzz
    except ImportError:
        return []
    names, by_name = _load_player_names(db)
    if not names:
        return []
    matches = process.extract(candidate, names, scorer=fuzz.WRatio, limit=3, score_cutoff=cutoff)
    return [by_name[m[0]] for m in matches if m[0] in by_name]


# ---------------------------------------------------------------------------
# Intent retrievals
# ---------------------------------------------------------------------------

def get_picks_for_date(db: Session, query_date: date) -> list[dict]:
    """All bet records for a given date with game context."""
    sql = """
        SELECT
            br.id,
            br.game_date,
            br.market,
            br.selection,
            br.american_odds,
            br.units,
            br.tier,
            br.result,
            br.units_returned,
            br.total_line,
            br.projected_total,
            ht.abbr  AS home_abbr,
            at_.abbr AS away_abbr,
            g.venue
        FROM bet_records br
        JOIN games       g   ON br.game_id    = g.id
        JOIN teams       ht  ON g.home_team_id = ht.id
        JOIN teams       at_ ON g.away_team_id = at_.id
        WHERE br.game_date = :dt
        ORDER BY
            CASE br.tier
                WHEN 'STRONG LEAN' THEN 1
                WHEN 'LEAN'        THEN 2
                ELSE 3
            END,
            br.created_at
    """
    return _rows(db, sql, {"dt": str(query_date)})


def get_picks_for_team(
    db: Session,
    team_abbrs: list[str] | str,
    days_back: int = 14,
    today: Optional[date] = None,
) -> list[dict]:
    """Recent picks where one of the given teams was home or away.

    Accepts a list (multi-team comparison) or a string (back-compat).
    """
    if today is None:
        today = date.today()
    start = today - timedelta(days=days_back)

    if isinstance(team_abbrs, str):
        team_abbrs = [team_abbrs]
    team_abbrs = [t for t in team_abbrs if t]
    if not team_abbrs:
        return []

    # Build IN clause with bind params
    placeholders = ",".join(f":t{i}" for i in range(len(team_abbrs)))
    params: dict = {f"t{i}": t for i, t in enumerate(team_abbrs)}
    params["start"] = str(start)

    sql = f"""
        SELECT
            br.game_date,
            br.market,
            br.selection,
            br.american_odds,
            br.tier,
            br.result,
            br.units_returned,
            ht.abbr  AS home_abbr,
            at_.abbr AS away_abbr
        FROM bet_records br
        JOIN games       g   ON br.game_id    = g.id
        JOIN teams       ht  ON g.home_team_id = ht.id
        JOIN teams       at_ ON g.away_team_id = at_.id
        WHERE (ht.abbr IN ({placeholders}) OR at_.abbr IN ({placeholders}))
          AND br.game_date >= :start
        ORDER BY br.game_date DESC
        LIMIT 40
    """
    return _rows(db, sql, params)


def get_tracker_record(
    db: Session,
    days_back: int = 30,
    today: Optional[date] = None,
) -> list[dict]:
    """Aggregate betting record: W/L/push counts + units by tier."""
    if today is None:
        today = date.today()
    start = today - timedelta(days=days_back)

    # Overall record
    overall_sql = """
        SELECT
            result,
            COUNT(*)              AS count,
            ROUND(SUM(COALESCE(units_returned, 0)), 2) AS total_units
        FROM bet_records
        WHERE result IS NOT NULL
          AND game_date >= :start
        GROUP BY result
        ORDER BY result
    """

    # By tier
    tier_sql = """
        SELECT
            tier,
            result,
            COUNT(*) AS count,
            ROUND(SUM(COALESCE(units_returned, 0)), 2) AS total_units
        FROM bet_records
        WHERE result IS NOT NULL
          AND game_date >= :start
        GROUP BY tier, result
        ORDER BY tier, result
    """

    overall = _rows(db, overall_sql, {"start": str(start)})
    by_tier = _rows(db, tier_sql, {"start": str(start)})

    # Pending count
    pending_sql = """
        SELECT COUNT(*) AS pending
        FROM bet_records
        WHERE result IS NULL
          AND game_date >= :start
    """
    pending = _rows(db, pending_sql, {"start": str(start)})

    return [
        {"type": "overall", "window_days": days_back, "rows": overall},
        {"type": "by_tier", "rows": by_tier},
        {"type": "pending", "count": pending[0]["pending"] if pending else 0},
    ]


def get_bullpen_vulnerability(db: Session, query_date: date) -> list[dict]:
    """Bullpen vulnerability scores for a given date, sorted highest first."""
    sql = """
        SELECT
            t.abbr,
            t.name,
            bf.vulnerability_score,
            bf.fatigue_score,
            bf.overall_bullpen_quality,
            bf.available_bullpen_quality,
            bf.as_of_date
        FROM bullpen_fatigue bf
        JOIN teams t ON bf.team_id = t.id
        WHERE bf.as_of_date = :dt
        ORDER BY bf.vulnerability_score DESC NULLS LAST
    """
    rows = _rows(db, sql, {"dt": str(query_date)})

    # Fallback: most recent available if exact date missing
    if not rows:
        fallback_sql = """
            SELECT
                t.abbr,
                t.name,
                bf.vulnerability_score,
                bf.fatigue_score,
                bf.overall_bullpen_quality,
                bf.available_bullpen_quality,
                bf.as_of_date
            FROM bullpen_fatigue bf
            JOIN teams t ON bf.team_id = t.id
            WHERE bf.as_of_date = (
                SELECT MAX(as_of_date) FROM bullpen_fatigue WHERE as_of_date <= :dt
            )
            ORDER BY bf.vulnerability_score DESC NULLS LAST
        """
        rows = _rows(db, fallback_sql, {"dt": str(query_date)})

    return rows


def get_model_explanation(
    db: Session,
    game_date: date,
    team_abbr: Optional[str] = None,
) -> list[dict]:
    """BetEvaluation rows with supporting/opposing factors for explanation."""
    if team_abbr:
        sql = """
            SELECT
                be.market,
                be.selection,
                be.current_odds,
                be.estimated_probability,
                be.implied_probability,
                be.edge,
                be.confidence_score,
                be.recommendation,
                be.supporting_factors,
                be.opposing_factors,
                be.uncertainty_flags,
                be.what_would_change_the_answer,
                be.generated_at,
                ht.abbr  AS home_abbr,
                at_.abbr AS away_abbr
            FROM bet_evaluations be
            JOIN games       g   ON be.game_id    = g.id
            JOIN teams       ht  ON g.home_team_id = ht.id
            JOIN teams       at_ ON g.away_team_id = at_.id
            WHERE DATE(be.generated_at) = :dt
              AND (ht.abbr = :abbr OR at_.abbr = :abbr)
            ORDER BY be.generated_at DESC
            LIMIT 5
        """
        return _rows(db, sql, {"dt": str(game_date), "abbr": team_abbr})
    else:
        sql = """
            SELECT
                be.market,
                be.selection,
                be.current_odds,
                be.estimated_probability,
                be.implied_probability,
                be.edge,
                be.confidence_score,
                be.recommendation,
                be.supporting_factors,
                be.opposing_factors,
                be.uncertainty_flags,
                be.what_would_change_the_answer,
                be.generated_at,
                ht.abbr  AS home_abbr,
                at_.abbr AS away_abbr
            FROM bet_evaluations be
            JOIN games       g   ON be.game_id    = g.id
            JOIN teams       ht  ON g.home_team_id = ht.id
            JOIN teams       at_ ON g.away_team_id = at_.id
            WHERE DATE(be.generated_at) = :dt
              AND be.recommendation IN ('STRONG LEAN', 'LEAN')
            ORDER BY be.confidence_score DESC
            LIMIT 8
        """
        return _rows(db, sql, {"dt": str(game_date)})


def get_player_stats(
    db: Session,
    player_names: list[str] | str,
    as_of: Optional[date] = None,
) -> list[dict]:
    """Resolve one or many player names (with fuzzy fallback) and return form-window stats.

    Accepts a list (multi-player comparison) or a single string (back-compat).
    Pulls from pitcher_form_windows / player_form_windows; falls back to raw
    game logs when those tables are empty (e.g. on prod before pregame run).
    """
    if as_of is None:
        as_of = date.today()

    # Accept str (legacy) or list[str]
    if isinstance(player_names, str):
        player_names = [player_names]

    # Resolve each candidate name to player rows (with fuzzy fallback)
    player_rows: list[dict] = []
    seen_ids: set[int] = set()
    for candidate in player_names:
        for p in _resolve_player_fuzzy(db, candidate):
            if p["id"] not in seen_ids:
                seen_ids.add(p["id"])
                player_rows.append(p)

    if not player_rows:
        return []

    results = []
    for player in player_rows:
        pid = player["id"]
        pos = player.get("primary_position", "")

        # --- Pitcher form windows ---
        if pos in ("P", "SP", "RP") or not pos:
            pitcher_rows = _rows(db, """
                SELECT
                    "window",
                    as_of_date,
                    starts,
                    innings_pitched,
                    era,
                    fip,
                    xfip,
                    babip,
                    whip,
                    k_per_9,
                    bb_per_9,
                    hr_per_9,
                    avg_pitches_per_start,
                    avg_innings_per_start,
                    trend_label,
                    insufficient_sample
                FROM pitcher_form_windows
                WHERE pitcher_id = :pid
                  AND as_of_date = (
                      SELECT MAX(as_of_date) FROM pitcher_form_windows
                      WHERE pitcher_id = :pid AND as_of_date <= :as_of
                  )
                ORDER BY
                    CASE "window"
                        WHEN 'season'         THEN 1
                        WHEN 'last_10_starts' THEN 2
                        WHEN 'last_5_starts'  THEN 3
                        ELSE 4
                    END
            """, {"pid": pid, "as_of": str(as_of)})

            if pitcher_rows:
                results.append({
                    "player": player["full_name"],
                    "position": pos or "P",
                    "type": "pitcher",
                    "windows": pitcher_rows,
                })
            else:
                # Fallback: compute from raw game logs when form windows aren't populated
                start = as_of - timedelta(days=60)
                raw = _rows(db, """
                    SELECT
                        COUNT(*)  AS appearances,
                        SUM(CASE WHEN started=1 THEN 1 ELSE 0 END) AS starts,
                        ROUND(SUM(innings_pitched), 1) AS innings_pitched,
                        ROUND(
                            CASE WHEN SUM(innings_pitched) > 0
                            THEN SUM(earned_runs) * 9.0 / SUM(innings_pitched)
                            ELSE NULL END, 2) AS era,
                        ROUND(
                            CASE WHEN SUM(innings_pitched) > 0
                            THEN (SUM(walks) + SUM(hits_allowed)) * 1.0 / SUM(innings_pitched)
                            ELSE NULL END, 3) AS whip,
                        SUM(strikeouts) AS k,
                        SUM(walks) AS bb,
                        MAX(game_date) AS last_game
                    FROM pitcher_game_logs
                    WHERE pitcher_id = :pid
                      AND game_date >= :start AND game_date <= :as_of
                """, {"pid": pid, "start": str(start), "as_of": str(as_of)})
                if raw and raw[0].get("appearances", 0):
                    r = raw[0]
                    ip = r.get("innings_pitched") or 0
                    k_per_9 = round(r["k"] * 9.0 / ip, 1) if ip else None
                    bb_per_9 = round(r["bb"] * 9.0 / ip, 1) if ip else None
                    results.append({
                        "player": player["full_name"],
                        "position": pos or "P",
                        "type": "pitcher",
                        "windows": [{
                            "window": "last_60_days",
                            "as_of_date": str(as_of),
                            "starts": r.get("starts", 0),
                            "innings_pitched": ip,
                            "era": r.get("era"),
                            "fip": None,
                            "xfip": None,
                            "babip": None,
                            "whip": r.get("whip"),
                            "k_per_9": k_per_9,
                            "bb_per_9": bb_per_9,
                            "hr_per_9": None,
                            "avg_pitches_per_start": None,
                            "avg_innings_per_start": None,
                            "trend_label": "raw_log_fallback",
                            "insufficient_sample": (r.get("starts", 0) or 0) < 3,
                        }],
                    })

        # --- Batter form windows ---
        if pos not in ("P", "SP", "RP"):
            batter_rows = _rows(db, """
                SELECT
                    "window",
                    as_of_date,
                    games,
                    plate_appearances,
                    batting_avg,
                    on_base_pct,
                    slugging_pct,
                    ops,
                    woba,
                    home_runs,
                    strikeouts,
                    walks,
                    trend_label,
                    insufficient_sample
                FROM player_form_windows
                WHERE player_id = :pid
                  AND as_of_date = (
                      SELECT MAX(as_of_date) FROM player_form_windows
                      WHERE player_id = :pid AND as_of_date <= :as_of
                  )
                ORDER BY
                    CASE "window"
                        WHEN 'season' THEN 1
                        WHEN 'last_30' THEN 2
                        WHEN 'last_15' THEN 3
                        WHEN 'last_7'  THEN 4
                        ELSE 5
                    END
            """, {"pid": pid, "as_of": str(as_of)})

            if batter_rows:
                results.append({
                    "player": player["full_name"],
                    "position": pos or "?",
                    "type": "batter",
                    "windows": batter_rows,
                })
            else:
                # Fallback: compute from raw game logs
                start = as_of - timedelta(days=60)
                raw = _rows(db, """
                    SELECT
                        COUNT(*) AS games,
                        SUM(at_bats) AS ab,
                        SUM(hits) AS h,
                        SUM(home_runs) AS home_runs,
                        SUM(walks) AS walks,
                        SUM(strikeouts) AS strikeouts,
                        ROUND(
                            CASE WHEN SUM(at_bats) > 0
                            THEN SUM(hits) * 1.0 / SUM(at_bats)
                            ELSE NULL END, 3) AS batting_avg,
                        ROUND(
                            CASE WHEN SUM(at_bats + walks + hit_by_pitch + sac_flies) > 0
                            THEN (SUM(hits) + SUM(walks) + SUM(hit_by_pitch)) * 1.0
                                 / SUM(at_bats + walks + hit_by_pitch + sac_flies)
                            ELSE NULL END, 3) AS on_base_pct
                    FROM player_game_logs
                    WHERE player_id = :pid
                      AND game_date >= :start AND game_date <= :as_of
                """, {"pid": pid, "start": str(start), "as_of": str(as_of)})
                if raw and raw[0].get("games", 0):
                    r = raw[0]
                    results.append({
                        "player": player["full_name"],
                        "position": pos or "?",
                        "type": "batter",
                        "windows": [{
                            "window": "last_60_days",
                            "as_of_date": str(as_of),
                            "games": r.get("games", 0),
                            "plate_appearances": (r.get("ab") or 0) + (r.get("walks") or 0),
                            "batting_avg": r.get("batting_avg"),
                            "on_base_pct": r.get("on_base_pct"),
                            "slugging_pct": None,
                            "ops": None,
                            "woba": None,
                            "home_runs": r.get("home_runs", 0),
                            "strikeouts": r.get("strikeouts", 0),
                            "walks": r.get("walks", 0),
                            "trend_label": "raw_log_fallback",
                            "insufficient_sample": (r.get("games", 0) or 0) < 5,
                        }],
                    })

    return results


def get_context_for_intent(
    db: Session,
    intent: str,
    team_abbr: Optional[str],
    query_date: Optional[date],
    today: date,
    player_name: Optional[str] = None,
    team_abbrs: Optional[list[str]] = None,
    player_names: Optional[list[str]] = None,
) -> list[dict]:
    """Router: dispatch to the right retrieval function.

    Lists (team_abbrs / player_names) take precedence; falls back to singular
    fields for backward compatibility.
    """
    teams = team_abbrs or ([team_abbr] if team_abbr else [])
    players = player_names or ([player_name] if player_name else [])

    if intent == "pick_today":
        return get_picks_for_date(db, today)

    if intent == "pick_date":
        return get_picks_for_date(db, query_date or today)

    if intent == "pick_team":
        if not teams:
            return []
        return get_picks_for_team(db, teams, today=today)

    if intent == "tracker_record":
        return get_tracker_record(db, today=today)

    if intent == "bullpen_today":
        return get_bullpen_vulnerability(db, query_date or today)

    if intent == "model_explain":
        # Multi-team: aggregate explanations across each team
        if len(teams) > 1:
            out: list[dict] = []
            for t in teams:
                out.extend(get_model_explanation(db, query_date or today, t))
            return out
        return get_model_explanation(db, query_date or today, teams[0] if teams else None)

    if intent == "player_stat":
        if not players:
            return []
        return get_player_stats(db, players, as_of=query_date or today)

    return []
