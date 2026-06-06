"""Bankroll / Risk sizing layer — Kelly stake, drawdown risk, edge sensitivity.

This module is the user-facing "how much should I stake, and what is the honest
risk" calculator. Like ``fair_value.boost_ev`` / ``parlay.parlay_ev`` it is a
pure, stateless function (no DB) that the ``/tools/bankroll`` endpoint wraps.

Design rules (from the adversarial review):

  C1  The probability fed to Kelly is the model's VIG-FREE fair win prob — the
      caller supplies it directly (seedable from ``p_shrunk``). We never derive
      it from the price's vig-loaded implied prob, which by construction would
      collapse ``b·p − q`` to the negative vig and always say "no bet".

  C2  Risk-of-drawdown honesty. The headline risk number is a drawdown-to-α
      probability, NOT "ruin to $0" (which is undefined for fractional Kelly).
      It is an explicitly-labeled continuous-diffusion APPROXIMATION
      ``P(ever touch α) ≈ α^(2/c − 1)`` for fractional-Kelly multiplier
      ``c = kelly_multiplier ∈ (0,1]``. We NEVER display 0 / "no risk": the
      value is floored at a small epsilon, and at full Kelly we say the
      continuous bound understates discrete-play risk.

  C3  Edge sensitivity RE-DERIVES f* and g at each degraded p (re-clamping
      independently), keeping the ORIGINAL price. This isolates the cost of
      having sized off an optimistic estimate.

  C4  Input validation mirrors ``fair_value``/``boost_ev``: odds != 0, p strictly
      in (0,1), multiplier in (0,1], bankroll > 0, floors in (0,1). ValueError
      → 422 at the route layer.

Everything reuses the audited primitives in ``app.betting.quant`` and
``app.betting.implied_probability`` — no Kelly/odds math is reinvented here.
"""
from __future__ import annotations

import math
from typing import List, Optional

from app.betting.implied_probability import decimal_odds, expected_value
from app.betting.quant import (
    doubling_time_bets,
    expected_log_growth,
    full_kelly,
)

# Displayed drawdown probability is floored here — discrete, indivisible play is
# never truly 0% risk, and the continuous approximation can underflow to 0 for
# very small fractional multipliers. We label the floored value "approx, >0".
_DRAWDOWN_EPS = 1e-4

# The honesty caveats, surfaced verbatim in the UI (HARD RULES).
CAVEATS: List[str] = [
    "Edge is ESTIMATED, not known. Every number here is illustrative given the "
    "win probability you entered. The model already shrinks edges "
    "(p_edge_positive / evidence_quality) precisely because real edge is uncertain.",
    "Risk-of-drawdown and growth are HIGHLY sensitive to that edge — see the "
    "sensitivity rows. A single number is not a guarantee.",
    "Drawdown probabilities are a continuous-diffusion APPROXIMATION assuming a "
    "fixed edge and i.i.d. bets at this exact stake; real, discrete betting "
    "always carries risk — we never display 0%, and discrete play is strictly "
    "worse than this continuous bound (true ruin at full Kelly is NOT ~0).",
    "This sizes ONE repeated bet. Real bankrolls run many correlated bets at "
    "once; treat full-Kelly as a ceiling and bet a fraction.",
    "Verification, not a pick. Never bet more than you can afford to lose.",
]


# ── Core helpers (pure, reuse quant primitives) ───────────────────────────────
def kelly_fraction(p: float, american_odds: int) -> float:
    """Full-Kelly fraction f* = (b·p − q)/b. Reuses ``quant.full_kelly``.

    Returns 0.0 when b ≤ 0 (degenerate price) or f* ≤ 0 (the bet is −EV); the
    caller treats 0.0 as the "no bet / −EV" clamp.
    """
    f = full_kelly(p, american_odds)
    return f if f > 0 else 0.0


def log_growth_rate(p: float, american_odds: int, fraction: float) -> float:
    """Expected per-bet log-growth g at ``fraction``. Reuses ``quant.expected_log_growth``."""
    return expected_log_growth(p, american_odds, fraction)


def risk_of_drawdown(kelly_multiplier: float, drawdown_frac: float) -> float:
    """P(bankroll ever falls to fraction ``drawdown_frac`` of its current value).

    Browne/Thorp continuous-time fractional-Kelly drawdown bound for a +EV bet:

        P(ever touch α) ≈ α^(2/c − 1)

    where α = drawdown_frac ∈ (0,1) and c = kelly_multiplier ∈ (0,1] is the
    fraction of full Kelly being staked. Verified: half-Kelly to 50% = 0.125,
    quarter-Kelly to 50% = 0.0078.

    This is an explicitly-labeled APPROXIMATION valid only for c ∈ (0,1] on a
    +EV bet. At c = 1 (full Kelly) it returns α exactly (50% → 50%) — the
    continuous-rebalancing idealization; real discrete play is STRICTLY worse,
    so the caller never presents this as the true full-Kelly risk and never
    shows 0. The returned value is floored at ``_DRAWDOWN_EPS`` (never 0) and
    capped at 1.0.

    Assumptions (stated in the UI): fixed/known edge, i.i.d. bets at this exact
    fraction, continuous-diffusion approximation of a discrete process.
    """
    if not (0.0 < drawdown_frac < 1.0):
        raise ValueError("drawdown_frac must be strictly between 0 and 1")
    if not (0.0 < kelly_multiplier <= 1.0):
        raise ValueError("kelly_multiplier must be in (0, 1]")
    exponent = (2.0 / kelly_multiplier) - 1.0
    prob = drawdown_frac ** exponent
    # Floor (discrete play is never 0%) and cap.
    return max(_DRAWDOWN_EPS, min(1.0, prob))


def _drawdown_rows(kelly_multiplier: float, floors: List[float], positive_growth: bool) -> List[dict]:
    """Drawdown probability rows for each floor α.

    When growth is non-positive (over-bet past full Kelly, or −EV true edge),
    large drawdown is effectively certain — report prob → 1.0, never a
    comfortable number.
    """
    rows: List[dict] = []
    for alpha in floors:
        if not positive_growth:
            prob = 1.0
        else:
            prob = risk_of_drawdown(kelly_multiplier, alpha)
        rows.append({"floor": round(alpha, 4), "prob": round(prob, 4)})
    return rows


# ── Verdict (verification language only) ──────────────────────────────────────
def _verdict(f_full: float, growth_used: float) -> str:
    """Tier on f_full + chosen-fraction growth. Verification language only.

    A LARGE full-Kelly fraction is a FLAG that the edge estimate may be too
    optimistic, not a green light.
    """
    if f_full <= 0:
        return "no bet / -EV"
    if growth_used > 0 and f_full <= 0.10:
        return "+EV (small edge)"
    if f_full <= 0.25:
        return "+EV (moderate)"
    return "+EV (large — full-Kelly stake is high; fractional strongly advised)"


# ── Edge sensitivity (C3: re-derive + re-clamp at each degraded p) ────────────
def edge_sensitivity(
    fair_prob: float,
    american_odds: int,
    f_used: float,
    deltas: List[float],
    floors: List[float],
) -> List[dict]:
    """Recompute the pipeline at degraded true edges, keeping the SAME stake.

    For each delta the true win prob is ``p − delta`` (clamped to >epsilon). The
    stake stays at ``f_used`` (the fraction derived from the ORIGINAL p — you
    already placed that bet), but mu/sigma/g and the drawdown probs are
    recomputed at the lower true p. This isolates the cost of having sized off
    an optimistic estimate.

    ``exceeds_full_kelly`` flags the core lesson: when the fixed stake now
    exceeds FULL Kelly for the degraded p, growth flips negative — a stake that
    was half-Kelly at the estimated edge can over-bet the true edge.
    """
    rows: List[dict] = []
    for delta in deltas:
        true_p = fair_prob - delta
        if true_p <= 0.0:
            true_p = 1e-6  # clamp to avoid ln() singularity; row will read -EV
        true_p = min(true_p, 1.0 - 1e-9)

        f_full_true = full_kelly(true_p, american_odds)
        # Growth of the FIXED original stake under the degraded true p.
        g_true = expected_log_growth(true_p, american_odds, f_used)
        ev_true = expected_value(true_p, american_odds)
        exceeds = f_used > f_full_true  # original stake over-bets the true edge

        positive_growth = g_true > 0
        # The drawdown bound is on the chosen fractional strategy; when the true
        # edge no longer supports positive growth at this stake, drawdown → 1.
        rows.append(
            {
                "delta": round(delta, 4),
                "true_prob": round(true_p, 4),
                "full_kelly_at_true_p": round(max(0.0, f_full_true), 4),
                "ev_per_dollar": round(ev_true, 4),
                "growth_rate": round(g_true, 6),
                "exceeds_full_kelly": bool(exceeds),
                "drawdown": _drawdown_rows(
                    # multiplier of full Kelly THIS stake represents at the true p;
                    # only meaningful (and only used) when growth is positive.
                    _safe_multiplier(f_used, f_full_true),
                    floors,
                    positive_growth,
                ),
            }
        )
    return rows


def _safe_multiplier(f_used: float, f_full: float) -> float:
    """Multiplier of full Kelly that ``f_used`` represents at some p, in (0,1].

    Only used to parameterise the drawdown bound for sensitivity rows that still
    have positive growth (so f_full > 0 and f_used <= f_full there). Clamped into
    (0,1] defensively so the bound never blows up.
    """
    if f_full <= 0:
        return 1.0  # caller passes positive_growth=False here, so value is unused
    return min(1.0, max(_DRAWDOWN_EPS, f_used / f_full))


# ── Recommended stake ─────────────────────────────────────────────────────────
def recommended_stake(
    bankroll: float,
    fair_prob: float,
    american_odds: int,
    kelly_multiplier: float,
    unit_size: float,
) -> dict:
    """Full/used Kelly fractions and the staked currency + units at ``kelly_multiplier``.

    Clamps the used fraction below 1.0 (a stake ≥ bankroll is not Kelly-valid and
    blows up ln(1−f)).
    """
    f_full = kelly_fraction(fair_prob, american_odds)
    f_used = kelly_multiplier * f_full
    f_used = min(f_used, 1.0 - 1e-9)  # guard ln(1-f) blowup
    stake_currency = round(bankroll * f_used, 2)
    stake_units = round(stake_currency / unit_size, 4) if unit_size > 0 else 0.0
    return {
        "kelly_full": round(f_full, 4),
        "kelly_used_fraction": round(f_used, 4),
        "stake_currency": stake_currency,
        "stake_units": stake_units,
    }


def _multiplier_table(
    bankroll: float,
    fair_prob: float,
    american_odds: int,
    f_full: float,
    unit_size: float,
) -> List[dict]:
    """Quarter / half / full Kelly side-by-side: stake, growth, doubling time.

    Lets the user see full Kelly maximizes g but at the worst drawdown, and that
    fractional Kelly trades a little g for much less variance.
    """
    rows: List[dict] = []
    for label, m in (("quarter", 0.25), ("half", 0.5), ("full", 1.0)):
        f = min(m * f_full, 1.0 - 1e-9)
        g = expected_log_growth(fair_prob, american_odds, f) if f > 0 else 0.0
        stake_currency = round(bankroll * f, 2)
        rows.append(
            {
                "label": label,
                "multiplier": m,
                "fraction": round(f, 4),
                "stake_currency": stake_currency,
                "stake_units": round(stake_currency / unit_size, 4) if unit_size > 0 else 0.0,
                "growth_rate": round(g, 6),
                "doubling_bets": doubling_time_bets(g),
            }
        )
    return rows


# ── Top-level entry point ─────────────────────────────────────────────────────
def bankroll_risk(
    bankroll: float,
    american_odds: int,
    fair_prob: float,
    kelly_multiplier: float = 0.5,
    unit_size: Optional[float] = None,
    drawdown_floors: Optional[List[float]] = None,
    edge_sensitivity_deltas: Optional[List[float]] = None,
) -> dict:
    """Optimal-Kelly stake + honest drawdown risk + edge sensitivity.

    Pure, stateless. Reuses ``quant.full_kelly`` / ``expected_log_growth`` /
    ``doubling_time_bets`` and ``implied_probability.decimal_odds`` /
    ``expected_value`` — no Kelly or odds math is reinvented.

    Raises ``ValueError`` (→ 422) on invalid inputs:
      * bankroll <= 0
      * american_odds == 0 (missing-price sentinel)
      * fair_prob not strictly in (0, 1)
      * kelly_multiplier not in (0, 1]
      * unit_size <= 0
      * any drawdown floor not strictly in (0, 1)
      * any edge_sensitivity_delta < 0
    """
    # ── C4 validation ─────────────────────────────────────────────────────────
    if bankroll <= 0.0:
        raise ValueError("bankroll must be > 0")
    if american_odds == 0:
        raise ValueError("american_odds must be non-zero (0 is the missing-price sentinel)")
    if fair_prob <= 0.0 or fair_prob >= 1.0:
        raise ValueError("fair_prob must be strictly between 0 and 1")
    if not (0.0 < kelly_multiplier <= 1.0):
        raise ValueError("kelly_multiplier must be in (0, 1]")

    if unit_size is None:
        unit_size = bankroll * 0.01
    if unit_size <= 0.0:
        raise ValueError("unit_size must be > 0")

    if drawdown_floors is None:
        drawdown_floors = [0.5, 0.25, 0.10]
    for alpha in drawdown_floors:
        if not (0.0 < alpha < 1.0):
            raise ValueError("each drawdown floor must be strictly between 0 and 1")

    if edge_sensitivity_deltas is None:
        edge_sensitivity_deltas = [0.0, 0.02, 0.04]
    for d in edge_sensitivity_deltas:
        if d < 0.0:
            raise ValueError("edge_sensitivity deltas must be >= 0")

    # ── Kelly + stake ─────────────────────────────────────────────────────────
    d_odds = decimal_odds(american_odds)
    f_full = kelly_fraction(fair_prob, american_odds)
    no_bet = f_full <= 0.0

    f_used = 0.0 if no_bet else min(kelly_multiplier * f_full, 1.0 - 1e-9)
    stake_currency = round(bankroll * f_used, 2)
    stake_units = round(stake_currency / unit_size, 4)

    ev_per_dollar = expected_value(fair_prob, american_odds)
    ev_on_stake = round(ev_per_dollar * stake_currency, 2)

    g_used = expected_log_growth(fair_prob, american_odds, f_used) if f_used > 0 else 0.0
    positive_growth = g_used > 0
    doubling = doubling_time_bets(g_used)

    verdict = _verdict(f_full, g_used)

    # ── Multiplier comparison + drawdown + sensitivity ────────────────────────
    if no_bet:
        multiplier_table: List[dict] = []
        drawdown: List[dict] = []
        sensitivity: List[dict] = []
    else:
        multiplier_table = _multiplier_table(bankroll, fair_prob, american_odds, f_full, unit_size)
        drawdown = _drawdown_rows(kelly_multiplier, drawdown_floors, positive_growth)
        sensitivity = edge_sensitivity(
            fair_prob, american_odds, f_used, edge_sensitivity_deltas, drawdown_floors
        )

    return {
        "bankroll": round(bankroll, 2),
        "american_odds": int(american_odds),
        "decimal_odds": round(d_odds, 4),
        "fair_prob": round(fair_prob, 4),
        "kelly_multiplier": kelly_multiplier,
        "unit_size": round(unit_size, 2),
        "kelly_full": round(f_full, 4),
        "kelly_used_fraction": round(f_used, 4),
        "stake_currency": stake_currency,
        "stake_units": stake_units,
        "ev_per_dollar": round(ev_per_dollar, 4),
        "ev_on_stake": ev_on_stake,
        "growth_rate": round(g_used, 6),
        "doubling_bets": doubling,
        "no_bet": no_bet,
        "verdict": verdict,
        "multiplier_table": multiplier_table,
        "drawdown": drawdown,
        "edge_sensitivity": sensitivity,
        "caveats": list(CAVEATS),
    }
