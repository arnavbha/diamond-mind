"""ESPN public odds client — drop-in replacement for odds_api.py.

ESPN exposes MLB odds via two stable public endpoints (no API key, no quota):

  1. Scoreboard:  https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=YYYYMMDD
                  → list of events for a date
  2. Game odds:   https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/{id}/competitions/{id}/odds
                  → DraftKings-sourced moneyline + total with full vig

Mirrors the odds_api.py interface so the pregame ingestion script can swap
providers transparently. Never fabricates data — returns [] on any failure.
"""
from __future__ import annotations

import json
import logging
import urllib.request
import urllib.error
from datetime import date, datetime, timezone
from typing import List, Optional

from app.contracts import OddsSnapshot

log = logging.getLogger(__name__)

_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"
_GAME_ODDS_URL = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/{eid}/competitions/{eid}/odds"

# Map our 3-letter team abbrs to ESPN's "displayName" substring.
_ABBR_TO_ESPN_NAME = {
    "ARI": "Diamondbacks", "AZ": "Diamondbacks",
    "ATL": "Braves", "BAL": "Orioles", "BOS": "Red Sox",
    "CHC": "Cubs", "CWS": "White Sox", "CIN": "Reds", "CLE": "Guardians",
    "COL": "Rockies", "DET": "Tigers", "HOU": "Astros", "KC": "Royals",
    "LAA": "Angels", "LAD": "Dodgers", "MIA": "Marlins",
    "MIL": "Brewers", "MIN": "Twins", "NYM": "Mets",
    "NYY": "Yankees", "OAK": "Athletics", "ATH": "Athletics",
    "PHI": "Phillies", "PIT": "Pirates", "SD": "Padres", "SEA": "Mariners",
    "SF": "Giants", "STL": "Cardinals", "TB": "Rays",
    "TEX": "Rangers", "TOR": "Blue Jays", "WSH": "Nationals",
}


def _http_get(url: str, timeout: int = 10) -> Optional[dict]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "diamond-mind/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
        log.warning("ESPN GET %s failed: %s", url[:80], exc)
        return None


def fetch_events(game_date: date) -> list:
    """Return list of ESPN MLB events for a date. [] on failure."""
    url = f"{_SCOREBOARD_URL}?dates={game_date.strftime('%Y%m%d')}"
    data = _http_get(url)
    if not data:
        return []
    return data.get("events", []) or []


def match_event_id(events: list, home_abbr: str, away_abbr: str) -> Optional[str]:
    """Find ESPN event_id by matching home/away team display names."""
    home_sub = _ABBR_TO_ESPN_NAME.get(home_abbr, home_abbr)
    away_sub = _ABBR_TO_ESPN_NAME.get(away_abbr, away_abbr)
    for event in events:
        comp = (event.get("competitions") or [{}])[0]
        teams = comp.get("competitors") or []
        home = next((t for t in teams if t.get("homeAway") == "home"), {})
        away = next((t for t in teams if t.get("homeAway") == "away"), {})
        home_name = (home.get("team") or {}).get("displayName", "")
        away_name = (away.get("team") or {}).get("displayName", "")
        if home_sub in home_name and away_sub in away_name:
            return str(event.get("id"))
    return None


def fetch_odds(game_id: int, event_id: str, home_team_name: str = "", away_team_name: str = "") -> List[OddsSnapshot]:
    """Fetch ML + total odds for a game from ESPN. Returns [] on failure.

    Produces OddsSnapshot rows matching the odds_api.py convention:
      - market="moneyline", selection=lowercase team substring, american_odds=int, line=None
      - market="total", selection="over"/"under", american_odds=int, line=float
    """
    url = _GAME_ODDS_URL.format(eid=event_id)
    data = _http_get(url)
    if not data:
        return []

    items = data.get("items") or []
    if not items:
        return []

    # Pick the first provider (typically DraftKings on ESPN's public feed).
    provider_row = items[0]
    bookmaker = (provider_row.get("provider") or {}).get("name", "draftkings").lower().replace(" ", "_")
    captured_at = datetime.now(tz=timezone.utc)

    snapshots: List[OddsSnapshot] = []

    # ── Moneyline ────────────────────────────────────────────────────────
    home_odds = provider_row.get("homeTeamOdds") or {}
    away_odds = provider_row.get("awayTeamOdds") or {}
    home_ml = home_odds.get("moneyLine")
    away_ml = away_odds.get("moneyLine")

    # Prefer ESPN's own abbreviation (e.g. "ARI") over team.name ("D-backs")
    # so _resolve_to_abbr always gets a clean token.
    home_sel = (home_odds.get("team") or {}).get("abbreviation") or home_team_name
    away_sel = (away_odds.get("team") or {}).get("abbreviation") or away_team_name

    if home_ml is not None and home_sel:
        snapshots.append(OddsSnapshot(
            game_id=game_id, bookmaker=bookmaker, market="moneyline",
            selection=home_sel.lower(),
            american_odds=int(home_ml), line=None, captured_at=captured_at,
        ))
    if away_ml is not None and away_sel:
        snapshots.append(OddsSnapshot(
            game_id=game_id, bookmaker=bookmaker, market="moneyline",
            selection=away_sel.lower(),
            american_odds=int(away_ml), line=None, captured_at=captured_at,
        ))

    # ── Total (O/U) ──────────────────────────────────────────────────────
    over_under = provider_row.get("overUnder")
    current = provider_row.get("current") or {}
    over_price = ((current.get("over") or {}).get("american"))
    under_price = ((current.get("under") or {}).get("american"))

    if over_under is not None:
        line = float(over_under)
        # If juice is missing, assume -110 each side (DraftKings standard).
        if over_price is None:
            over_price = -110
        if under_price is None:
            under_price = -110
        try:
            over_int = int(over_price)
            under_int = int(under_price)
            snapshots.append(OddsSnapshot(
                game_id=game_id, bookmaker=bookmaker, market="total",
                selection="over", american_odds=over_int, line=line, captured_at=captured_at,
            ))
            snapshots.append(OddsSnapshot(
                game_id=game_id, bookmaker=bookmaker, market="total",
                selection="under", american_odds=under_int, line=line, captured_at=captured_at,
            ))
        except (TypeError, ValueError):
            log.warning("ESPN totals parse failed for game %d: over=%r under=%r", game_id, over_price, under_price)

    return snapshots


def is_available() -> bool:
    """ESPN is always available — no key, no quota."""
    return True
