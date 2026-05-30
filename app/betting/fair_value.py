"""Beat-the-Book pricing layer — no-vig fair value, book hold, and profit-boost EV.

This module is the single source of truth for the user-facing "fair value vs book"
and "is this DraftKings profit boost +EV?" calculations. It is built entirely on the
existing, audited primitives:

  * ``app.betting.quant.shin_probabilities`` — the canonical Shin (1993) two-sided
    devig (with the z→0 proportional fallback). We do NOT reinvent devig.
  * ``app.betting.implied_probability`` — American→implied / →decimal helpers.

Design rules enforced here (from the adversarial review):

  C2  ``american_odds == 0`` is the missing-price sentinel — any side equal to 0 (or
      None) is treated as ABSENT and short-circuits to "no fair value / no hold".
  C3  Devig requires BOTH sides. A one-sided market yields ``None`` (no fair line,
      no hold) — we never mirror/fabricate the missing side for a user-facing number.
  C4  Hold (overround) comes from the RAW booksum (sum of vig-loaded implied probs),
      i.e. ``booksum - 1``. The Shin-returned probabilities are renormalized to sum
      to 1 and must NOT be used to derive hold. Displayed hold is clamped ≥ 0; the
      raw booksum is preserved for honesty.
  C5  Profit boost multiplies NET PROFIT only, never the returned stake.

Single-book reality: in prod, odds_snapshots are effectively DraftKings-only, so the
"fair" value here is the no-vig of ONE book's two-sided price — a no-vig line, not a
cross-book market consensus. Callers should label it "fair (no-vig)" accordingly.
"""
from __future__ import annotations

from typing import Optional

from app.betting.implied_probability import decimal_odds, implied_probability
from app.betting.quant import shin_probabilities


# ── American ⇄ probability/decimal helpers ────────────────────────────────────
def fair_american_from_prob(p: float) -> Optional[int]:
    """No-vig fair American odds implied by a (true) win probability ``p``.

    decimal d = 1/p. Underdog (p ≤ 0.5, d ≥ 2) → positive American = round((d-1)*100).
    Favorite (p > 0.5) → negative American = round(-100/(d-1)).

    Returns ``None`` when ``p`` is not strictly inside (0, 1) — a degenerate prob has
    no finite fair line, so we honestly emit nothing rather than ±inf.
    """
    if p is None or p <= 0.0 or p >= 1.0:
        return None
    d = 1.0 / p
    if d >= 2.0:  # underdog (p ≤ 0.5)
        return int(round((d - 1.0) * 100.0))
    # favorite (p > 0.5)
    return int(round(-100.0 / (d - 1.0)))


def american_from_decimal(d: float) -> Optional[int]:
    """American odds equivalent to a decimal price ``d`` (d > 1).

    Used to express what a *boosted* price is equivalent to. d ≥ 2 → positive,
    1 < d < 2 → negative. Returns ``None`` for d ≤ 1 (no profit → no valid line).
    """
    if d is None or d <= 1.0:
        return None
    if d >= 2.0:
        return int(round((d - 1.0) * 100.0))
    return int(round(-100.0 / (d - 1.0)))


def _valid_side(odds: Optional[int]) -> bool:
    """A side has a real, devig-able price iff it is present and non-zero.

    ``american_odds == 0`` is the codebase's missing-price sentinel and would poison
    the booksum (implied_probability(0) = 1.0), so it is treated as absent.
    """
    return odds is not None and odds != 0


# ── Feature 1: fair value + hold ──────────────────────────────────────────────
def fair_value(odds_a: Optional[int], odds_b: Optional[int]) -> Optional[dict]:
    """No-vig fair value + book hold for a two-sided market priced at ONE book.

    ``odds_a`` / ``odds_b`` are the two American prices for the two outcomes
    (e.g. (away, home) for a moneyline or (over, under) for a total). Order in =
    order out: ``prob_a``/``fair_a`` correspond to ``odds_a``.

    Returns ``None`` when either side is missing/zero (C2/C3) — no fair value and no
    hold can be defined from one side, and we never fabricate the missing leg.

    On success returns::

        {
          "prob_a":  float,   # no-vig fair prob for side A (sums to 1 with prob_b)
          "prob_b":  float,
          "fair_a":  int|None,  # no-vig fair American odds for side A
          "fair_b":  int|None,
          "hold_pct": float,    # book overround as a %, clamped ≥ 0 for display
          "booksum":  float,    # raw Σ implied (>1 normally) — kept for honesty
          "shin_z":   float,    # estimated insider proportion (0 ⇒ proportional)
        }
    """
    if not _valid_side(odds_a) or not _valid_side(odds_b):
        return None

    # Shin devig (renormalized probs that sum to 1) + the RAW booksum for hold.
    # shin_probabilities is side-symmetric; pass (A, B) and read back in order.
    prob_a, prob_b, shin_z, booksum = shin_probabilities(odds_a, odds_b)

    # C4: hold is the raw overround (booksum - 1), NOT derived from the
    # renormalized Shin probs. Clamp ≥ 0 for display (a booksum < 1 would only
    # arise from a stale/arb price); keep the raw booksum in the payload.
    hold_pct = max(0.0, (booksum - 1.0) * 100.0)

    return {
        "prob_a": round(prob_a, 4),
        "prob_b": round(prob_b, 4),
        "fair_a": fair_american_from_prob(prob_a),
        "fair_b": fair_american_from_prob(prob_b),
        "hold_pct": round(hold_pct, 1),
        "booksum": round(booksum, 4),
        "shin_z": round(shin_z, 4),
    }


# ── Feature 2: profit-boost EV ────────────────────────────────────────────────
# Verdict bands on EV% (per $1 stake). Verification language ONLY — never
# "lock"/"guaranteed"/"hammer". A neutral "marginal" band brackets near-zero EV so
# a tiny positive that sits inside model noise is not oversold.
_EV_PLUS_THRESHOLD = 2.0    # EV% ≥ +2.0  → "+EV"
_EV_MINUS_THRESHOLD = -1.0  # EV% < -1.0  → "-EV"; in between → "marginal"


def _verdict(ev_pct: float) -> str:
    if ev_pct >= _EV_PLUS_THRESHOLD:
        return "+EV"
    if ev_pct < _EV_MINUS_THRESHOLD:
        return "-EV"
    return "marginal"


def boost_ev(
    american_odds: int,
    boost_pct: float,
    fair_prob: float,
    stake: float = 1.0,
) -> dict:
    """EV of a DraftKings-style PROFIT boost at a supplied fair win probability.

    A profit boost multiplies the NET PROFIT (winnings) only — never the returned
    stake. For American odds ``O`` → decimal ``d`` (via ``decimal_odds``), base
    net-profit-per-$1 ``b = d - 1``, boost fraction ``k = boost_pct/100``, fair win
    prob ``p``::

        boosted_profit_per_unit = b * (1 + k)
        boosted_decimal         = 1 + b * (1 + k)
        boosted_payout_per_unit = 1 + boosted_profit_per_unit   (stake returned + boosted profit)
        EV_per_unit             = p * boosted_profit - (1 - p)
        EV_pct                  = EV_per_unit * 100
        breakeven_prob          = 1 / boosted_decimal

    The boost lowers the break-even bar; any fair ``p`` > breakeven is +EV.

    Raises ``ValueError`` on invalid inputs (caller maps to HTTP 422):
      * ``american_odds == 0`` (missing-price sentinel),
      * ``fair_prob`` not strictly in (0, 1),
      * ``boost_pct < 0``,
      * ``stake <= 0``.
    """
    if american_odds == 0:
        raise ValueError("american_odds must be non-zero (0 is the missing-price sentinel)")
    if fair_prob <= 0.0 or fair_prob >= 1.0:
        raise ValueError("fair_prob must be strictly between 0 and 1")
    if boost_pct < 0.0:
        raise ValueError("boost_pct must be >= 0")
    if stake <= 0.0:
        raise ValueError("stake must be > 0")

    p = fair_prob
    k = boost_pct / 100.0
    d = decimal_odds(american_odds)
    b = d - 1.0  # base net profit per unit staked

    boosted_profit_per_unit = b * (1.0 + k)
    boosted_decimal = 1.0 + boosted_profit_per_unit
    boosted_payout_per_unit = 1.0 + boosted_profit_per_unit  # stake returned + boosted profit

    ev_per_unit = p * boosted_profit_per_unit - (1.0 - p)
    ev_pct = ev_per_unit * 100.0
    ev_units = ev_per_unit * stake  # absolute EV for the supplied stake

    breakeven_prob = 1.0 / boosted_decimal

    return {
        "odds": int(american_odds),
        "boost_pct": round(boost_pct, 4),
        "fair_prob": round(p, 4),
        "stake": round(stake, 4),
        "decimal": round(d, 4),
        "boosted_decimal": round(boosted_decimal, 4),
        "boosted_american": american_from_decimal(boosted_decimal),
        "boosted_payout_per_unit": round(boosted_payout_per_unit, 4),
        "boosted_profit_per_unit": round(boosted_profit_per_unit, 4),
        "ev_units": round(ev_units, 4),
        "ev_pct": round(ev_pct, 2),
        "breakeven_prob": round(breakeven_prob, 4),
        "edge_vs_breakeven": round(p - breakeven_prob, 4),
        "verdict": _verdict(ev_pct),
    }
