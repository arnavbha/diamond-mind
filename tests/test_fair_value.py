"""Tests for the Beat-the-Book pricing layer (app.betting.fair_value).

Covers the reviewer's worked numeric examples, the devig fair line + hold%, the
one-sided / zero-odds honest-empty-state guards, and the profit-boost EV
sign/break-even/verdict math.
"""
import math

import pytest

from app.betting.fair_value import (
    american_from_decimal,
    boost_ev,
    fair_american_from_prob,
    fair_value,
)


# ── fair_american_from_prob: sign convention + rounding ───────────────────────
def test_fair_american_favorite_negative():
    # p = 0.60 → decimal 1.667 → american -150
    assert fair_american_from_prob(0.60) == -150


def test_fair_american_underdog_positive():
    # p = 0.40 → decimal 2.50 → american +150
    assert fair_american_from_prob(0.40) == 150


def test_fair_american_even_money():
    # p = 0.50 → decimal 2.0 → +100 (boundary lands on the underdog branch)
    assert fair_american_from_prob(0.50) == 100


def test_fair_american_degenerate_returns_none():
    assert fair_american_from_prob(0.0) is None
    assert fair_american_from_prob(1.0) is None
    assert fair_american_from_prob(-0.1) is None
    assert fair_american_from_prob(1.5) is None


def test_american_from_decimal():
    assert american_from_decimal(2.56) == 156
    assert american_from_decimal(1.9091) == -110
    assert american_from_decimal(1.0) is None
    assert american_from_decimal(0.5) is None


# ── fair_value: devig fair line + hold% (reviewer Example 4) ──────────────────
def test_fair_value_hold_and_lines_home_minus150_away_plus130():
    # DK home -150 / away +130. fair_value(odds_a=away, odds_b=home).
    fv = fair_value(130, -150)
    assert fv is not None
    # raw: r_home = 0.60, r_away = 0.43478 -> booksum 1.03478 -> hold 3.5%
    assert fv["booksum"] == pytest.approx(1.0348, abs=1e-3)
    assert fv["hold_pct"] == pytest.approx(3.5, abs=0.1)
    # probs sum to 1
    assert fv["prob_a"] + fv["prob_b"] == pytest.approx(1.0, abs=1e-6)
    # home (B) is the favorite -> negative fair line; away (A) underdog -> positive
    assert fv["fair_b"] < 0
    assert fv["fair_a"] > 0
    # ~ -138 / +138 from the proportional fair probs
    assert fv["fair_b"] == pytest.approx(-138, abs=2)
    assert fv["fair_a"] == pytest.approx(138, abs=2)


def test_fair_value_hold_nonnegative_and_booksum_gt_one():
    fv = fair_value(-110, -110)
    assert fv["hold_pct"] >= 0.0
    assert fv["booksum"] > 1.0
    # symmetric market -> ~50/50
    assert fv["prob_a"] == pytest.approx(0.5, abs=1e-6)


def test_fair_value_shin_matches_proportional_when_z_near_zero():
    # A near-fair book (tiny vig) should land on the proportional fallback,
    # so prob == raw/booksum within tight tolerance.
    # A perfectly balanced near-fair pair -> z hits the proportional fallback.
    fv = fair_value(100, -100)
    from app.betting.implied_probability import implied_probability
    r_a = implied_probability(100)
    r_b = implied_probability(-100)
    booksum = r_a + r_b
    assert fv["shin_z"] == pytest.approx(0.0, abs=1e-6)
    assert fv["prob_a"] == pytest.approx(r_a / booksum, abs=1e-6)
    assert fv["prob_b"] == pytest.approx(r_b / booksum, abs=1e-6)


# ── fair_value guards: one-sided / zero-odds -> None (no fabricated line) ──────
def test_fair_value_one_sided_returns_none():
    assert fair_value(None, -150) is None
    assert fair_value(130, None) is None
    assert fair_value(None, None) is None


def test_fair_value_zero_odds_sentinel_returns_none():
    # american_odds == 0 is the missing-price sentinel; must not poison booksum.
    assert fair_value(0, -150) is None
    assert fair_value(130, 0) is None
    assert fair_value(0, 0) is None


# ── boost_ev: reviewer worked examples ────────────────────────────────────────
def test_boost_ev_example1_plus120_30pct_p050():
    r = boost_ev(120, 30.0, 0.50)
    assert r["boosted_decimal"] == pytest.approx(2.56, abs=1e-3)
    assert r["ev_pct"] == pytest.approx(28.0, abs=0.05)
    assert r["breakeven_prob"] == pytest.approx(0.3906, abs=1e-3)
    assert r["boosted_american"] == 156
    assert r["verdict"] == "+EV"


def test_boost_ev_example2_minus110_50pct_p050():
    r = boost_ev(-110, 50.0, 0.50)
    assert r["boosted_decimal"] == pytest.approx(2.3636, abs=1e-3)
    assert r["ev_pct"] == pytest.approx(18.18, abs=0.05)
    assert r["breakeven_prob"] == pytest.approx(0.4231, abs=1e-3)
    assert r["verdict"] == "+EV"


def test_boost_ev_example3_plus120_30pct_p035_is_negative():
    r = boost_ev(120, 30.0, 0.35)
    assert r["ev_pct"] == pytest.approx(-10.4, abs=0.05)
    assert r["breakeven_prob"] == pytest.approx(0.3906, abs=1e-3)
    assert r["edge_vs_breakeven"] < 0
    assert r["verdict"] == "-EV"


# ── boost_ev: break-even reduces to 1/decimal when boost = 0 ──────────────────
def test_boost_ev_zero_boost_reduces_to_plain_breakeven():
    r = boost_ev(-110, 0.0, 0.55)
    assert r["boosted_decimal"] == pytest.approx(r["decimal"], abs=1e-9)
    # With boost=0, break-even reduces to 1/decimal (both reported to 4 dp).
    assert r["breakeven_prob"] == pytest.approx(1.0 / r["decimal"], abs=1e-4)


def test_boost_ev_at_breakeven_is_marginal():
    # Seed fair_prob exactly at the (unboosted) break-even -> EV ~ 0 -> marginal.
    d = 1.0 + 100.0 / 110.0  # decimal for -110
    p_be = 1.0 / d
    r = boost_ev(-110, 0.0, p_be)
    assert abs(r["ev_pct"]) < 1.0
    assert r["verdict"] == "marginal"


def test_boost_ev_stake_scales_ev_units():
    r1 = boost_ev(120, 30.0, 0.50, stake=1.0)
    r10 = boost_ev(120, 30.0, 0.50, stake=10.0)
    assert r10["ev_units"] == pytest.approx(r1["ev_units"] * 10.0, abs=1e-6)
    # ev_pct is per-unit and stake-invariant
    assert r10["ev_pct"] == pytest.approx(r1["ev_pct"], abs=1e-9)


# ── boost_ev: input validation ────────────────────────────────────────────────
def test_boost_ev_rejects_zero_odds():
    with pytest.raises(ValueError):
        boost_ev(0, 50.0, 0.5)


def test_boost_ev_rejects_prob_out_of_range():
    with pytest.raises(ValueError):
        boost_ev(120, 50.0, 0.0)
    with pytest.raises(ValueError):
        boost_ev(120, 50.0, 1.0)
    with pytest.raises(ValueError):
        boost_ev(120, 50.0, -0.1)


def test_boost_ev_rejects_negative_boost():
    with pytest.raises(ValueError):
        boost_ev(120, -5.0, 0.5)


def test_boost_ev_rejects_nonpositive_stake():
    with pytest.raises(ValueError):
        boost_ev(120, 50.0, 0.5, stake=0.0)
