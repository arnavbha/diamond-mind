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
    # Closing Line Value (CLV) — see app/models/tracker.py / app/betting/clv.py.
    ("bet_records", "closing_odds",          "INTEGER"),
    ("bet_records", "closing_line",          "DOUBLE PRECISION"),
    ("bet_records", "closing_implied_prob",  "DOUBLE PRECISION"),
    ("bet_records", "closing_captured_at",   "TIMESTAMPTZ"),
    ("bet_records", "clv_pct",               "DOUBLE PRECISION"),
    ("bet_records", "beat_close",            "BOOLEAN"),
    ("bet_records", "clv_source",            "VARCHAR(32)"),
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
    """Apply additive ALTER TABLE statements to existing tables.

    Runs on both Postgres (prod) and SQLite (local dev).

    On SQLite the old assumption — "create_all already produced the up-to-date
    schema" — is false: create_all makes any MISSING tables but never adds new
    COLUMNS to a table that already exists. So when a column is added to an ORM
    model after its table was first created locally, the dev DB silently drifts
    and every query selecting the new column 500s. (This is exactly what broke
    the tracker: bet_records was missing model_prob and the whole CLV column
    set, so /tracker/bets, /tracker/summary and /tracker/track-record all 500'd.)
    SQLite also has no "ADD COLUMN IF NOT EXISTS", so we diff against
    PRAGMA table_info and add only what's missing.
    """
    dialect = engine.dialect.name

    if dialect == "sqlite":
        with engine.begin() as conn:
            for table, column, coltype in _COLUMN_ADDITIONS:
                existing = {
                    row[1]
                    for row in conn.execute(text(f'PRAGMA table_info("{table}")'))
                }
                # Empty → table doesn't exist yet (create_all owns it); skip.
                if not existing or column in existing:
                    continue
                try:
                    # SQLite has lenient type affinity, so the Postgres coltype
                    # strings ("DOUBLE PRECISION", "TIMESTAMPTZ", …) are accepted
                    # as-is; only IF NOT EXISTS is unsupported (handled by the
                    # PRAGMA diff above).
                    conn.execute(
                        text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {coltype}')
                    )
                    log.info("SQLite migration: added %s.%s", table, column)
                except Exception as exc:
                    log.exception(
                        "SQLite migration failed: %s.%s (%s) — %s",
                        table, column, coltype, exc,
                    )
        return

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
