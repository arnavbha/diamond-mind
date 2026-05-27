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
    team_abbr: Optional[str] = None       # first team (backward compat)
    team_abbrs: list[str] = field(default_factory=list)  # all teams found
    query_date: Optional[date] = None     # explicit date parsed from message
    raw_date_str: Optional[str] = None
    player_name: Optional[str] = None     # first player (backward compat)
    player_names: list[str] = field(default_factory=list)  # all players found


@dataclass
class ClassifiedQuery:
    intent: str
    entities: ChatEntities = field(default_factory=ChatEntities)
    original: str = ""


# ---------------------------------------------------------------------------
# Patterns — order matters, first match wins
# ---------------------------------------------------------------------------
_PATTERNS: list[tuple[str, str]] = [
    # Tracker / record — settled-result words only. "units" alone is ambiguous
    # (could mean units risked today); handled separately below.
    (r"\b(record|roi|profit|loss(es)?|how.{0,20}(done|perform|do|did|doing)|winning|losing|won|lost|track record|results?|returns?|net|bankroll)\b", "tracker_record"),
    # Bullpen
    (r"\b(bullpen|vuln|fatig|relief|closer|pen\b)", "bullpen_today"),
    # Player stats (pitcher or batter) — before model_explain to avoid false match
    (r"\b(era|whip|fip|k/?9|bb/?9|innings?\s+pitched|strikeouts?|batting\s+(avg|average)|averages?|avg|obp|slg|ops|wrc|babip|splits?|vs\s+(lhp|rhp|leftie?s?|rightie?s?)|pitcher|starter|reliever|batter|hitter|how.{0,40}(hit|pitch|perform)|season\s+line)\b", "player_stat"),
    # Model explanation — includes kelly / edge / projection / size language
    (r"\b(why|explain|reason|because|factor|support|confi(dent|dence)|edges?|kelly|size|sizing|projected|projection|fraction|what.*model|model.*think)\b", "model_explain"),
    # Pick for a specific date (must come before pick_today)
    (r"\b(\d{4}-\d{2}-\d{2}|yesterday|last\s+\w+day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "pick_date"),
    # Today's picks — plural-safe alternates
    (r"\b(today|tonight|tonight'?s?|picks?|leans?|signals?|slate|plays?|bets?|wagers?|locks?|strong|overs?|unders?|moneylines?|totals?|risk(ed|ing)?|units?)\b", "pick_today"),
]

_DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
_YESTERDAY_RE = re.compile(r"\byesterday(?:'?s)?\b", re.I)
_DAY_RE = re.compile(
    r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I
)


def _extract_teams(text: str) -> list[str]:
    """Return all normalized team abbreviations found in message (deduped, in order)."""
    upper = text.upper()
    lower = text.lower()
    found: list[str] = []
    seen: set[str] = set()

    # Full abbreviations (NYY, BOS, etc.)
    for tok in re.findall(r"\b[A-Z]{2,3}\b", upper):
        if tok in ALL_ABBRS:
            abbr = ABBR_NORM.get(tok, tok)
            if abbr not in seen:
                seen.add(abbr)
                found.append(abbr)

    # Team names — longest first so "new york yankees" beats "yankees"
    # Track consumed character ranges so "yankees" isn't matched after
    # "new york yankees" has already claimed the span.
    consumed: list[tuple[int, int]] = []
    for name, abbr in sorted(TEAM_NAMES.items(), key=lambda x: -len(x[0])):
        idx = lower.find(name)
        if idx < 0:
            continue
        end = idx + len(name)
        if any(c_start <= idx < c_end or c_start < end <= c_end for c_start, c_end in consumed):
            continue
        consumed.append((idx, end))
        if abbr not in seen:
            seen.add(abbr)
            found.append(abbr)

    return found


def _extract_team(text: str) -> Optional[str]:
    """Backward-compat: first team found, or None."""
    teams = _extract_teams(text)
    return teams[0] if teams else None


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


def _strip_team_spans(text: str) -> str:
    """Replace team-name occurrences with neutral whitespace so the player
    extractor doesn't pick up 'Red Sox', 'Blue Jays', etc. as players."""
    out = text
    lower = out.lower()
    for name in sorted(TEAM_NAMES.keys(), key=lambda x: -len(x)):
        idx = lower.find(name)
        while idx >= 0:
            out = out[:idx] + (" " * len(name)) + out[idx + len(name):]
            lower = out.lower()
            idx = lower.find(name, idx + len(name))
    return out


def _extract_player_names(text: str) -> list[str]:
    """Extract all Title Case names from the message (deduped, in order).

    Handles:
    - Two-word names: "Bryce Harper", "Zack Wheeler"
    - Mixed-case names: "Nolan McLean", "Tim O'Brien"
    - Single-word surnames when paired with stat keywords: "Harper's splits"
    - Multiple players: "Skubal vs Sanchez", "Compare Harper and Judge"
    - Junk words at start ("Compare Bryce Harper"): sliding-window search
      finds the longest valid sub-sequence even if it's not anchored left.
    """
    # Knock out team-name spans first so 'Red Sox' / 'Blue Jays' aren't players
    text = _strip_team_spans(text)

    TITLE = r"[A-Z][a-zA-Z''\-]{1,}"
    found: list[str] = []
    seen: set[str] = set()

    # Multi-word candidates: try all contiguous sub-sequences (longest first,
    # sliding left-to-right) so 'Compare Bryce Harper' → 'Bryce Harper'.
    for candidate in re.findall(rf"\b({TITLE}(?:\s+{TITLE}){{1,3}})\b", text):
        words = candidate.split()
        accepted = False
        for length in range(len(words), 1, -1):
            for start in range(0, len(words) - length + 1):
                sub = words[start:start + length]
                # Strip possessive from last word
                sub = sub[:-1] + [_strip_possessive(sub[-1])]
                if all(_is_name_word(w) for w in sub):
                    name = " ".join(sub)
                    if name not in seen:
                        seen.add(name)
                        found.append(name)
                    accepted = True
                    break
            if accepted:
                break

    # Single-word fallback: surnames near stat or comparison triggers
    # (so "Compare Ohtani and Judge" or "Skubal vs Sanchez" catches both)
    has_stat_or_compare = re.search(
        r"\b(era|whip|stats?|splits?|avg|obp|slg|ops|hit|pitch|perform|recent|line|"
        r"k\b|bb\b|inn|start|relief|batter|average|compare|comparison|vs|versus|"
        r"better|worse|or\b|and\b)\b",
        text, re.I,
    )
    if has_stat_or_compare:
        for w in re.findall(rf"\b({TITLE})\b", text):
            clean = _strip_possessive(w)
            if not _is_name_word(clean) or len(clean) <= 3:
                continue
            if any(clean in name.split() for name in found):
                continue
            if clean in seen:
                continue
            seen.add(clean)
            found.append(clean)

        # Lowercase fallback: if user typed "wheeler era" / "ohtani stats" /
        # "skubal vs sanchez" the Title Case extractor misses everything.
        # Pick up bare alphabetic tokens > 3 chars that aren't stop/team/stat
        # words. Retrieval does fuzzy LIKE so casing won't block resolution.
        if not found:
            _STAT_STOP = {
                "era", "whip", "fip", "xfip", "babip", "ops", "obp", "slg",
                "woba", "wrc", "stat", "stats", "split", "splits", "avg",
                "average", "averages", "compare", "comparison", "versus",
                "better", "worse", "hit", "hitting", "pitch", "pitching",
                "perform", "performance", "recent", "line", "inning",
                "innings", "start", "starts", "relief", "batter", "hitter",
                "pitcher", "starter", "reliever", "season", "year", "today",
                "yesterday", "kelly", "edge", "projected", "projection",
                "moneyline", "total", "totals", "over", "under", "pick",
                "picks", "lean", "leans", "signal", "signals", "play", "plays",
                "bet", "bets", "wager", "wagers", "lock", "locks", "strong",
                "show", "tell", "what", "which", "when", "where", "why",
                "how", "the", "and", "for", "with", "from", "his", "her",
                "their", "your", "our", "this", "that", "these", "those",
                "have", "has", "had", "been", "are", "was", "did", "does",
                "will", "would", "could", "should", "any", "all", "some",
                "good", "bad", "best", "worst", "most", "least", "more",
                "less", "data", "info", "team", "teams", "player", "players",
            }
            for tok in re.findall(r"\b([a-z][a-z'\-]{3,})\b", text.lower()):
                if tok in _STAT_STOP:
                    continue
                if tok in TEAM_NAMES:
                    continue
                if tok.upper() in ALL_ABBRS:
                    continue
                cand = tok.capitalize()
                if cand in seen:
                    continue
                seen.add(cand)
                found.append(cand)

    return found


def _extract_player_name(text: str) -> Optional[str]:
    """Backward-compat: first player found, or None."""
    names = _extract_player_names(text)
    return names[0] if names else None


def classify(message: str, today: Optional[date] = None) -> ClassifiedQuery:
    """Classify a user message into an intent + entities."""
    if today is None:
        today = date.today()

    text = message.strip()
    lower = text.lower()

    teams = _extract_teams(text)
    team = teams[0] if teams else None
    dt = _extract_date(lower, today)
    players = _extract_player_names(text)
    player = players[0] if players else None

    # Hard override: "today/tonight" + a stake-side word ALWAYS means
    # pick_today, regardless of "how/did/etc". Otherwise tracker_record's
    # broad `how.{0,20}(do|did|...)` swallows "how many units did we bet today".
    if re.search(r"\b(today|tonight)\b", lower) and re.search(
        r"\b(bet|bets|wager|wagers|risk|risking|risked|units?|stake|stakes|"
        r"bankroll|put down)\b",
        lower,
    ) and not re.search(r"\b(roi|record|profit|net|return|won|lost)\b", lower):
        entities = ChatEntities(
            team_abbr=team, team_abbrs=teams, query_date=dt,
            raw_date_str=str(dt) if dt else None,
            player_name=player, player_names=players,
        )
        return ClassifiedQuery(intent="pick_today", entities=entities, original=text)

    entities = ChatEntities(
        team_abbr=team,
        team_abbrs=teams,
        query_date=dt,
        raw_date_str=str(dt) if dt else None,
        player_name=player,
        player_names=players,
    )

    # Out-of-scope prop patterns — catch before team/pick routing
    if re.search(r"\b(home\s*run|homer|hr\b|prop|parlay|futures?|season\s+win|world\s+series|stolen\s+base|strikeout\s+prop)\b", lower):
        return ClassifiedQuery(intent="out_of_scope", entities=entities, original=text)

    # Explanation cues defer comparison routing to model_explain below
    has_explain_cue = bool(re.search(r"\b(why|explain|reason|because)\b", lower))

    # Two+ players with a comparison cue → player_stat (covers "Skubal vs Sanchez")
    if (
        not has_explain_cue
        and len(players) >= 2
        and re.search(r"\b(vs|versus|compare|comparison|better|worse|or)\b", lower)
    ):
        return ClassifiedQuery(intent="player_stat", entities=entities, original=text)

    # Two+ teams with a comparison cue:
    #   - if "pick/bet/wager/lean" present → pick_team (about our picks)
    #   - else → team_stat (about teams themselves: record, OPS, runs)
    if (
        not has_explain_cue
        and len(teams) >= 2
        and re.search(r"\b(vs|versus|compare|comparison|better|worse|or)\b", lower)
    ):
        if re.search(r"\b(pick|picks|bet|bets|wager|lean|signal|our)\b", lower):
            return ClassifiedQuery(intent="pick_team", entities=entities, original=text)
        return ClassifiedQuery(intent="team_stat", entities=entities, original=text)

    # If a player name was found + any stat/performance word → player_stat
    if player and re.search(r"\b(era|whip|fip|stats?|splits?|avg|average|averages|obp|slg|ops|woba|babip|hit|hits|hitting|pitch|pitching|perform|how|recent|last|line|k\b|bb\b|inn|start|relief|batter|hitter|batting)\b", lower):
        return ClassifiedQuery(intent="player_stat", entities=entities, original=text)

    # Team-related question routing:
    #   - "picks / bets / our record" → pick_team (about our picks)
    #   - general team performance ("doing / form / record / season") → team_stat
    if team and re.search(
        r"\b(pick|picks|bet|bets|wager|lean|signal|our)\b",
        lower,
    ):
        return ClassifiedQuery(intent="pick_team", entities=entities, original=text)

    if team and re.search(
        r"\b(record|how.{0,15}done|recent(?:ly)?|show|last|history|involve|"
        r"doing|performing|perform|form|season|year|trend|streak|hot|cold|"
        r"hitting|pitching|ops|runs?|run|win|wins|loss|losses|standing|standings|"
        r"stats?|statistics|numbers?)\b",
        lower,
    ):
        return ClassifiedQuery(intent="team_stat", entities=entities, original=text)

    for pattern, intent in _PATTERNS:
        if re.search(pattern, lower):
            # Disambiguate pick_today vs pick_date
            if intent == "pick_today" and dt and dt != today:
                intent = "pick_date"
            return ClassifiedQuery(intent=intent, entities=entities, original=text)

    # Fallbacks before giving up: if we found an entity, route to its
    # most-useful default instead of out_of_scope.
    if player:
        return ClassifiedQuery(intent="player_stat", entities=entities, original=text)
    if team:
        return ClassifiedQuery(intent="pick_team", entities=entities, original=text)
    if dt:
        return ClassifiedQuery(intent="pick_date", entities=entities, original=text)

    return ClassifiedQuery(intent="out_of_scope", entities=entities, original=text)
