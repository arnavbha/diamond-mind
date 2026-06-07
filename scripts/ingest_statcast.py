"""CLI: ingest Statcast pitcher aggregates for a date range (Path B, B1).

Usage:
    .venv/bin/python scripts/ingest_statcast.py --start 2026-03-25 --end 2026-06-05

Idempotent (upsert by pitcher+game_date). Safe to re-run. Stores per-(pitcher,
game_date) aggregates only — never raw pitches.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.models  # noqa: E402,F401  (register models on Base.metadata)
from app.database import Base, engine, SessionLocal  # noqa: E402
from app.ingestion.statcast import ingest_statcast_range  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingest_statcast")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--chunk-days", type=int, default=7,
                    help="Pull in N-day chunks (smaller = friendlier to savant).")
    args = ap.parse_args()

    Base.metadata.create_all(engine)
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    db = SessionLocal()
    total = 0
    try:
        cur = start
        while cur <= end:
            chunk_end = min(cur + timedelta(days=args.chunk_days - 1), end)
            total += ingest_statcast_range(db, cur, chunk_end)
            cur = chunk_end + timedelta(days=1)
    finally:
        db.close()
    log.info("Done. %d (pitcher, game) rows upserted across %s → %s.", total, start, end)


if __name__ == "__main__":
    main()
