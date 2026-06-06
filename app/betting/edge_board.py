"""+EV Edge Board — model-vs-no-vig edge per game/market for the slate payload.

The "edge" surfaced here is the SAME audited, anti-lookahead-safe number the rest
of the product (tiers, Kelly, CLV seed) is built on:

    EDGE(lean side) = model_vigfree_prob(side) − novig_market_prob(side)
                    = q_p_shrunk      − q_shin_vig_free      (moneyline)
                    = qt_p_shrunk     − qt_shin_vig_free     (total)

which is exactly ``q_edge_quant`` / ``qt_edge_quant`` already on every slate game's
``analysis`` block. We do NOT add a second devig pass: the no-vig market prob comes
from the analyzer's own Shin devig of the same single (pinned) book, so the board's
``model_prob``, ``novig_prob`` and ``edge`` columns all reconcile to one source.

Asymmetry handled (review C2): the totals branch serializes ``qt_edge_quant`` and
``qt_p_shrunk`` but NO ``qt_shin_vig_free`` field. The no-vig market prob for a total
is recovered ALGEBRAICALLY — ``novig = p_shrunk − edge`` — which is exact since
``edge = p_shrunk − shin_vf``. Zero new backend devig work.

No-fake-data gating (review C3): a market with no two-sided same-book price has
``q_has_real_odds`` / ``qt_has_real_odds`` == False, in which case the analyzer
zeroes the quant fields and forces tier=PASS. We treat that as **null edge** (the UI
renders an honest "no market" cell), NEVER a fabricated ``0.0%`` edge. This is the
canonical model-side flag; it coincides with ``live_odds.<mkt>.fair is None``.

Sign discipline (review C4): edge is defined ONLY for the leaned side. ``q_edge_quant``
is already computed for the leaned side (the analyzer picks the lean side and its
odds before devigging), so we never re-pick or mirror a side. On a PASS market (no
directional lean) we surface the MODEL-IMPLIED side so the number is still computable
and honest, but flag ``actionable=False`` so the UI demotes it and never reads it as
a recommendation. Verification framing only — this is where the model disagrees with
the no-vig market, not a guaranteed-winners list.
"""
from __future__ import annotations

from typing import Optional

# Tiers that represent an actionable directional lean (everything else is PASS-like).
_ACTIONABLE_TIERS = ("STRONG LEAN", "LEAN")


def model_market_edge(model_prob: float, novig_prob: float) -> float:
    """Pure edge: model vig-free prob MINUS no-vig market prob, on ONE side.

    Positive ⇒ the model assigns the side more true probability than the no-vig
    book ⇒ genuine +EV disagreement. Rounded to 4dp to match the analyzer fields.
    """
    return round(model_prob - novig_prob, 4)


def _moneyline_edge(analysis: dict) -> Optional[dict]:
    """ML edge object for the board, or None when there is no two-sided price.

    Reuses the analyzer's leaned-side ``q_p_shrunk`` (model vig-free prob) and
    ``q_shin_vig_free`` (no-vig market prob). ``q_edge_quant`` already equals
    p_shrunk − shin_vf for the lean side; we recompute via ``model_market_edge`` so
    the rendered model_prob/novig_prob/edge trio is internally consistent.
    """
    # Gate on the canonical model-side flag: no real two-sided book odds ⇒ no edge.
    if not analysis.get("q_has_real_odds"):
        return None

    tier = analysis.get("ml_tier") or "PASS"
    lean = (analysis.get("ml_lean") or "PASS").upper()

    if lean in ("HOME", "AWAY"):
        side = lean.lower()
        actionable = tier in _ACTIONABLE_TIERS
    else:
        # PASS / no directional lean → model-implied side so the edge is computable
        # and honest, but non-actionable (demoted, hidden by default in the UI).
        home_p = analysis.get("model_home_win_prob")
        if home_p is None:
            return None
        side = "home" if home_p >= 0.5 else "away"
        actionable = False

    model_prob = analysis.get("q_p_shrunk")
    novig_prob = analysis.get("q_shin_vig_free")
    if model_prob is None or novig_prob is None:
        return None

    return {
        "side": side,
        "tier": tier,
        "actionable": actionable,
        "model_prob": round(model_prob, 4),
        "novig_prob": round(novig_prob, 4),
        "edge": model_market_edge(model_prob, novig_prob),
        "hold_pct": _hold_pct(analysis, market="moneyline"),
        "movement_agreement": _movement_agreement(analysis, market="moneyline"),
    }


def _total_edge(analysis: dict) -> Optional[dict]:
    """Total edge object for the board, or None when there is no two-sided price.

    No ``qt_shin_vig_free`` field exists, so the no-vig market prob is recovered
    algebraically: novig = qt_p_shrunk − qt_edge_quant (exact, since
    edge = p_shrunk − shin_vf). The leaned-side sign is already baked into
    qt_edge_quant by the analyzer.
    """
    if not analysis.get("qt_has_real_odds"):
        return None

    tier = analysis.get("total_tier") or "PASS"
    lean = (analysis.get("total_lean") or "PASS").upper()

    if lean in ("OVER", "UNDER"):
        side = lean.lower()
        actionable = tier in _ACTIONABLE_TIERS
    else:
        # PASS → model-implied side (projected vs line). If the line is unknown the
        # side is undefined → no honest edge to show.
        proj = analysis.get("projected_total")
        line = analysis.get("total_line")
        if proj is None or line is None:
            return None
        side = "over" if proj >= line else "under"
        actionable = False

    model_prob = analysis.get("qt_p_shrunk")
    edge_quant = analysis.get("qt_edge_quant")
    if model_prob is None or edge_quant is None:
        return None

    novig_prob = round(model_prob - edge_quant, 4)

    return {
        "side": side,
        "line": analysis.get("total_line"),
        "tier": tier,
        "actionable": actionable,
        "model_prob": round(model_prob, 4),
        "novig_prob": novig_prob,
        "edge": model_market_edge(model_prob, novig_prob),
        "hold_pct": _hold_pct(analysis, market="total"),
        "movement_agreement": _movement_agreement(analysis, market="total"),
    }


def _hold_pct(analysis: dict, *, market: str) -> Optional[float]:
    """Book overround for this market from the attached live_odds fair block.

    The fair block is the SAME Shin devig that produced novig_prob, so hold and edge
    reconcile. Returns None when no fair block exists (one-sided / missing price).
    """
    live = analysis.get("_live_odds")
    if not isinstance(live, dict):
        return None
    mkt = live.get(market)
    if not isinstance(mkt, dict):
        return None
    fair = mkt.get("fair")
    if not isinstance(fair, dict):
        return None
    return fair.get("hold_pct")


def _movement_agreement(analysis: dict, *, market: str) -> Optional[str]:
    """toward/away/neutral agreement vs the model lean, from the movement block.

    Honest empty states (single_snapshot / no_book_snapshots / no_first_pitch) carry
    no agreement verdict → None here; the UI renders the movement column's own honest
    empty state, never a fabricated 'flat'.
    """
    live = analysis.get("_live_odds")
    if not isinstance(live, dict):
        return None
    mkt = live.get(market)
    if not isinstance(mkt, dict):
        return None
    mv = mkt.get("movement")
    if not isinstance(mv, dict):
        return None
    return mv.get("agreement")


def build_model_edge(analysis: Optional[dict], live_odds: Optional[dict]) -> Optional[dict]:
    """Per-game ``model_edge`` block for the slate payload.

    Returns ``{"moneyline": <edgeobj|None>, "total": <edgeobj|None>}`` or None when
    there is no analysis at all. Each edgeobj is None when that market has no
    two-sided same-book price (or the model lacks real odds for it) — an honest "no
    market" state, never a fabricated edge.

    ``live_odds`` (with its ``.fair`` and ``.movement`` sub-blocks) is threaded onto
    the analysis dict under a private ``_live_odds`` key purely so the hold% and
    movement columns read from the SAME fair attach the rest of the page uses; it is
    not mutated on the caller's payload.
    """
    if not isinstance(analysis, dict):
        return None

    # Shallow copy + private live_odds handle so we never compute a second devig and
    # never mutate the caller's analysis dict.
    a = dict(analysis)
    a["_live_odds"] = live_odds if isinstance(live_odds, dict) else None

    return {
        "moneyline": _moneyline_edge(a),
        "total": _total_edge(a),
    }
