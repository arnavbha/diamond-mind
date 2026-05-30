"""Closing-line capture — operationalizes CLV by landing a real near-pitch snapshot.

THE PROBLEM
-----------
`app/betting/clv.py` defines THE CLOSE as the single most-recent `odds_snapshots`
row whose `captured_at` is STRICTLY BEFORE `games.game_time_utc` (first pitch).
The periodic 20-min ESPN refresh (live_tick step 4c) keeps lines fresh but its
cadence is too coarse to reliably land a row in the final minutes before first
pitch, so closing-line coverage is ~0. This module captures current odds for
games in the final <=W minutes before first pitch and writes them to
`odds_snapshots`. Those rows BECOME the close, and the existing settle-time CLV
compute populates CLV automatically — no further wiring.

THE GUARANTEE (anti-lookahead, by construction)
-----------------------------------------------
A game qualifies only when BOTH:
  (1) its status is pre-start (in {'Scheduled','Pre-Game'}, never terminal /
      in-progress), AND
  (2) game_time_utc is not None and now <= game_time_utc <= now + W.
The lower bound `now <= game_time_utc` is the critical guard: captured_at is set
to `now` (inside espn_odds.fetch_odds), so the written row satisfies
captured_at < game_time_utc and is a VALID pre-pitch close — never a post-first-
pitch row. The upper bound bounds the ESPN spend to imminently-starting games.

DEDUP
-----
Before capturing a game we check MAX(captured_at) for that game_id; if a snapshot
was written within the last D minutes we skip (>= periodic ESPN cadence so we
never double-write). With W=15 and D=10 each game gets ~1-2 close snapshots per
pre-pitch approach, bounding writes and avoiding hammering ESPN.

NO FAKE DATA
------------
ESPN returns [] on any failure; on [] from both sources we persist NOTHING for
that game (counted under `failed`). We reuse the canonical OddsSnapshot ->
OddsSnapshotRow writer (`scripts.run_pregame_update._ingest_odds_and_weather`)
and its exact selection encoding — clv.py resolves what we write.

TIMEZONE
--------
SQLite strips tzinfo on write and returns naive datetimes on read; comparing a
naive read-back against a tz-aware value raises TypeError. We coerce BOTH sides
to tz-aware UTC via clv._to_utc before every comparison (same footgun clv.py
documents). All persisted timestamps are UTC wall-clock.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select

from app.betting.clv import _to_utc
from app.config import get_settings
from app.models.games import Game
from app.models.odds import OddsSnapshotRow

log = logging.getLogger(__name__)

# Final <=15 min before first pitch approximates THE CLOSE.
_CLOSE_WINDOW_MIN = 15
# Skip a game if it has a snapshot in the last 10 min (>= periodic ESPN cadence).
_DEDUP_MIN = 10
# Cap qualifying games per call before any network call (Render free-tier budget).
_MAX_GAMES = 15

# Pre-start statuses eligible for closing capture. NOT terminal, NOT in-progress.
_PRESTART_STATUSES = ("Scheduled", "Pre-Game")
# Terminal / in-progress markers (substring match, mirrors routes._TERMINAL_STATUSES
# usage). A status containing any of these is NOT eligible.
_STARTED_MARKERS = ("In Progress", "Final", "Game Over", "Completed Early")


def _is_prestart(status: Optional[str]) -> bool:
    """True iff status is a pre-start value (not terminal / in-progress).

    Exact match against the pre-start set, with a defensive substring guard
    against any started marker (so an unexpected variant never slips through).
    """
    if not status:
        return False
    if any(marker in status for marker in _STARTED_MARKERS):
        return False
    return status in _PRESTART_STATUSES


def _last_capture_utc(db, game_id: int) -> Optional[datetime]:
    """Most-recent captured_at across ALL markets for a game, coerced to UTC."""
    last = db.execute(
        select(func.max(OddsSnapshotRow.captured_at)).where(
            OddsSnapshotRow.game_id == game_id
        )
    ).scalar()
    return _to_utc(last)


def _select_qualifying_games(
    db,
    today: date,
    now_utc: datetime,
    window_min: int,
    dedup_min: int,
    max_games: int,
) -> tuple[list, dict]:
    """Filter today's slate to games imminently starting that need a close.

    Returns (qualifying_games, counts) where counts carries the diagnostic
    tallies (games_today, skipped_not_in_window, skipped_recent). The qualifying
    list is bounded to `max_games` BEFORE any network call.
    """
    window_end = now_utc + timedelta(minutes=window_min)
    dedup_cutoff = now_utc - timedelta(minutes=dedup_min)

    games = db.execute(
        select(Game).where(Game.game_date == today)
    ).scalars().all()

    counts = {
        "games_today": len(games),
        "skipped_not_in_window": 0,
        "skipped_recent": 0,
    }

    qualifying: list = []
    for g in games:
        # (1) pre-start status gate
        if not _is_prestart(g.status):
            counts["skipped_not_in_window"] += 1
            continue
        # (2) first-pitch window gate: now <= gt <= now + W  (lower bound is the
        #     anti-lookahead guard; None game_time can't define a close)
        gt = _to_utc(g.game_time_utc)
        if gt is None or gt < now_utc or gt > window_end:
            counts["skipped_not_in_window"] += 1
            continue
        # dedup: skip if a snapshot landed within the last D minutes
        last = _last_capture_utc(db, g.id)
        if last is not None and last > dedup_cutoff:
            counts["skipped_recent"] += 1
            continue
        qualifying.append(g)
        if len(qualifying) >= max_games:
            break

    return qualifying, counts


def capture_closing_odds(
    db,
    now_utc: Optional[datetime] = None,
    *,
    today: Optional[date] = None,
    window_min: int = _CLOSE_WINDOW_MIN,
    dedup_min: int = _DEDUP_MIN,
    max_games: int = _MAX_GAMES,
) -> dict:
    """Capture closing odds for games approaching first pitch. Returns coverage.

    Free-first: prefers ESPN (no key/quota). Falls back to the paid the-odds-api
    ONLY when settings.has_odds_api AND ESPN returned [] for that game — never
    burns quota when ESPN works. On [] from both sources, persists NOTHING for
    that game (counted under `failed`).

    Reuses the canonical OddsSnapshot -> OddsSnapshotRow writer
    (`_ingest_odds_and_weather`) so the persisted selection encoding is exactly
    what clv.py resolves. Each game is wrapped in its own try/except so one
    failure can never abort the rest. The caller owns the commit.

    Coverage dict keys: games_today, games_in_window, captured, source_espn,
    source_oddsapi, skipped_recent, skipped_not_in_window, failed,
    snapshots_written.
    """
    from app.ingestion import espn_odds as _free_odds
    from app.ingestion import odds_api as _paid_odds
    from scripts.run_pregame_update import _ingest_odds_and_weather, _map_odds_event_ids

    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    else:
        now_utc = _to_utc(now_utc)
    if today is None:
        today = now_utc.date()

    settings = get_settings()

    coverage = {
        "games_today": 0,
        "games_in_window": 0,
        "captured": 0,
        "source_espn": 0,
        "source_oddsapi": 0,
        "skipped_recent": 0,
        "skipped_not_in_window": 0,
        "failed": 0,
        "snapshots_written": 0,
    }

    qualifying, counts = _select_qualifying_games(
        db, today, now_utc, window_min, dedup_min, max_games
    )
    coverage.update(counts)
    coverage["games_in_window"] = len(qualifying)

    if not qualifying:
        return coverage

    # Map event_ids for any qualifying game lacking one (cheap; one events call).
    if any(not g.odds_event_id for g in qualifying):
        try:
            _map_odds_event_ids(db, today, provider=_free_odds)
        except Exception as exc:  # never let mapping abort the capture
            log.warning("closing capture: event-id mapping failed: %s", exc)

    for game in qualifying:
        try:
            before = _snapshot_count(db, game.id)
            # Free-first: ESPN. Single-game list so weather write is targeted.
            _ingest_odds_and_weather(db, [game], today, provider=_free_odds)
            written = _snapshot_count(db, game.id) - before
            source = "espn" if written > 0 else None

            # Paid fallback ONLY if ESPN produced nothing AND we have quota.
            if written == 0 and settings.has_odds_api:
                _ingest_odds_and_weather(db, [game], today, provider=_paid_odds)
                written = _snapshot_count(db, game.id) - before
                if written > 0:
                    source = "oddsapi"

            if written > 0:
                coverage["captured"] += 1
                coverage["snapshots_written"] += written
                if source == "espn":
                    coverage["source_espn"] += 1
                elif source == "oddsapi":
                    coverage["source_oddsapi"] += 1
            else:
                # Both sources [] — persist nothing (NO FAKE DATA).
                coverage["failed"] += 1
        except Exception as exc:
            # Defensive per-game isolation — one bad game never aborts the rest.
            log.warning("closing capture failed for game %s: %s", game.id, exc)
            coverage["failed"] += 1
            continue

    return coverage


def _snapshot_count(db, game_id: int) -> int:
    """Count of odds_snapshots rows for a game (used to measure rows we add)."""
    return db.execute(
        select(func.count())
        .select_from(OddsSnapshotRow)
        .where(OddsSnapshotRow.game_id == game_id)
    ).scalar() or 0
