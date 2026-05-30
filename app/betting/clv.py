"""Closing Line Value (CLV) — deterministic, anti-lookahead, no-fake-data.

CLV measures whether a tracked bet got a better number than the market's
*closing* price. It is the single most reliable long-run proxy for betting
skill: a bettor who consistently beats the close has a real edge even before
results accumulate.

DEFINITION OF "THE CLOSE" (anti-lookahead, non-negotiable)
----------------------------------------------------------
The closing snapshot for a BetRecord's (game_id, market, picked side) is the
single most-recent `odds_snapshots` row whose `captured_at` is STRICTLY BEFORE
the game's scheduled first pitch (`games.game_time_utc`).

Live in-game odds are polled and land in `odds_snapshots` with `captured_at`
AFTER first pitch. Those rows MUST NEVER be selected as the close. The strict
`captured_at < first_pitch` predicate is the only lookahead gate — never the
bet's `created_at` (row-insert time, which can post-date first pitch).

If `game_time_utc` is None, the close cannot be defined → all CLV fields null,
clv_source='no_first_pitch'. If no pre-first-pitch snapshot exists for the
picked side, clv_source='no_close_captured'. We never invent a close.

TIMEZONE (C1 — verified SQLite footgun)
---------------------------------------
SQLite's `DateTime(timezone=True)` silently strips tzinfo on write and returns
NAIVE datetimes on read; Postgres returns tz-aware. Comparing a naive read-back
against a tz-aware `game_time_utc` raises TypeError. We therefore coerce BOTH
sides to tz-aware UTC in Python (`_to_utc`) before comparing, and do the final
authoritative comparison in Python on coerced values — never rely on the ORM
column type. All persisted timestamps in this codebase are UTC wall-clock
(mlb_stats_api normalizes game_time_utc to UTC; ingesters write
datetime.now(timezone.utc)), so coercing a naive value to UTC is correct.

SELECTION MATCHING (C2/C3)
--------------------------
ML: snapshot `selection` is provider-dependent (full lowercase team name from
the-odds-api; lowercase abbr from ESPN). It is NEVER the bet's uppercase abbr,
so equality always fails. We resolve each candidate snapshot's selection to a
team abbr via the SAME resolver the live-odds endpoint uses
(TEAM_NAMES / ALL_ABBRS / ABBR_NORM) and compare normalized abbr to the bet's
normalized picked abbr (handles AZ→ARI, ATH→OAK).

TOTAL: bet.selection ∈ {OVER, UNDER}; snapshot selection ∈ {over, under}
(case-insensitive match). The close must be graded at the SAME line the pick
was taken on (a pick at 8.5 vs a close at 9.0 is a different bet). We prefer the
latest pre-pitch snapshot at the bet's exact line; if the book moved off that
line and only other-line rows exist, we fall back to the latest pre-pitch row
for that side and flag clv_source='total-line-mismatch'.

DEVIG (C4)
----------
CLV is measured in Shin vig-free probability space, apples-to-apples with the
pick's stored `market_implied_prob` (also Shin vig-free, picked-side). Devig
needs BOTH sides of the close; if only one side has a pre-pitch snapshot we
cannot devig → closing_implied_prob null, clv_source='one_sided_close', but we
still store the picked side's closing_odds so a price-based CLV is available.

Snapshots with american_odds == 0 are invalid (missing-price sentinel from the
provider) and are filtered out before any math.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.betting.implied_probability import implied_probability
from app.betting.quant import shin_probabilities

# ── Selection resolution (reuse the classifier maps; do NOT reinvent) ─────────
from app.chat.classifier import ABBR_NORM, ALL_ABBRS, TEAM_NAMES


def _norm_abbr(abbr: Optional[str]) -> Optional[str]:
    if not abbr:
        return None
    up = abbr.strip().upper()
    return ABBR_NORM.get(up, up)


def _resolve_to_abbr(selection: str) -> Optional[str]:
    """Resolve a provider selection string to a team abbr.

    Mirrors routes._latest_odds_by_game._resolve_to_abbr so ML matching is
    identical to the live-odds path. Returns None when no team resolves (we
    treat that as 'no match' and never guess).
    """
    if not selection:
        return None
    s = selection.strip()
    up = s.upper()
    if up in ALL_ABBRS:
        return up
    low = s.lower()
    if low in TEAM_NAMES:
        return TEAM_NAMES[low]
    for name, abbr in TEAM_NAMES.items():
        if name in low or low in name:
            return abbr
    return None


def _to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Coerce a datetime to tz-aware UTC.

    Naive datetimes (SQLite read-back, or naive utcnow writes) are interpreted
    as UTC wall-clock — correct for this codebase, where every persisted
    timestamp is UTC. Aware datetimes are converted to UTC. None passes through.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _round(x: Optional[float], n: int = 4) -> Optional[float]:
    return None if x is None else round(x, n)


# ── Snapshot shape ────────────────────────────────────────────────────────────
class _Snap:
    """Lightweight, comparison-friendly snapshot.

    Accepts ORM rows or plain objects exposing market/selection/line/
    american_odds/captured_at. Used so the resolver can be unit-tested without a
    DB.
    """

    __slots__ = ("market", "selection", "line", "american_odds", "captured_at")

    def __init__(self, market, selection, line, american_odds, captured_at):
        self.market = market
        self.selection = selection
        self.line = line
        self.american_odds = american_odds
        self.captured_at = _to_utc(captured_at)


def _coerce_snaps(snapshots) -> list[_Snap]:
    out: list[_Snap] = []
    for s in snapshots:
        out.append(
            _Snap(
                market=getattr(s, "market", None),
                selection=getattr(s, "selection", None),
                line=getattr(s, "line", None),
                american_odds=getattr(s, "american_odds", None),
                captured_at=getattr(s, "captured_at", None),
            )
        )
    return out


# ── Closing-snapshot resolver ─────────────────────────────────────────────────
class ClosingResolution:
    """Resolved closing snapshots for the picked side and its opponent.

    `picked` / `opponent` are _Snap or None. `source_hint` carries a clv_source
    flag the caller may override (e.g. 'total-line-mismatch'). `valid_pre_pitch`
    is the count of pre-pitch snapshots seen for this market (coverage signal).
    """

    __slots__ = ("picked", "opponent", "source_hint")

    def __init__(self, picked, opponent, source_hint=None):
        self.picked = picked
        self.opponent = opponent
        self.source_hint = source_hint


def resolve_closing_snapshots(
    *,
    market: str,
    picked_selection: str,
    total_line: Optional[float],
    home_abbr: str,
    away_abbr: str,
    snapshots,
    game_start: Optional[datetime],
) -> ClosingResolution:
    """Pure resolver. Pre-fetched `snapshots` are ALL rows for this game+market.

    Applies the strict pre-first-pitch filter in Python on UTC-coerced
    timestamps (C1), resolves ML selection via abbr (C2), and grades totals at
    the bet's line (C3). Returns the latest valid pre-pitch picked-side snapshot
    and the matching opponent snapshot for devig.
    """
    start_utc = _to_utc(game_start)
    if start_utc is None:
        return ClosingResolution(None, None, source_hint="no_first_pitch")

    # Strict anti-lookahead: drop anything at/after first pitch, wrong market,
    # or invalid (zero-price) odds. Sort newest-first.
    candidates = [
        s
        for s in _coerce_snaps(snapshots)
        if s.market == market
        and s.captured_at is not None
        and s.captured_at < start_utc
        and isinstance(s.american_odds, int)
        and s.american_odds != 0
    ]
    candidates.sort(key=lambda s: s.captured_at, reverse=True)

    if market == "moneyline":
        return _resolve_ml(candidates, picked_selection, home_abbr, away_abbr)
    if market == "total":
        return _resolve_total(candidates, picked_selection, total_line)
    return ClosingResolution(None, None, source_hint="no_close_captured")


def _resolve_ml(candidates, picked_selection, home_abbr, away_abbr) -> ClosingResolution:
    pick_norm = _norm_abbr(picked_selection)
    home_norm = _norm_abbr(home_abbr)
    away_norm = _norm_abbr(away_abbr)

    picked = opponent = None
    for s in candidates:  # newest-first
        abbr = _norm_abbr(_resolve_to_abbr(s.selection))
        if abbr is None:
            continue
        if abbr == pick_norm and picked is None:
            picked = s
        elif abbr != pick_norm and (abbr == home_norm or abbr == away_norm) and opponent is None:
            # opponent is the OTHER side of this game
            opponent = s
        if picked is not None and opponent is not None:
            break

    if picked is None:
        return ClosingResolution(None, None, source_hint="no_close_captured")
    return ClosingResolution(picked, opponent, source_hint=None)


def _resolve_total(candidates, picked_selection, total_line) -> ClosingResolution:
    pick_side = (picked_selection or "").strip().lower()  # 'over' | 'under'
    other_side = "under" if pick_side == "over" else "over"

    def side_rows(side):
        return [s for s in candidates if (s.selection or "").strip().lower() == side]

    pick_rows = side_rows(pick_side)
    other_rows = side_rows(other_side)
    if not pick_rows:
        return ClosingResolution(None, None, source_hint="no_close_captured")

    source_hint = None
    picked = None
    opponent = None

    if total_line is not None:
        # Prefer the close graded at the SAME line the pick was taken on.
        at_line = [s for s in pick_rows if s.line is not None and abs(s.line - total_line) < 1e-9]
        if at_line:
            picked = at_line[0]
            line = picked.line
            opp_at_line = [
                s for s in other_rows
                if s.line is not None and abs(s.line - line) < 1e-9
            ]
            opponent = opp_at_line[0] if opp_at_line else None
        else:
            # Book moved off the pick's line: fall back to latest pre-pitch row
            # for that side, flag the mismatch (still real data).
            picked = pick_rows[0]
            source_hint = "total-line-mismatch"
            line = picked.line
            opp_match = [
                s for s in other_rows
                if s.line is not None and line is not None and abs(s.line - line) < 1e-9
            ]
            opponent = opp_match[0] if opp_match else None
    else:
        # No tracked line on the bet — take latest pre-pitch row for the side.
        picked = pick_rows[0]
        line = picked.line
        opp_match = [
            s for s in other_rows
            if s.line is not None and line is not None and abs(s.line - line) < 1e-9
        ]
        opponent = opp_match[0] if opp_match else None

    return ClosingResolution(picked, opponent, source_hint=source_hint)


# ── Public compute ────────────────────────────────────────────────────────────
_NULL_RESULT = {
    "closing_odds": None,
    "closing_line": None,
    "closing_implied_prob": None,
    "closing_captured_at": None,
    "clv_pct": None,
    "beat_close": None,
    "price_clv": None,
    "clv_source": "no_close_captured",
}


def compute_clv(
    *,
    market: str,
    picked_selection: str,
    total_line: Optional[float],
    home_abbr: str,
    away_abbr: str,
    american_odds_at_pick: int,
    market_implied_prob_at_pick: Optional[float],
    snapshots,
    game_start: Optional[datetime],
) -> dict:
    """Pure CLV computation. Returns the column dict (+ price_clv for the UI).

    Keys: closing_odds, closing_line, closing_implied_prob, closing_captured_at,
    clv_pct, beat_close, price_clv, clv_source.

    clv_pct (prob points) = closing_implied_prob − market_implied_prob_at_pick,
    both Shin vig-free, picked-side. Positive ⇒ you got a longer price than the
    close ⇒ you BEAT the close. Requires both sides of the close for the devig;
    if only the picked side closed, clv_pct/closing_implied_prob are null and
    clv_source='one_sided_close', but price_clv (raw, picked-side only) is still
    returned for display.
    """
    res = resolve_closing_snapshots(
        market=market,
        picked_selection=picked_selection,
        total_line=total_line,
        home_abbr=home_abbr,
        away_abbr=away_abbr,
        snapshots=snapshots,
        game_start=game_start,
    )

    if res.picked is None:
        out = dict(_NULL_RESULT)
        if res.source_hint:  # 'no_first_pitch' etc.
            out["clv_source"] = res.source_hint
        return out

    picked = res.picked
    closing_odds = int(picked.american_odds)
    closing_line = picked.line if market == "total" else None
    closing_captured_at = picked.captured_at

    # Price-based CLV (picked side only — always available once we have a close).
    raw_pick = implied_probability(american_odds_at_pick) if american_odds_at_pick else None
    raw_close = implied_probability(closing_odds)
    price_clv = (
        round(raw_close - raw_pick, 4) if raw_pick is not None else None
    )

    # Two-sided devig for the honest prob-point CLV.
    closing_implied_prob = None
    clv_pct = None
    beat_close = None
    clv_source = "live"
    if res.source_hint == "total-line-mismatch":
        clv_source = "total-line-mismatch"

    if res.opponent is None:
        # Can't devig with one side → flag, keep closing_odds + price_clv.
        clv_source = "one_sided_close" if res.source_hint != "total-line-mismatch" else clv_source
        return {
            "closing_odds": closing_odds,
            "closing_line": closing_line,
            "closing_implied_prob": None,
            "closing_captured_at": closing_captured_at,
            "clv_pct": None,
            "beat_close": None,
            "price_clv": price_clv,
            "clv_source": "one_sided_close" if res.source_hint != "total-line-mismatch" else "total-line-mismatch",
        }

    p_picked_close, _p_other, _z, _b = shin_probabilities(
        closing_odds, int(res.opponent.american_odds)
    )
    closing_implied_prob = round(p_picked_close, 4)

    if market_implied_prob_at_pick is not None:
        clv_pct = round(closing_implied_prob - market_implied_prob_at_pick, 4)
        beat_close = clv_pct > 0
    else:
        # No vig-free pick anchor (pre-model-state pick). prob-point CLV can't
        # be anchored honestly; fall back to price_clv only and flag so
        # calibration can exclude. closing_implied_prob is still real/stored.
        clv_source = "no_pick_anchor"

    return {
        "closing_odds": closing_odds,
        "closing_line": closing_line,
        "closing_implied_prob": closing_implied_prob,
        "closing_captured_at": closing_captured_at,
        "clv_pct": clv_pct,
        "beat_close": beat_close,
        "price_clv": price_clv,
        "clv_source": clv_source,
    }


def compute_clv_for_bet(db, bet, game) -> dict:
    """DB-backed wrapper used by settle + backfill. Fetches snapshots and calls
    the pure `compute_clv`. Returns the column dict (drops price_clv, which is
    derived at read-time from closing_odds when needed; we keep it in the pure
    return for tests/UI but do not persist a dedicated column).

    `game` may be None (unknown game) → no first pitch → null CLV.
    """
    from sqlalchemy import select

    from app.models.odds import OddsSnapshotRow

    game_start = getattr(game, "game_time_utc", None) if game is not None else None

    snapshots = (
        db.execute(
            select(OddsSnapshotRow).where(
                OddsSnapshotRow.game_id == bet.game_id,
                OddsSnapshotRow.market == bet.market,
            )
        )
        .scalars()
        .all()
    )

    result = compute_clv(
        market=bet.market,
        picked_selection=bet.selection,
        total_line=bet.total_line,
        home_abbr=bet.home_team_abbr,
        away_abbr=bet.away_team_abbr,
        american_odds_at_pick=bet.american_odds,
        market_implied_prob_at_pick=bet.market_implied_prob,
        snapshots=snapshots,
        game_start=game_start,
    )
    return result


def apply_clv_to_bet(bet, result: dict, *, clv_source_override: Optional[str] = None) -> None:
    """Write the CLV column dict onto a BetRecord in place. Idempotent."""
    bet.closing_odds = result.get("closing_odds")
    bet.closing_line = result.get("closing_line")
    bet.closing_implied_prob = result.get("closing_implied_prob")
    bet.closing_captured_at = result.get("closing_captured_at")
    bet.clv_pct = result.get("clv_pct")
    bet.beat_close = result.get("beat_close")
    bet.clv_source = clv_source_override or result.get("clv_source")
