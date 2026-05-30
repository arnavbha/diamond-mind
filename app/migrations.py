"""Lightweight idempotent column-additions for prod schema evolution.

Diamond Mind doesn't use Alembic — schema is bootstrapped via
`Base.metadata.create_all(engine)` at startup, which is additive-only for new
tables but does nothing for new columns on existing tables.

Each entry here is a single `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`
that runs on app startup, after `create_all`. Safe to call repeatedly; safe on
fresh databases (the column already exists from `create_all` and the
`IF NOT EXISTS` makes the ALTER a no-op).

Only Postgres is supported in prod — `ADD COLUMN IF NOT EXISTS` requires
Postgres 9.6+. On SQLite (local dev) we silently skip; the ORM `Mapped`
declarations on the models already create the columns on first run.
"""

from __future__ import annotations

import logging
from typing import List, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)


# Each tuple is (table, column_name, column_type_sql).
# Order matters only insofar as you might want logical grouping.
_COLUMN_ADDITIONS: List[Tuple[str, str, str]] = [
    # Model state at pick time — see app/models/tracker.py for rationale.
    ("bet_records", "model_prob",            "DOUBLE PRECISION"),
    ("bet_records", "market_implied_prob",   "DOUBLE PRECISION"),
    ("bet_records", "edge",                  "DOUBLE PRECISION"),
    ("bet_records", "p_edge_positive",       "DOUBLE PRECISION"),
    ("bet_records", "kelly_fraction_raw",    "DOUBLE PRECISION"),
    ("bet_records", "evidence_quality",      "DOUBLE PRECISION"),
    ("bet_records", "snapshot_source",       "VARCHAR(32)"),
    # Live monitoring (one row per game, upserted by PK). The CREATE TABLE in
    # _TABLE_CREATIONS handles fresh prod databases; these ADD COLUMN entries
    # cover databases where the table already exists from an earlier deploy.
    ("live_game_states", "status",                  "VARCHAR(32)"),
    ("live_game_states", "inning",                  "INTEGER"),
    ("live_game_states", "inning_half",             "VARCHAR(8)"),
    ("live_game_states", "outs",                    "INTEGER"),
    ("live_game_states", "on_first",                "BOOLEAN DEFAULT FALSE"),
    ("live_game_states", "on_second",               "BOOLEAN DEFAULT FALSE"),
    ("live_game_states", "on_third",                "BOOLEAN DEFAULT FALSE"),
    ("live_game_states", "home_score",              "INTEGER"),
    ("live_game_states", "away_score",              "INTEGER"),
    ("live_game_states", "current_pitcher_id",      "BIGINT"),
    ("live_game_states", "current_pitcher_name",    "VARCHAR(128)"),
    ("live_game_states", "current_pitcher_team_id", "BIGINT"),
    ("live_game_states", "pitch_count",             "INTEGER"),
    ("live_game_states", "captured_at",             "TIMESTAMPTZ"),
]


# Tables that must exist before the ADD COLUMN statements above can target them.
# `CREATE TABLE IF NOT EXISTS` is idempotent and a no-op on a DB where
# `create_all` already produced the table. Postgres-only (SQLite uses create_all).
_TABLE_CREATIONS: List[Tuple[str, str]] = [
    (
        "live_game_states",
        """
        CREATE TABLE IF NOT EXISTS live_game_states (
            game_id                 BIGINT PRIMARY KEY REFERENCES games(id),
            status                  VARCHAR(32),
            inning                  INTEGER,
            inning_half             VARCHAR(8),
            outs                    INTEGER,
            on_first                BOOLEAN DEFAULT FALSE,
            on_second               BOOLEAN DEFAULT FALSE,
            on_third                BOOLEAN DEFAULT FALSE,
            home_score              INTEGER,
            away_score              INTEGER,
            current_pitcher_id      BIGINT REFERENCES players(id),
            current_pitcher_name    VARCHAR(128),
            current_pitcher_team_id BIGINT,
            pitch_count             INTEGER,
            captured_at             TIMESTAMPTZ
        )
        """,
    ),
]


def apply_lightweight_migrations(engine: Engine) -> None:
    """Apply additive ALTER TABLE statements to existing prod tables.

    Postgres-only. Silently no-ops on SQLite (local dev) where the ORM
    `create_all` already produced the up-to-date schema on first run.
    """
    dialect = engine.dialect.name
    if dialect != "postgresql":
        log.debug("Skipping lightweight migrations on dialect=%s", dialect)
        return

    with engine.begin() as conn:
        for table, create_sql in _TABLE_CREATIONS:
            try:
                conn.execute(text(create_sql))
            except Exception as exc:
                log.exception(
                    "Lightweight table creation failed: %s — %s", table, exc
                )
        for table, column, coltype in _COLUMN_ADDITIONS:
            try:
                conn.execute(text(
                    f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{column}" {coltype}'
                ))
            except Exception as exc:
                # Don't crash the app on a migration failure — log loudly and
                # let the operator investigate. The ORM will continue with the
                # latest model definitions; missing columns will surface as
                # query errors that point at the real issue.
                log.exception(
                    "Lightweight migration failed: %s.%s (%s) — %s",
                    table, column, coltype, exc,
                )
