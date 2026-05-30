"""Net line movement — single-book, pre-first-pitch only. NOT cross-book steam.

HONESTY CONSTRAINT (non-negotiable)
-----------------------------------
Prod ``odds_snapshots`` are effectively single-book (DraftKings). True "steam"
is a rapid, synchronized move across MANY books, which we CANNOT observe. This
module computes NET LINE MOVEMENT for ONE book between the OPENING pre-first-
pitch snapshot and the LATEST pre-first-pitch snapshot for the relevant side.
It is labelled "line movement", never "steam"/"lock"/"hammer".

WHAT IT MEASURES
----------------
Per (game, market, side), with the OPEN snapshot (earliest pre-pitch) and the
CLOSE snapshot (latest pre-pitch) — same book, both strictly pre-first-pitch:

  1. american_delta = american_close - american_open  (display-only price move).
  2. devig_prob_delta = p_side(close) - p_side(open)   (THE decision metric).
     Both endpoints are Shin-devigged (two-sided, same book). Positive = the
     market now assigns MORE no-vig probability to our side = the price on our
     side shortened = market moved TOWARD the model.
  3. line_delta (totals only) = line_close - line_open. A half-run line move is
     itself directional: line UP means the market expects MORE runs => favours
     OVER; line DOWN favours UNDER. The line move DOMINATES the totals agreement
     decision when |line_delta| >= 0.5.

SIGN DISCIPLINE (C1/C2 from the review)
---------------------------------------
toward/away is decided SOLELY on the signed vig-free prob delta for the LEANED
side, never on raw american deltas (american odds are discontinuous at ±100 and
non-linear; a vig-only move can swing the american price while the no-vig prob
barely shifts). The american string is display-only. Devig requires BOTH sides
present at BOTH endpoints from the same book; if either endpoint is one-sided we
cannot Shin-devig → fall back to a raw price-implied picked-side delta, flagged
``source='one_sided'`` with suppressed verdict confidence.

EMPTY STATES (no fabrication)
-----------------------------
- ``no_first_pitch`` — game_time_utc is None; the pre-pitch window is undefined.
- ``no_book_snapshots`` — the pinned book has zero pre-pitch rows for the market
  (e.g. only in-game rows captured). We NEVER substitute a different book.
- ``single_snapshot`` — only ONE distinct pre-pitch capture exists; open==close,
  deltas are structurally 0. This is "insufficient data", NOT "no movement".
- ``one_sided`` — an endpoint has only one side; price-only delta, no confident
  verdict.
- ``live`` — a real two-snapshot, two-sided comparison.

Reuses the audited primitives: ``app.betting.quant.shin_probabilities`` (Shin
devig), ``app.betting.implied_probability.implied_probability`` (raw price), and
``app.betting.clv`` helpers (``_to_utc``, ``_resolve_to_abbr``, ``_norm_abbr``)
so selection resolution and the pre-pitch gate are IDENTICAL to CLV.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from app.betting.clv import _norm_abbr, _resolve_to_abbr, _to_utc
from app.betting.implied_probability import implied_probability
from app.betting.quant import shin_probabilities

# ── Tunable thresholds (mirror fair_value's _EV_*_THRESHOLD pattern) ───────────
# Non-neutral requires clearing a vig-free prob move above devig rounding noise.
MIN_PROB_MOVE = 0.015   # >= 1.5 vig-free probability points => non-neutral
# Secondary guard for CHIP WORDING only (not the decision): only render the
# "-110 -> -135" american pair when the price actually moved >= 5 cents.
MIN_PRICE_CENTS = 5
# Totals: a half-run is the smallest MLB total increment — a structural move.
MIN_LINE_MOVE = 0.5


def _round(x: Optional[float], n: int = 4) -> Optional[float]:
    return None if x is None else round(x, n)


# ── Snapshot shape (mirrors clv._Snap; comparison-friendly, DB-free testable) ──
class _Snap:
    __slots__ = ("market", "selection", "line", "american_odds", "captured_at", "bookmaker")

    def __init__(self, market, selection, line, american_odds, captured_at, bookmaker=None):
        self.market = market
        self.selection = selection
        self.line = line
        self.american_odds = american_odds
        self.captured_at = _to_utc(captured_at)
        self.bookmaker = bookmaker


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
                bookmaker=getattr(s, "bookmaker", None),
            )
        )
    return out


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return None if dt is None else dt.isoformat()


# ── Open/close resolution per side ─────────────────────────────────────────────
class _Endpoint:
    """One side's open + close snapshots and the distinct pre-pitch capture count."""

    __slots__ = ("open", "close", "distinct_captures")

    def __init__(self, open_snap, close_snap, distinct_captures):
        self.open = open_snap
        self.close = close_snap
        self.distinct_captures = distinct_captures


def _pre_pitch_candidates(snapshots, market: str, game_start: Optional[datetime]) -> Optional[list[_Snap]]:
    """All valid PRE-FIRST-PITCH rows for the market, oldest-first.

    Returns None when game_start is None (window undefined). Drops post-pitch
    rows, wrong-market rows, and the zero-price sentinel (poisons devig/price).
    The book is assumed pre-filtered by the caller's SQL (preferred book only),
    so every candidate is one book — open=min and close=max are same-book.
    """
    start_utc = _to_utc(game_start)
    if start_utc is None:
        return None
    cands = [
        s
        for s in _coerce_snaps(snapshots)
        if s.market == market
        and s.captured_at is not None
        and s.captured_at < start_utc
        and isinstance(s.american_odds, int)
        and s.american_odds != 0
    ]
    cands.sort(key=lambda s: s.captured_at)  # oldest first
    return cands


def _endpoint_for_side(candidates: list[_Snap], match) -> Optional[_Endpoint]:
    """Earliest + latest pre-pitch snapshot for the side selected by ``match``.

    ``match`` is a predicate _Snap -> bool. ``distinct_captures`` counts distinct
    captured_at timestamps so we can tell "single capture" (==1) from real
    movement (>=2) even when open and close prices happen to be equal.
    """
    side = [s for s in candidates if match(s)]
    if not side:
        return None
    distinct = len({s.captured_at for s in side})
    return _Endpoint(open_snap=side[0], close_snap=side[-1], distinct_captures=distinct)


def resolve_open_close_snapshots(
    *,
    market: str,
    snapshots,
    game_start: Optional[datetime],
    home_abbr: Optional[str] = None,
    away_abbr: Optional[str] = None,
) -> dict:
    """Resolve open/close endpoints for both sides of a market.

    For moneyline: keys 'home'/'away'. For total: keys 'over'/'under'. Each value
    is an _Endpoint or None. Also returns ``no_window`` (game_start is None) and
    ``no_candidates`` (zero pre-pitch rows for the book) so the caller can emit
    the correct empty-state source.
    """
    cands = _pre_pitch_candidates(snapshots, market, game_start)
    if cands is None:
        return {"no_window": True, "no_candidates": False}
    if not cands:
        return {"no_window": False, "no_candidates": True}

    out: dict = {"no_window": False, "no_candidates": False, "_candidates": cands, "_match": {}}
    if market == "moneyline":
        home_norm = _norm_abbr(home_abbr)
        away_norm = _norm_abbr(away_abbr)

        def _is(target_norm):
            def m(s):
                abbr = _norm_abbr(_resolve_to_abbr(s.selection))
                return abbr is not None and abbr == target_norm
            return m

        m_home = _is(home_norm) if home_norm else (lambda s: False)
        m_away = _is(away_norm) if away_norm else (lambda s: False)
        out["home"] = _endpoint_for_side(cands, m_home) if home_norm else None
        out["away"] = _endpoint_for_side(cands, m_away) if away_norm else None
        out["_match"] = {"home": m_home, "away": m_away}
    elif market == "total":
        def _side(name):
            return lambda s: (s.selection or "").strip().lower() == name
        m_over, m_under = _side("over"), _side("under")
        out["over"] = _endpoint_for_side(cands, m_over)
        out["under"] = _endpoint_for_side(cands, m_under)
        out["_match"] = {"over": m_over, "under": m_under}
    return out


def _opp_at_timestamp(candidates, match, captured_at, line_ref):
    """Opponent snapshot captured at the SAME timestamp as our endpoint.

    Devig is only valid for two prices captured at the same instant from the same
    book. For totals the opponent must additionally be at the SAME line as our
    side at that timestamp (a no-vig devig across different lines is meaningless).
    Returns the _Snap or None.
    """
    for s in candidates:
        if s.captured_at != captured_at or not match(s):
            continue
        if getattr(line_ref, "market", None) == "total":
            rl, ol = line_ref.line, s.line
            if rl is None or ol is None or abs(rl - ol) > 1e-9:
                continue
        return s
    return None


# ── Devig helpers ──────────────────────────────────────────────────────────────
def _devig_side_prob(side_odds: int, other_odds: Optional[int]) -> Optional[float]:
    """Shin no-vig prob for ``side_odds`` given its opponent ``other_odds``.

    Returns None when the opponent is missing/zero (one-sided endpoint) — we
    NEVER devig a single side. shin_probabilities returns (first, second, ...) in
    argument order, so pass the side we want first and read back index 0.
    """
    if other_odds is None or other_odds == 0 or side_odds == 0:
        return None
    p_side, _p_other, _z, _booksum = shin_probabilities(side_odds, other_odds)
    return p_side


def _empty(source: str, bookmaker: Optional[str] = None) -> dict:
    return {
        "source": source,
        "bookmaker": bookmaker,
        "open": {"american": None, "line": None, "captured_at": None},
        "close": {"american": None, "line": None, "captured_at": None},
        "side": None,
        "american_delta": None,
        "devig_prob_delta": None,
        "line_delta": None,
        "agreement": None,
        "label": None,
    }


_LABEL = {"toward": "confirmation", "away": "fade", "neutral": "flat"}


def _classify(devig_prob_delta: Optional[float]) -> Optional[str]:
    if devig_prob_delta is None:
        return None
    if devig_prob_delta > MIN_PROB_MOVE:
        return "toward"
    if devig_prob_delta < -MIN_PROB_MOVE:
        return "away"
    return "neutral"


def compute_movement(
    *,
    market: str,
    snapshots,
    game_start: Optional[datetime],
    leaned_side: Optional[str],
    home_abbr: Optional[str] = None,
    away_abbr: Optional[str] = None,
    bookmaker: Optional[str] = None,
) -> dict:
    """Per-market movement dict (see module docstring / apiContract).

    ``market`` ∈ {'moneyline','total'}. ``leaned_side`` is the model's lean: for
    moneyline 'home'/'away' (lower-cased ml_lean), for total 'over'/'under'
    (lower-cased total_lean), or None/'pass' when there is no directional pick.
    When there is no lean we still surface the raw movement (side='market')
    but with agreement=None/label=None — never toward/away.

    Sign discipline is anchored on the LEANED side's Shin vig-free prob delta.
    For totals, a line move >= 0.5 in the leaned direction dominates the
    decision; otherwise we fall back to the price-only vig-free prob delta.
    """
    resolution = resolve_open_close_snapshots(
        market=market,
        snapshots=snapshots,
        game_start=game_start,
        home_abbr=home_abbr,
        away_abbr=away_abbr,
    )
    if resolution.get("no_window"):
        return _empty("no_first_pitch", bookmaker)
    if resolution.get("no_candidates"):
        return _empty("no_book_snapshots", bookmaker)

    lean = (leaned_side or "").strip().lower()
    if market == "moneyline":
        side_key = lean if lean in ("home", "away") else None
        other_key = "away" if side_key == "home" else "home" if side_key == "away" else None
    else:
        side_key = lean if lean in ("over", "under") else None
        other_key = "under" if side_key == "over" else "over" if side_key == "under" else None

    # When there is NO lean we still want to surface raw movement. Pick a side to
    # measure FROM purely for display (home / over), framed as 'market'.
    measure_key = side_key
    if measure_key is None:
        measure_key = "home" if market == "moneyline" else "over"
        measure_other = "away" if market == "moneyline" else "under"
    else:
        measure_other = other_key

    ep = resolution.get(measure_key)
    if ep is None:
        # Our side never had a pre-pitch capture from this book.
        return _empty("no_book_snapshots", bookmaker)

    # Single distinct capture => insufficient data, NOT "neutral / no movement".
    if ep.distinct_captures < 2:
        out = _empty("single_snapshot", bookmaker)
        # Surface the single price for context (open == close).
        out["open"] = {
            "american": int(ep.open.american_odds),
            "line": ep.open.line if market == "total" else None,
            "captured_at": _iso(ep.open.captured_at),
        }
        out["close"] = dict(out["open"])
        out["side"] = side_key if side_key else "market"
        return out

    open_snap, close_snap = ep.open, ep.close
    american_open = int(open_snap.american_odds)
    american_close = int(close_snap.american_odds)
    american_delta = american_close - american_open

    line_open = open_snap.line if market == "total" else None
    line_close = close_snap.line if market == "total" else None
    line_delta = (
        _round(line_close - line_open, 4)
        if (market == "total" and line_open is not None and line_close is not None)
        else None
    )

    # ── Vig-free prob delta on the MEASURED side (Shin devig at each endpoint) ──
    # The opponent leg of each devig MUST be captured at the SAME timestamp as our
    # snapshot (same book is already guaranteed by the SQL filter). We look the
    # opponent up at our open's and our close's exact captured_at — not from the
    # opponent's own independent open/close, which could be a different instant.
    candidates = resolution.get("_candidates", [])
    opp_match = resolution.get("_match", {}).get(measure_other, lambda s: False)
    devig_prob_delta = None
    source = "live"
    # For totals, the no-vig prob is only comparable at the SAME line. If the book
    # moved the line, a devig across lines is meaningless — leave it None and let
    # line_delta drive the totals decision below.
    cross_line_total = (
        market == "total" and line_delta is not None and abs(line_delta) >= 1e-9
    )
    if not cross_line_total:
        opp_open = _opp_at_timestamp(candidates, opp_match, open_snap.captured_at, open_snap)
        opp_close = _opp_at_timestamp(candidates, opp_match, close_snap.captured_at, close_snap)
        p_open = _devig_side_prob(american_open, int(opp_open.american_odds)) if opp_open else None
        p_close = _devig_side_prob(american_close, int(opp_close.american_odds)) if opp_close else None
        if p_open is not None and p_close is not None:
            devig_prob_delta = _round(p_close - p_open, 4)
        else:
            # An endpoint was one-sided (no same-instant opponent) → can't Shin-devig.
            source = "one_sided"

    # Does a dominant totals line move carry the decision on its own?
    line_dominates = (
        market == "total"
        and line_delta is not None
        and abs(line_delta) >= MIN_LINE_MOVE
    )

    devig_prob_delta_for_class = devig_prob_delta
    if devig_prob_delta is None and not line_dominates:
        # Either an endpoint was one-sided, or a sub-tick totals line move left us
        # unable to compare no-vig probs across lines. Fall back to a RAW
        # price-implied picked-side delta for classification (lower confidence).
        raw_open = implied_probability(american_open)
        raw_close = implied_probability(american_close)
        devig_prob_delta_for_class = _round(raw_close - raw_open, 4)

    # ── Agreement (toward/away/neutral) anchored on the LEANED side ─────────────
    agreement = None
    if side_key is not None:
        if market == "total" and line_delta is not None and abs(line_delta) >= MIN_LINE_MOVE:
            # Line move dominates and is itself directional. The market moving the
            # total UP means it now expects MORE runs => favours OVER; moving it
            # DOWN favours UNDER (per the reviewer's worked example 3: 8.5->9.0
            # with an OVER pick is "toward over").
            line_up = line_delta > 0
            if side_key == "over":
                agreement = "toward" if line_up else "away"
            else:  # under
                agreement = "away" if line_up else "toward"
        else:
            agreement = _classify(devig_prob_delta_for_class)

    label = _LABEL.get(agreement) if agreement is not None else None

    return {
        "source": source,
        "bookmaker": bookmaker or open_snap.bookmaker or close_snap.bookmaker,
        "open": {
            "american": american_open,
            "line": line_open,
            "captured_at": _iso(open_snap.captured_at),
        },
        "close": {
            "american": american_close,
            "line": line_close,
            "captured_at": _iso(close_snap.captured_at),
        },
        "side": side_key if side_key is not None else "market",
        "american_delta": american_delta,
        # On a two-sided endpoint this is the true Shin vig-free delta. On a
        # one-sided endpoint it's the raw price-implied picked-side delta (the
        # 'one_sided' source flags the lower confidence). On a dominant totals
        # line move it's null — the line move (line_delta) carries the signal.
        "devig_prob_delta": devig_prob_delta_for_class if source == "one_sided" else devig_prob_delta,
        "line_delta": line_delta,
        "agreement": agreement,
        "label": label,
    }
