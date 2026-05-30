"""Parlay / Same-Game-Parlay (SGP) checker — how badly a book prices a parlay.

This module is the "verification, not picks" layer for multi-leg bets. It exposes
the two genuinely distinct, honest reveals about parlay pricing:

  1. STRUCTURAL (book) compounded hold — the book stacks its single-leg vig
     MULTIPLICATIVELY across legs. ``book_compounded_hold = Π(booksum_i) - 1``,
     computed PURELY from each leg's two-sided pricing. This does NOT depend on
     the user's offered price and does NOT collapse into EV.

  2. EV of the OFFERED parlay vs the independence-fair prob (same bands as the
     boost tool: +EV / marginal / -EV). For a parlay priced off the same legs,
     the "offered hold" (1 − P·offered_decimal) is *identically* ``-EV_per_unit``
     — so we never present those two as separate findings. We surface the
     structural book hold (reveal #1) and the EV (reveal #2), and label the
     offered-vs-fair overround for what it is.

Everything is built on the existing, audited primitives — NO odds math is
duplicated here:

  * ``app.betting.fair_value.fair_value``  — Shin two-sided devig per leg (when
    both sides supplied). Returns ``prob_a`` (taken-side fair prob) + ``booksum``.
  * ``app.betting.fair_value.american_from_decimal`` / ``fair_american_from_prob``
  * ``app.betting.implied_probability.decimal_odds`` / ``implied_probability``
  * ``app.betting.fair_value._verdict`` — IDENTICAL EV bands (+2.0 / -1.0) so the
    parlay tool and the boost tool never diverge.

Hard honesty rules (from the adversarial review):

  * Per-leg devig assumes nothing about independence. Independence enters ONLY at
    the product step, which is labeled ``fair_basis = "independence"``.
  * A single-priced leg (no opposite, no fair_prob) falls back to RAW vig-loaded
    ``implied_probability`` and is flagged ``vig_loaded=True``. A vig-loaded leg
    overstates its true prob, so the fair parlay decimal is too LOW / book edge
    understated — that caveat propagates to the PARLAY-LEVEL verdict.
  * Same-game correlation is detected purely from a user-supplied ``game_tag``.
    When 2+ legs share a tag the independence product is invalid; we attach a
    verbatim warning and label every derived number an INDEPENDENCE ESTIMATE.
    We NEVER emit a correlation-adjusted probability, price, or coefficient —
    doing so without a joint model would be fabrication.
"""
from __future__ import annotations

from typing import List, Optional

from app.betting.fair_value import (
    _verdict,
    american_from_decimal,
    fair_american_from_prob,
    fair_value,
)
from app.betting.implied_probability import decimal_odds, implied_probability


# Verbatim correlation warning text (no number invented — direction-of-bias only).
def _correlation_warning(groups: List[dict]) -> str:
    parts = []
    for g in groups:
        parts.append(
            f"Correlation warning: {g['leg_count']} legs share game "
            f"'{g['game_tag']}'. Same-game legs are positively correlated, so the "
            "true parlay probability is NOT the product of the leg probabilities. "
            "The fair decimal and EV shown are an INDEPENDENCE ESTIMATE only and "
            "are not valid for a same-game parlay. We do not estimate the "
            "correlation adjustment — doing so without a joint model would be "
            "fabrication. Treat these numbers as a lower bound on fairness, not a "
            "price."
        )
    return " ".join(parts)


def _resolve_leg(leg: dict) -> dict:
    """Resolve one leg to a vig-free (or, as a flagged fallback, vig-loaded) prob.

    Priority (recorded as ``prob_source`` for honesty):
      1. ``fair_prob`` supplied and in (0,1)        -> "supplied"
      2. both ``american`` and ``opposite_american`` -> "devig" (Shin two-sided)
      3. only ``american``                           -> "raw_implied" (vig_loaded)

    Raises ``ValueError`` (caller -> 422) on a degenerate/missing price; never
    clamps a bad prob into range and pretends.
    """
    american = leg.get("american")
    opposite = leg.get("opposite_american")
    fair_prob = leg.get("fair_prob")

    if american is None or american == 0:
        raise ValueError("each leg american must be present and non-zero (0 is the missing-price sentinel)")
    if opposite is not None and opposite == 0:
        raise ValueError("opposite_american, when given, must be non-zero (0 is the missing-price sentinel)")

    prob_source: str
    vig_loaded = False
    leg_hold_pct: Optional[float] = None

    if fair_prob is not None:
        if fair_prob <= 0.0 or fair_prob >= 1.0:
            raise ValueError("fair_prob must be strictly between 0 and 1")
        prob = float(fair_prob)
        prob_source = "supplied"
    elif opposite is not None:
        fv = fair_value(american, opposite)
        if fv is None:
            # one side zero/missing — fall back to single-price vig-loaded path
            prob = implied_probability(american)
            prob_source = "raw_implied"
            vig_loaded = True
        else:
            prob = fv["prob_a"]
            leg_hold_pct = fv["hold_pct"]
            prob_source = "devig"
    else:
        prob = implied_probability(american)
        prob_source = "raw_implied"
        vig_loaded = True

    if prob <= 0.0 or prob >= 1.0:
        raise ValueError("resolved leg probability must be strictly between 0 and 1")

    return {
        "label": leg.get("label"),
        "american": int(american),
        "opposite_american": int(opposite) if opposite is not None else None,
        "game_tag": leg.get("game_tag"),
        "fair_prob": round(prob, 4),
        "_prob": prob,  # full-precision for the product
        "prob_source": prob_source,
        "vig_loaded": vig_loaded,
        "leg_hold_pct": leg_hold_pct,
        "fair_american": fair_american_from_prob(prob),
        "_booksum": (1.0 + leg_hold_pct / 100.0) if leg_hold_pct is not None else None,
    }


def _detect_correlation(legs: List[dict]) -> tuple[bool, List[dict]]:
    """Group legs by normalized (trimmed, lowercased) non-empty game_tag.

    Detection is purely on user-supplied tags — we never infer correlation from
    team names. A group with >= 2 legs marks a same-game parlay.
    """
    groups: dict[str, dict] = {}
    for idx, leg in enumerate(legs):
        tag = leg.get("game_tag")
        if tag is None:
            continue
        norm = str(tag).strip().lower()
        if not norm:
            continue
        bucket = groups.setdefault(norm, {"game_tag": str(tag).strip(), "leg_indices": []})
        bucket["leg_indices"].append(idx)

    correlated_groups = [
        {"game_tag": g["game_tag"], "leg_count": len(g["leg_indices"]), "leg_indices": g["leg_indices"]}
        for g in groups.values()
        if len(g["leg_indices"]) >= 2
    ]
    return (len(correlated_groups) > 0), correlated_groups


def parlay_ev(legs: List[dict], offered_american: int, stake: float = 1.0) -> dict:
    """Independence-fair value, compounded hold, and EV for an offered parlay.

    ``legs`` is a list of dicts (see ``_resolve_leg`` for the per-leg fields).
    ``offered_american`` is the actual combined American price the book offers.

    Returns the full response shape documented in the route. Raises ``ValueError``
    (caller -> 422) on: <2 legs, offered_american == 0, any leg american == 0,
    a leg whose prob cannot be resolved to (0,1), or stake <= 0.
    """
    if not legs or len(legs) < 2:
        raise ValueError("a parlay needs at least 2 legs")
    if offered_american == 0:
        raise ValueError("offered_american must be non-zero (0 is the missing-price sentinel)")
    if stake <= 0.0:
        raise ValueError("stake must be > 0")

    resolved = [_resolve_leg(leg) for leg in legs]

    # ── Independence product of vig-free (or flagged vig-loaded) leg probs ──
    fair_parlay_prob = 1.0
    for r in resolved:
        fair_parlay_prob *= r["_prob"]
    if fair_parlay_prob <= 0.0 or fair_parlay_prob >= 1.0:
        raise ValueError("degenerate fair parlay probability; check leg inputs")

    fair_parlay_decimal = 1.0 / fair_parlay_prob
    fair_parlay_american = american_from_decimal(fair_parlay_decimal)

    # ── Offered price ──
    offered_decimal = decimal_odds(offered_american)
    if offered_decimal <= 1.0:
        raise ValueError("offered decimal must be > 1")
    offered_implied_parlay_prob = 1.0 / offered_decimal

    # ── Reveal #1: STRUCTURAL book compounded hold = Π(booksum_i) - 1 ──
    # Pure leg-pricing-only; defined ONLY where every leg has a two-sided booksum.
    # Does NOT depend on the offered price and does NOT collapse into EV.
    booksums = [r["_booksum"] for r in resolved if r["_booksum"] is not None]
    leg_holds = [r["leg_hold_pct"] for r in resolved if r["leg_hold_pct"] is not None]
    if len(booksums) == len(resolved) and booksums:
        prod = 1.0
        for bs in booksums:
            prod *= bs
        book_compounded_hold_pct: Optional[float] = round((prod - 1.0) * 100.0, 2)
    else:
        # at least one leg has no two-sided price -> structural hold undefined,
        # not fabricated.
        book_compounded_hold_pct = None
    single_leg_hold_avg_pct = round(sum(leg_holds) / len(leg_holds), 2) if leg_holds else None

    # ── Offered-vs-fair parlay overround (the "actual" parlay hold) ──
    # parlay_hold = offered_implied / fair_prob - 1 = fair_dec/offered_dec - 1.
    # NOTE: for a parlay priced off these same legs this equals -EV_per_unit; we
    # surface it as the offered-vs-fair overround, not as a second finding.
    parlay_hold_pct_raw = (offered_implied_parlay_prob / fair_parlay_prob - 1.0) * 100.0
    parlay_hold_pct = round(max(0.0, parlay_hold_pct_raw), 2)

    # ── Reveal #2: EV of the offered parlay vs the independence-fair prob ──
    p = fair_parlay_prob
    b = offered_decimal - 1.0
    ev_per_unit = p * b - (1.0 - p)
    ev_pct = ev_per_unit * 100.0
    ev_units = ev_per_unit * stake
    breakeven_prob = offered_implied_parlay_prob
    edge_vs_breakeven = fair_parlay_prob - breakeven_prob

    verdict = _verdict(ev_pct)

    # ── Honesty caveats ──
    any_vig_loaded = any(r["vig_loaded"] for r in resolved)
    correlated, correlated_groups = _detect_correlation(resolved)

    caveats: List[str] = []
    if any_vig_loaded:
        caveats.append(
            "EV optimistic — one or more legs use vig-loaded implied probs, true "
            "fair parlay prob is lower so real EV is worse."
        )
    if correlated:
        caveats.append(
            "Independence EV is unreliable — same-game legs are positively "
            "correlated; the true joint prob differs from the product, so this "
            "number is an independence estimate only."
        )
    verdict_caveat = " ".join(caveats) if caveats else None
    # Correlation/vig caveats annotate but NEVER upgrade a -EV verdict.

    # Strip private fields from the per-leg breakdown.
    legs_out = [
        {
            "label": r["label"],
            "american": r["american"],
            "opposite_american": r["opposite_american"],
            "game_tag": r["game_tag"],
            "fair_prob": r["fair_prob"],
            "prob_source": r["prob_source"],
            "vig_loaded": r["vig_loaded"],
            "leg_hold_pct": r["leg_hold_pct"],
            "fair_american": r["fair_american"],
        }
        for r in resolved
    ]

    return {
        "n_legs": len(resolved),
        "legs": legs_out,
        "fair_parlay_prob": round(fair_parlay_prob, 4),
        "fair_parlay_decimal": round(fair_parlay_decimal, 4),
        "fair_parlay_american": fair_parlay_american,
        "offered_american": int(offered_american),
        "offered_decimal": round(offered_decimal, 4),
        "offered_implied_parlay_prob": round(offered_implied_parlay_prob, 4),
        "parlay_hold_pct": parlay_hold_pct,
        "parlay_hold_pct_raw": round(parlay_hold_pct_raw, 2),
        "book_compounded_hold_pct": book_compounded_hold_pct,
        "single_leg_hold_avg_pct": single_leg_hold_avg_pct,
        "ev_units": round(ev_units, 4),
        "ev_pct": round(ev_pct, 2),
        "stake": round(stake, 4),
        "breakeven_prob": round(breakeven_prob, 4),
        "edge_vs_breakeven": round(edge_vs_breakeven, 4),
        "verdict": verdict,
        "verdict_caveat": verdict_caveat,
        "fair_basis": "independence",
        "any_vig_loaded": any_vig_loaded,
        "correlated": correlated,
        "correlated_groups": correlated_groups,
        "correlation_warning": _correlation_warning(correlated_groups) if correlated else None,
    }
