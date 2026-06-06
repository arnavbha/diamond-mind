"""Tests for app.betting.bankroll — Kelly stake, drawdown risk, edge sensitivity.

Worked examples are from the adversarial review (all verified numerically):

  A  favorite, -110, p=0.55 -> f*=0.0550, half-Kelly on $1000 = $27.50,
     g(full)=0.001378, g(half)=0.001033, EV/$1=0.05,
     half-Kelly drawdown to 50% = 0.125, quarter-Kelly to 50% = 0.0078.
  B  clamp, -110, p=0.50 -> f*=-0.05 -> clamp -> "no bet / -EV".
  C  underdog, +150, p=0.45 -> f*=0.0833, quarter-Kelly on $1000 = $20.83,
     g(quarter)=0.002268.
"""
import math

import pytest

from app.betting.bankroll import (
    bankroll_risk,
    kelly_fraction,
    log_growth_rate,
    risk_of_drawdown,
)
from app.betting.quant import expected_log_growth, full_kelly


# ── Reuse parity: our wrappers must equal the audited quant primitives ────────
def test_kelly_fraction_parity_with_full_kelly():
    assert kelly_fraction(0.55, -110) == pytest.approx(full_kelly(0.55, -110))
    assert kelly_fraction(0.45, 150) == pytest.approx(full_kelly(0.45, 150))


def test_kelly_fraction_clamps_negative_to_zero():
    # full_kelly(0.50, -110) = -0.05 -> our wrapper clamps to 0.0
    assert full_kelly(0.50, -110) < 0
    assert kelly_fraction(0.50, -110) == 0.0


def test_log_growth_rate_parity():
    f = full_kelly(0.55, -110)
    assert log_growth_rate(0.55, -110, f) == pytest.approx(expected_log_growth(0.55, -110, f))


# ── Example A: favorite -110, p=0.55 ──────────────────────────────────────────
def test_example_a_full_kelly_fraction():
    assert kelly_fraction(0.55, -110) == pytest.approx(0.0550, abs=1e-4)


def test_example_a_half_kelly_stake():
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.55, kelly_multiplier=0.5)
    assert res["kelly_full"] == pytest.approx(0.0550, abs=1e-4)
    assert res["kelly_used_fraction"] == pytest.approx(0.0275, abs=1e-4)
    assert res["stake_currency"] == pytest.approx(27.50, abs=0.01)
    assert res["ev_per_dollar"] == pytest.approx(0.05, abs=1e-4)
    assert res["no_bet"] is False


def test_example_a_growth_rates_full_and_half():
    f_full = full_kelly(0.55, -110)
    assert expected_log_growth(0.55, -110, f_full) == pytest.approx(0.001378, abs=1e-6)
    assert expected_log_growth(0.55, -110, 0.5 * f_full) == pytest.approx(0.001033, abs=1e-6)


def test_example_a_drawdown_values():
    # half-Kelly to 50% = 0.125 ; quarter-Kelly to 50% = 0.0078
    assert risk_of_drawdown(0.5, 0.5) == pytest.approx(0.125, abs=1e-3)
    assert risk_of_drawdown(0.25, 0.5) == pytest.approx(0.0078, abs=1e-3)


def test_example_a_multiplier_table():
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.55, kelly_multiplier=0.5)
    table = {r["label"]: r for r in res["multiplier_table"]}
    assert set(table) == {"quarter", "half", "full"}
    # full-Kelly maximises growth
    assert table["full"]["growth_rate"] >= table["half"]["growth_rate"] >= table["quarter"]["growth_rate"]
    assert table["full"]["growth_rate"] == pytest.approx(0.001378, abs=1e-6)
    assert table["quarter"]["stake_currency"] == pytest.approx(13.75, abs=0.01)


# ── Example B: clamp, -110, p=0.50 -> no bet ──────────────────────────────────
def test_example_b_no_bet_clamp():
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.50, kelly_multiplier=0.5)
    assert res["no_bet"] is True
    assert res["verdict"] == "no bet / -EV"
    assert res["kelly_used_fraction"] == 0.0
    assert res["stake_currency"] == 0.0
    assert res["growth_rate"] == 0.0
    assert res["doubling_bets"] is None
    # -EV bet is never sized: no drawdown/sensitivity rows fabricated
    assert res["drawdown"] == []
    assert res["edge_sensitivity"] == []
    assert res["multiplier_table"] == []


# ── Example C: underdog +150, p=0.45 ──────────────────────────────────────────
def test_example_c_underdog():
    res = bankroll_risk(bankroll=1000.0, american_odds=150, fair_prob=0.45, kelly_multiplier=0.25)
    assert res["decimal_odds"] == pytest.approx(2.5, abs=1e-4)  # b = 1.5
    assert res["kelly_full"] == pytest.approx(0.0833, abs=1e-4)
    assert res["stake_currency"] == pytest.approx(20.83, abs=0.01)
    # g(quarter) = 0.002268
    assert res["growth_rate"] == pytest.approx(0.002268, abs=1e-6)


# ── Drawdown honesty (C2): monotone, never 0, ->1 when growth<=0 ──────────────
def test_drawdown_monotone_in_alpha():
    # Deeper drawdowns (smaller alpha) are less likely.
    p50 = risk_of_drawdown(0.5, 0.5)
    p25 = risk_of_drawdown(0.5, 0.25)
    p10 = risk_of_drawdown(0.5, 0.10)
    assert p50 > p25 > p10
    assert 0.0 < p10 and 0.0 < p25 and 0.0 < p50


def test_drawdown_never_zero_floor():
    # Very small fractional multiplier -> tiny prob, but floored above 0.
    prob = risk_of_drawdown(0.01, 0.10)
    assert prob >= 1e-4
    assert prob > 0.0


def test_full_kelly_drawdown_not_zero():
    # At full Kelly the continuous bound returns alpha exactly (NOT ~0).
    assert risk_of_drawdown(1.0, 0.5) == pytest.approx(0.5, abs=1e-9)
    assert risk_of_drawdown(1.0, 0.25) == pytest.approx(0.25, abs=1e-9)


def test_drawdown_probs_in_unit_interval():
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.55, kelly_multiplier=0.5)
    for row in res["drawdown"]:
        assert 0.0 < row["prob"] <= 1.0


def test_drawdown_approaches_one_when_no_positive_growth():
    # Over-betting past full Kelly: a sensitivity row with g<=0 must report
    # drawdown ~1, never a comfortable number. Use a degraded-edge row below.
    res = bankroll_risk(
        bankroll=1000.0,
        american_odds=-110,
        fair_prob=0.55,
        kelly_multiplier=1.0,  # full-Kelly stake at the estimated edge
        edge_sensitivity_deltas=[0.0, 0.05],  # p-0.05 = 0.50 -> -EV at true p
    )
    last = res["edge_sensitivity"][-1]
    assert last["growth_rate"] <= 0.0
    for row in last["drawdown"]:
        assert row["prob"] == pytest.approx(1.0)


# ── Edge sensitivity (C3): re-derive + re-clamp, full-stake exceeds full Kelly ─
def test_edge_sensitivity_redrives_and_flips_to_no_bet():
    res = bankroll_risk(
        bankroll=1000.0,
        american_odds=-110,
        fair_prob=0.55,
        kelly_multiplier=0.5,
        edge_sensitivity_deltas=[0.0, 0.02, 0.04, 0.05],
    )
    rows = res["edge_sensitivity"]
    # full Kelly AT THE TRUE p falls monotonically as the edge degrades.
    fulls = [r["full_kelly_at_true_p"] for r in rows]
    assert fulls == sorted(fulls, reverse=True)
    # p=0.55 -> f*~0.055, p-0.04=0.51 -> small +, p-0.05=0.50 -> clamp to 0.
    assert rows[0]["full_kelly_at_true_p"] == pytest.approx(0.0550, abs=1e-4)
    assert rows[-1]["true_prob"] == pytest.approx(0.50, abs=1e-4)
    assert rows[-1]["full_kelly_at_true_p"] == 0.0
    # The fixed half-Kelly stake now exceeds full Kelly for the degraded p,
    # and growth has flipped non-positive — the core lesson.
    assert rows[-1]["exceeds_full_kelly"] is True
    assert rows[-1]["growth_rate"] <= 0.0


def test_edge_sensitivity_growth_falls_monotonically():
    res = bankroll_risk(
        bankroll=1000.0,
        american_odds=-110,
        fair_prob=0.55,
        kelly_multiplier=0.5,
        edge_sensitivity_deltas=[0.0, 0.02, 0.04],
    )
    growths = [r["growth_rate"] for r in res["edge_sensitivity"]]
    assert growths == sorted(growths, reverse=True)


# ── Verdict bands ─────────────────────────────────────────────────────────────
def test_verdict_small_edge():
    # f* = 0.055 <= 0.10, positive growth -> "+EV (small edge)"
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.55, kelly_multiplier=0.5)
    assert res["verdict"] == "+EV (small edge)"


def test_verdict_large_flag():
    # A big edge -> large full Kelly -> flagged, not a green light.
    res = bankroll_risk(bankroll=1000.0, american_odds=100, fair_prob=0.70, kelly_multiplier=0.5)
    assert res["kelly_full"] > 0.25
    assert res["verdict"].startswith("+EV (large")


# ── Input validation (C4) ─────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "kwargs",
    [
        {"bankroll": 0.0, "american_odds": -110, "fair_prob": 0.55},
        {"bankroll": -5.0, "american_odds": -110, "fair_prob": 0.55},
        {"bankroll": 1000.0, "american_odds": 0, "fair_prob": 0.55},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.0},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 1.0},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": -0.1},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.55, "kelly_multiplier": 0.0},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.55, "kelly_multiplier": 1.5},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.55, "unit_size": 0.0},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.55, "drawdown_floors": [0.0]},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.55, "drawdown_floors": [1.0]},
        {"bankroll": 1000.0, "american_odds": -110, "fair_prob": 0.55, "edge_sensitivity_deltas": [-0.01]},
    ],
)
def test_invalid_inputs_raise_value_error(kwargs):
    with pytest.raises(ValueError):
        bankroll_risk(**kwargs)


def test_risk_of_drawdown_validates_args():
    with pytest.raises(ValueError):
        risk_of_drawdown(0.5, 0.0)
    with pytest.raises(ValueError):
        risk_of_drawdown(0.5, 1.0)
    with pytest.raises(ValueError):
        risk_of_drawdown(0.0, 0.5)
    with pytest.raises(ValueError):
        risk_of_drawdown(1.5, 0.5)


# ── Caveats present + verbatim (honesty gate) ─────────────────────────────────
def test_caveats_present_and_nonempty():
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.55)
    assert len(res["caveats"]) >= 5
    joined = " ".join(res["caveats"]).lower()
    assert "estimated, not known" in joined
    assert "never display 0%" in joined
    # Banned promotional language must not appear anywhere.
    for banned in ("lock", "guaranteed", "hammer", "free money", "must bet"):
        assert banned not in joined


def test_default_unit_size_is_one_percent():
    res = bankroll_risk(bankroll=2000.0, american_odds=-110, fair_prob=0.55)
    assert res["unit_size"] == pytest.approx(20.0, abs=0.01)


def test_doubling_time_matches_ln2_over_g():
    res = bankroll_risk(bankroll=1000.0, american_odds=-110, fair_prob=0.55, kelly_multiplier=0.5)
    assert res["doubling_bets"] == pytest.approx(math.log(2.0) / res["growth_rate"], rel=1e-2)
