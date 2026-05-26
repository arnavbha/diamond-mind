"""Intent classifier + entity extractor for the Diamond Mind chatbot.

Pass 1: fast regex rules — no API call.
Pass 2 (fallback): not needed for MVP; we gracefully fall to out_of_scope.

Intents
-------
pick_today      — today's picks / leans
pick_date       — picks on a specific past date
pick_team       — picks involving a specific team
tracker_record  — betting record / ROI / performance
bullpen_today   — bullpen vulnerability for today's slate
model_explain   — why did the model like a team / game
out_of_scope    — can't answer, redirect
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional


# ---------------------------------------------------------------------------
# All 30 MLB team abbreviations (including ATH for Athletics)
# ---------------------------------------------------------------------------
ALL_ABBRS = {
    "ARI", "AZ", "ATL", "BAL", "BOS", "CHC", "CWS", "CIN", "CLE",
    "COL", "DET", "HOU", "KC", "LAA", "LAD", "MIA", "MIL", "MIN",
    "NYM", "NYY", "OAK", "ATH", "PHI", "PIT", "SD", "SEA", "SF",
    "STL", "TB", "TEX", "TOR", "WSH",
}

# Normalize AZ→ARI, ATH→OAK
ABBR_NORM: dict[str, str] = {"AZ": "ARI", "ATH": "OAK"}

# Full city/nickname → abbreviation (lowercase keys)
TEAM_NAMES: dict[str, str] = {
    "yankees": "NYY", "new york yankees": "NYY",
    "red sox": "BOS", "boston": "BOS",
    "dodgers": "LAD", "los angeles dodgers": "LAD",
    "mets": "NYM", "new york mets": "NYM",
    "phillies": "PHI", "philadelphia": "PHI",
    "braves": "ATL", "atlanta": "ATL",
    "astros": "HOU", "houston": "HOU",
    "cubs": "CHC", "chicago cubs": "CHC",
    "white sox": "CWS", "chicago white sox": "CWS",
    "reds": "CIN", "cincinnati": "CIN",
    "guardians": "CLE", "cleveland": "CLE",
    "rockies": "COL", "colorado": "COL",
    "tigers": "DET", "detroit": "DET",
    "royals": "KC", "kansas city": "KC",
    "angels": "LAA", "los angeles angels": "LAA",
    "marlins": "MIA", "miami": "MIA",
    "brewers": "MIL", "milwaukee": "MIL",
    "twins": "MIN", "minnesota": "MIN",
    "athletics": "OAK", "oakland": "OAK", "a's": "OAK",
    "pirates": "PIT", "pittsburgh": "PIT",
    "padres": "SD", "san diego": "SD",
    "mariners": "SEA", "seattle": "SEA",
    "giants": "SF", "san francisco": "SF",
    "cardinals": "STL", "st. louis": "STL", "st louis": "STL",
    "rays": "TB", "tampa bay": "TB",
    "rangers": "TEX", "texas": "TEX",
    "blue jays": "TOR", "toronto": "TOR",
    "nationals": "WSH", "washington": "WSH",
    "diamondbacks": "ARI", "arizona": "ARI",
    "orioles": "BAL", "baltimore": "BAL",
}


@dataclass
class ChatEntities:
    team_abbr: Optional[str] = None       # normalized (e.g. "NYY")
    query_date: Optional[date] = None     # explicit date parsed from message
    raw_date_str: Optional[str] = None
    player_name: Optional[str] = None     # raw player name fragment from message


@dataclass
class ClassifiedQuery:
    intent: str
    entities: ChatEntities = field(default_factory=ChatEntities)
    original: str = ""


# ---------------------------------------------------------------------------
# Patterns — order matters, first match wins
# ---------------------------------------------------------------------------
_PATTERNS: list[tuple[str, str]] = [
    # Tracker / record
    (r"\b(record|roi|profit|loss(es)?|units?|how.{0,20}(done|perform)|winning|losing|track record|result)\b", "tracker_record"),
    # Bullpen
    (r"\b(bullpen|vuln|fatig|relief|closer|pen\b)", "bullpen_today"),
    # Player stats (pitcher or batter) — before model_explain to avoid false match
    (r"\b(era|whip|fip|k/?9|bb/?9|innings?\s+pitched|strikeouts?|batting\s+avg|avg|obp|slg|ops|wrc|babip|splits?|vs\s+(lhp|rhp|leftie?s?|rightie?s?)|pitcher|starter|reliever|batter|hitter|how.{0,40}(hit|pitch|perform)|stat|season\s+line)\b", "player_stat"),
    # Model explanation
    (r"\b(why|explain|reason|because|factor|support|confi(dent|dence)|edge|what.*model|model.*think)\b", "model_explain"),
    # Pick for a specific date (must come before pick_today)
    (r"\b(\d{4}-\d{2}-\d{2}|yesterday|last\s+\w+day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "pick_date"),
    # Today's picks
    (r"\b(today|tonight|tonight'?s?|pick|lean|signal|slate|play|bet|wager|lock|strong)\b", "pick_today"),
]

_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_YESTERDAY_RE = re.compile(r"\byesterday\b", re.I)
_DAY_RE = re.compile(
    r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I
)


def _extract_team(text: str) -> Optional[str]:
    """Return normalized team abbreviation from message, or None."""
    upper = text.upper()
    # Try full abbreviations first
    for tok in re.findall(r"\b[A-Z]{2,3}\b", upper):
        if tok in ALL_ABBRS:
            return ABBR_NORM.get(tok, tok)
    # Try team names
    lower = text.lower()
    for name, abbr in sorted(TEAM_NAMES.items(), key=lambda x: -len(x[0])):
        if name in lower:
            return abbr
    return None


def _extract_date(text: str, today: date) -> Optional[date]:
    """Return explicit date from message, or None."""
    m = _DATE_RE.search(text)
    if m:
        try:
            return date.fromisoformat(m.group(1))
        except ValueError:
            pass
    if _YESTERDAY_RE.search(text):
        return today - timedelta(days=1)
    # Day-of-week → find most recent past occurrence
    m = _DAY_RE.search(text)
    if m:
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        target = day_names.index(m.group(1).lower())
        delta = (today.weekday() - target) % 7 or 7
        return today - timedelta(days=delta)
    return None


# Common words that look like Title Case but aren't names
_NOT_NAMES = {
    "show", "what", "how", "are", "the", "our", "this", "last", "today",
    "yesterday", "recent", "pick", "lean", "tell", "give", "compare",
    "been", "has", "had", "was", "did", "does", "will", "would", "could",
    "should", "me", "my", "his", "her", "their", "your", "its", "who",
    "which", "when", "where", "why", "and", "but", "for", "with", "from",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
}

def _is_name_word(w: str) -> bool:
    """True if word looks like part of a person's name."""
    return (
        w.lower() not in _NOT_NAMES
        and w.upper() not in ALL_ABBRS
        and w.lower() not in TEAM_NAMES
        and len(w) > 2
        # Exclude all-caps tokens like ERA, WHIP, IP, HR — stat abbreviations
        and not (len(w) > 1 and w == w.upper())
    )


def _strip_possessive(w: str) -> str:
    """Remove trailing possessive suffix: Harper's → Harper, O'Brien's → O'Brien."""
    if w.endswith("'s") or w.endswith("’s"):
        return w[:-2]
    if w.endswith("'") or w.endswith("’"):
        return w[:-1]
    return w


def _extract_player_name(text: str) -> Optional[str]:
    """Extract a Title Case name from the message.

    Handles:
    - Two-word names: "Bryce Harper", "Zack Wheeler"
    - Mixed-case names: "Nolan McLean", "Tim O'Brien"
    - Single-word surnames when paired with stat keywords: "Harper's splits"
    - Greedy 3-word match that ends in a stat token: backs off to 2 words
    """
    # Title Case word: starts with capital, rest can be letters/apostrophes/hyphens
    # Allows McLean, O'Brien, etc.
    TITLE = r"[A-Z][a-zA-Z''\-]{1,}"

    # Try multi-word names (up to 3 words).  If the greedy match pulls in a trailing
    # stat token (e.g. "Nolan McLean ERA"), back off word-by-word until valid.
    candidates = re.findall(rf"\b({TITLE}(?:\s+{TITLE}){{1,2}})\b", text)
    for candidate in candidates:
        words = candidate.split()
        # Try longest sub-sequence first, then shorter
        for end in range(len(words), 1, -1):
            sub = words[:end]
            if all(_is_name_word(w) for w in sub):
                return " ".join(sub)

    # Fallback: single Title Case word that looks like a surname
    # Only if sentence contains a stat-related trigger
    if re.search(r"\b(era|whip|stats?|splits?|avg|obp|slg|ops|hit|pitch|perform|recent|line|k\b|bb\b|inn|start|relief|batter)\b", text, re.I):
        single = re.findall(rf"\b({TITLE})\b", text)
        for w in single:
            clean = _strip_possessive(w)
            if _is_name_word(clean) and len(clean) > 3:
                return clean

    return None


def classify(message: str, today: Optional[date] = None) -> ClassifiedQuery:
    """Classify a user message into an intent + entities."""
    if today is None:
        today = date.today()

    text = message.strip()
    lower = text.lower()

    team = _extract_team(text)
    dt = _extract_date(lower, today)
    player = _extract_player_name(text)

    entities = ChatEntities(
        team_abbr=team,
        query_date=dt,
        raw_date_str=str(dt) if dt else None,
        player_name=player,
    )

    # Out-of-scope prop patterns — catch before team/pick routing
    if re.search(r"\b(home\s*run|homer|hr\b|prop|parlay|futures?|season\s+win|world\s+series|stolen\s+base|strikeout\s+prop)\b", lower):
        return ClassifiedQuery(intent="out_of_scope", entities=entities, original=text)

    # If a player name was found + any stat/performance word → player_stat
    if player and re.search(r"\b(era|whip|stat|split|avg|obp|slg|ops|hit|pitch|perform|how|recent|last|line|k\b|bb\b|inn|start|relief|batter)\b", lower):
        return ClassifiedQuery(intent="player_stat", entities=entities, original=text)

    # If there's a team mentioned and words like "pick/lean/signal/record/recent/show/last"
    # treat as pick_team regardless of other matches
    if team and re.search(r"\b(pick|lean|signal|bet|wager|play|record|how.{0,15}done|recent|show|last|history|involve)\b", lower):
        return ClassifiedQuery(intent="pick_team", entities=entities, original=text)

    for pattern, intent in _PATTERNS:
        if re.search(pattern, lower):
            # Disambiguate pick_today vs pick_date
            if intent == "pick_today" and dt and dt != today:
                intent = "pick_date"
            return ClassifiedQuery(intent=intent, entities=entities, original=text)

    return ClassifiedQuery(intent="out_of_scope", entities=entities, original=text)
