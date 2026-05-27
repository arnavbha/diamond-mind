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
