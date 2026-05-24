"""The Odds API client.

Returns List[OddsSnapshot] for a given game.
Stubs gracefully when ODDS_API_KEY is missing — never fabricates data.

Supports multiple comma-separated keys in ODDS_API_KEY so we can rotate
through them as each free-tier quota (500 req/mo) gets exhausted:

    ODDS_API_KEY=keyA,keyB,keyC

The first key with remaining quota for the current call is used. Keys are
tried in order; a 401/422 (auth/usage_quota) or empty response fails over
to the next key.
"""

from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import List, Optional

from app.config import get_settings
settings = get_settings()
from app.contracts import OddsSnapshot

log = logging.getLogger(__name__)

_BASE = "https://api.the-odds-api.com/v4"
_SPORT = "baseball_mlb"

# Module-level cache of which key index last succeeded — start there next
# call so we don't waste a request retrying a known-dead key every time.
_LAST_GOOD_KEY_IDX: int = 0


def _keys() -> list[str]:
    raw = settings.odds_api_key or ""
    return [k.strip() for k in raw.split(",") if k.strip()]


def _get(path: str, params: dict) -> Optional[list]:
    """Try each configured key until one returns data. None if all fail."""
    global _LAST_GOOD_KEY_IDX
    keys = _keys()
    if not keys:
        return None

    query = "&".join(f"{k}={v}" for k, v in params.items())

    # Try last-good key first, then the rest in declared order.
    order = [_LAST_GOOD_KEY_IDX] + [i for i in range(len(keys)) if i != _LAST_GOOD_KEY_IDX]
    for idx in order:
        if idx >= len(keys):
            continue
        key = keys[idx]
        url = f"{_BASE}{path}?{query}&apiKey={key}"
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                data = json.loads(r.read())
                # The Odds API returns [] when out of quota on some endpoints
                # and a {"message": "..."} dict on others. Treat empty list as
                # "this key has nothing useful for us right now" — try next key.
                if isinstance(data, list) and len(data) == 0:
                    log.warning("odds_api key #%d returned empty list — trying next key.", idx)
                    continue
                if isinstance(data, dict) and "message" in data:
                    log.warning("odds_api key #%d error: %s — trying next key.", idx, data.get("message"))
                    continue
                _LAST_GOOD_KEY_IDX = idx
                return data
        except urllib.error.HTTPError as exc:
            # 401 invalid, 422 quota exceeded — both warrant fail-over.
            log.warning("odds_api key #%d HTTP %s — trying next key.", idx, exc.code)
            continue
        except (urllib.error.URLError, json.JSONDecodeError) as exc:
            log.warning("odds_api key #%d transport error %s — trying next key.", idx, exc)
            continue
    return None


def fetch_odds(game_id: int, event_id: str) -> List[OddsSnapshot]:
    """Fetch odds snapshots for a game. Returns [] if key missing or request fails."""
    data = _get(f"/sports/{_SPORT}/events/{event_id}/odds", {
        "regions": "us",
        "markets": "h2h,spreads,totals",
        "oddsFormat": "american",
    })
    if not data:
        return []

    snapshots = []
    captured_at = datetime.now(tz=timezone.utc)
    bookmakers = data.get("bookmakers", [])

    for book in bookmakers:
        bookmaker = book.get("key", "unknown")
        for market in book.get("markets", []):
            market_key = market.get("key", "")
            for outcome in market.get("outcomes", []):
                snapshots.append(OddsSnapshot(
                    game_id=game_id,
                    bookmaker=bookmaker,
                    market=_normalize_market(market_key),
                    selection=outcome.get("name", "").lower(),
                    american_odds=int(outcome.get("price", 0)),
                    line=outcome.get("point"),
                    captured_at=captured_at,
                ))
    return snapshots


def fetch_events(game_date: "date") -> list:
    """Fetch all MLB events from the Odds API for a date. Returns [] if unavailable."""
    from datetime import date, timedelta, timezone
    # The Odds API uses ISO8601 commence_time filters.
    start = f"{game_date.isoformat()}T00:00:00Z"
    end = f"{(game_date + timedelta(days=1)).isoformat()}T00:00:00Z"
    data = _get(f"/sports/{_SPORT}/events", {
        "commenceTimeFrom": start,
        "commenceTimeTo": end,
    })
    return data or []


def match_event_id(events: list, home_abbr: str, away_abbr: str) -> "Optional[str]":
    """Find an Odds API event_id by matching home/away team name substrings.

    The Odds API uses full team names (e.g. 'Philadelphia Phillies') while
    we have abbreviations ('PHI'). We keep a simple abbr→name substring map.
    """
    _ABBR_TO_SUBSTR = {
        "ARI": "Arizona", "ATL": "Atlanta", "BAL": "Baltimore", "BOS": "Boston",
        "CHC": "Cubs", "CWS": "White Sox", "CIN": "Cincinnati", "CLE": "Cleveland",
        "COL": "Colorado", "DET": "Detroit", "HOU": "Houston", "KC": "Kansas City",
        "LAA": "Angels", "LAD": "Los Angeles Dodgers", "MIA": "Miami",
        "MIL": "Milwaukee", "MIN": "Minnesota", "NYM": "New York Mets",
        "NYY": "New York Yankees", "OAK": "Oakland", "PHI": "Philadelphia",
        "PIT": "Pittsburgh", "SD": "San Diego", "SEA": "Seattle",
        "SF": "San Francisco", "STL": "St. Louis", "TB": "Tampa",
        "TEX": "Texas", "TOR": "Toronto", "WSH": "Washington",
    }
    home_sub = _ABBR_TO_SUBSTR.get(home_abbr, home_abbr)
    away_sub = _ABBR_TO_SUBSTR.get(away_abbr, away_abbr)
    for event in events:
        home_team = event.get("home_team", "")
        away_team = event.get("away_team", "")
        if home_sub in home_team and away_sub in away_team:
            return event.get("id")
    return None


def is_available() -> bool:
    return len(_keys()) > 0


def _normalize_market(key: str) -> str:
    mapping = {
        "h2h": "moneyline",
        "spreads": "spread",
        "totals": "total",
    }
    return mapping.get(key, key)
