"""SQL retrieval functions — one per intent.

Each function takes a db session + entities and returns a list of
plain dicts (context documents) to pass to the synthesizer.
Never generates SQL dynamically — all queries are parameterized templates.
"""

from __future__ import annotations

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
    team_abbr: str,
    days_back: int = 14,
    today: Optional[date] = None,
) -> list[dict]:
    """Recent picks where team was home or away."""
    if today is None:
        today = date.today()
    start = today - timedelta(days=days_back)
    sql = """
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
        WHERE (ht.abbr = :abbr OR at_.abbr = :abbr)
          AND br.game_date >= :start
        ORDER BY br.game_date DESC
        LIMIT 20
    """
    return _rows(db, sql, {"abbr": team_abbr, "start": str(start)})


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
    player_name: str,
    as_of: Optional[date] = None,
) -> list[dict]:
    """Search players by name and return pre-computed form-window stats.

    Pulls from pitcher_form_windows / player_form_windows (computed by the
    Phase 5 engine) rather than re-deriving stats from raw game logs.
    Returns all available windows (season, last_10_starts, last_5_starts)
    for the most recent as_of_date <= today.
    """
    if as_of is None:
        as_of = date.today()

    # Fuzzy name search — split into words and match all parts
    name_parts = player_name.strip().split()
    like_clauses = " AND ".join(f"full_name LIKE :p{i}" for i in range(len(name_parts)))
    params: dict = {f"p{i}": f"%{part}%" for i, part in enumerate(name_parts)}

    player_rows = _rows(db, f"""
        SELECT id, full_name, primary_position, bats, throws, current_team_id
        FROM players
        WHERE {like_clauses}
        LIMIT 3
    """, params)

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
                    window,
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
                    CASE window
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

        # --- Batter form windows ---
        if pos not in ("P", "SP", "RP"):
            batter_rows = _rows(db, """
                SELECT
                    window,
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
                    CASE window
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

    return results


def get_context_for_intent(
    db: Session,
    intent: str,
    team_abbr: Optional[str],
    query_date: Optional[date],
    today: date,
    player_name: Optional[str] = None,
) -> list[dict]:
    """Router: dispatch to the right retrieval function."""
    if intent == "pick_today":
        return get_picks_for_date(db, today)

    if intent == "pick_date":
        return get_picks_for_date(db, query_date or today)

    if intent == "pick_team":
        if not team_abbr:
            return []
        return get_picks_for_team(db, team_abbr, today=today)

    if intent == "tracker_record":
        return get_tracker_record(db, today=today)

    if intent == "bullpen_today":
        return get_bullpen_vulnerability(db, query_date or today)

    if intent == "model_explain":
        return get_model_explanation(db, query_date or today, team_abbr)

    if intent == "player_stat":
        if not player_name:
            return []
        return get_player_stats(db, player_name, as_of=query_date or today)

    return []
