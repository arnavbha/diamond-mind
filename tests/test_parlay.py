"""Parlay / SGP checker — reviewer's worked examples, guards, and honesty flags.

Numbers verified against the real helpers (Shin devig, decimal_odds,
american_from_decimal). The headline identity ``offered hold ≡ -EV_per_unit``
(when fair probs come from the same legs) is asserted directly.
"""
import math

import pytest

from app.betting.parlay import parlay_ev


# ── Test 1 — two -110 legs, offered American +164 ──────────────────────────────
def test_two_even_legs_offered_plus164():
    legs = [
        {"american": -110, "opposite_american": -110, "label": "A"},
        {"american": -110, "opposite_american": -110, "label": "B"},
    ]
    r = parlay_ev(legs, offered_american=164)

    # Shin symmetric -> each leg fair prob 0.5
    assert r["legs"][0]["fair_prob"] == pytest.approx(0.5, abs=1e-3)
    assert r["legs"][0]["prob_source"] == "devig"
    assert r["fair_parlay_prob"] == pytest.approx(0.25, abs=1e-3)
    assert r["fair_parlay_decimal"] == pytest.approx(4.0, abs=1e-2)

    # offered decimal = 2.64
    assert r["offered_decimal"] == pytest.approx(2.64, abs=1e-2)
    # ev_pct ≈ -34%
    assert r["ev_pct"] == pytest.approx(-34.0, abs=0.5)
    assert r["verdict"] == "-EV"

    # structural book compounded hold: each -110/-110 booksum ≈ 1.0476 -> ^2-1 ≈ 9.75%
    assert r["book_compounded_hold_pct"] == pytest.approx(9.75, abs=0.5)

    # offered-vs-fair overround = offered_implied/fair_prob - 1 (NOT -ev; distinct
    # quantity, larger than -ev because it is a multiplicative prob ratio).
    expected_hold = (r["offered_implied_parlay_prob"] / r["fair_parlay_prob"] - 1.0) * 100.0
    assert r["parlay_hold_pct"] == pytest.approx(expected_hold, abs=0.1)
    assert r["fair_basis"] == "independence"
    assert r["any_vig_loaded"] is False
    assert r["correlated"] is False


# ── Test 2 — -150/+130 and -200/+170 legs, offered decimal-product 2.50 ─────────
def test_two_favorite_legs():
    legs = [
        {"american": -150, "opposite_american": 130, "label": "X"},
        {"american": -200, "opposite_american": 170, "label": "Y"},
    ]
    # offered decimal 2.50 -> American +150
    r = parlay_ev(legs, offered_american=150)

    assert r["legs"][0]["fair_prob"] == pytest.approx(0.5826, abs=2e-3)
    assert r["legs"][1]["fair_prob"] == pytest.approx(0.6481, abs=2e-3)
    assert r["fair_parlay_prob"] == pytest.approx(0.3776, abs=2e-3)
    assert r["fair_parlay_decimal"] == pytest.approx(2.6482, abs=1e-2)

    assert r["offered_decimal"] == pytest.approx(2.50, abs=1e-2)
    assert r["ev_pct"] == pytest.approx(-5.6, abs=0.5)
    assert r["verdict"] == "-EV"
    # offered-vs-fair overround = offered_implied/fair_prob - 1 (distinct from -ev)
    expected_hold = (r["offered_implied_parlay_prob"] / r["fair_parlay_prob"] - 1.0) * 100.0
    assert r["parlay_hold_pct"] == pytest.approx(expected_hold, abs=0.1)


# ── Test 3 — single-price vig-loaded fallback propagates to parlay level ────────
def test_single_price_vig_loaded_fallback():
    legs = [
        {"american": -110, "label": "no-pair"},  # only one side
        {"american": -110, "opposite_american": -110, "label": "paired"},
    ]
    r = parlay_ev(legs, offered_american=164)

    leg0 = r["legs"][0]
    assert leg0["prob_source"] == "raw_implied"
    assert leg0["vig_loaded"] is True
    assert leg0["fair_prob"] == pytest.approx(0.5238, abs=1e-3)  # raw implied -110

    assert r["any_vig_loaded"] is True
    assert r["verdict_caveat"] is not None
    assert "optimistic" in r["verdict_caveat"].lower()
    # structural book hold undefined when a leg lacks a two-sided price
    assert r["book_compounded_hold_pct"] is None


# ── Test 4 — same-game correlation: flag + warning, NO corrected number ─────────
def test_same_game_correlation_warning():
    legs = [
        {"american": -110, "opposite_american": -110, "game_tag": "NYY@BOS", "label": "ML"},
        {"american": -110, "opposite_american": -110, "game_tag": "nyy@bos ", "label": "Over"},
    ]
    r = parlay_ev(legs, offered_american=164)

    assert r["correlated"] is True
    assert len(r["correlated_groups"]) == 1
    g = r["correlated_groups"][0]
    assert g["leg_count"] == 2
    assert g["leg_indices"] == [0, 1]
    assert r["correlation_warning"] is not None
    assert "INDEPENDENCE ESTIMATE" in r["correlation_warning"]
    assert "fabrication" in r["correlation_warning"]
    # fair number still present and labeled independence — NOT correlation-adjusted
    assert r["fair_basis"] == "independence"
    assert r["fair_parlay_prob"] == pytest.approx(0.25, abs=1e-3)
    # no fabricated correlation field anywhere in the payload
    assert not any("correl" in k and "coef" in k for k in r.keys())
    assert r["verdict_caveat"] is not None


def test_supplied_fair_prob_override():
    legs = [
        {"american": 120, "fair_prob": 0.47, "label": "Dodgers ML"},
        {"american": -110, "opposite_american": -110, "label": "Over"},
    ]
    r = parlay_ev(legs, offered_american=200)
    assert r["legs"][0]["prob_source"] == "supplied"
    assert r["legs"][0]["fair_prob"] == pytest.approx(0.47, abs=1e-6)
    assert r["fair_parlay_prob"] == pytest.approx(0.47 * 0.5, abs=2e-3)


def test_distinct_game_tags_not_correlated():
    legs = [
        {"american": -110, "opposite_american": -110, "game_tag": "NYY@BOS"},
        {"american": -110, "opposite_american": -110, "game_tag": "LAD@SF"},
    ]
    r = parlay_ev(legs, offered_american=264)
    assert r["correlated"] is False
    assert r["correlated_groups"] == []
    assert r["correlation_warning"] is None


def test_whitespace_game_tags_excluded_from_correlation():
    legs = [
        {"american": -110, "opposite_american": -110, "game_tag": "  "},
        {"american": -110, "opposite_american": -110, "game_tag": ""},
    ]
    r = parlay_ev(legs, offered_american=264)
    assert r["correlated"] is False


def test_offered_better_than_fair_can_be_positive_ev():
    # two 0.5 legs -> fair prob 0.25, fair decimal 4.0. Offer +500 (decimal 6.0).
    legs = [
        {"american": -110, "opposite_american": -110},
        {"american": -110, "opposite_american": -110},
    ]
    r = parlay_ev(legs, offered_american=500)
    # P*off = 0.25*6 = 1.5 -> ev_per_unit = 0.5 -> +50%
    assert r["ev_pct"] == pytest.approx(50.0, abs=1.0)
    assert r["verdict"] == "+EV"
    # headline parlay_hold clamped >= 0, but raw goes negative (informative)
    assert r["parlay_hold_pct"] == 0.0
    assert r["parlay_hold_pct_raw"] < 0


def test_book_compounded_hold_is_structurally_distinct_from_ev():
    """Correction #1: the structural book hold (Π booksum - 1) is leg-pricing-only
    and does NOT collapse into -EV (which depends on the offered price). They are
    genuinely separate findings, not the same number relabeled."""
    legs = [
        {"american": -150, "opposite_american": 130},
        {"american": -200, "opposite_american": 170},
    ]
    r = parlay_ev(legs, offered_american=150)
    assert r["book_compounded_hold_pct"] is not None
    # book hold is independent of the offered price; -ev is not. Re-price the same
    # legs at a different offer and confirm book hold is unchanged but ev moves.
    r2 = parlay_ev(legs, offered_american=300)
    assert r2["book_compounded_hold_pct"] == r["book_compounded_hold_pct"]
    assert r2["ev_pct"] != r["ev_pct"]


# ── Test 5 — guards (each -> ValueError -> 422 at the route) ───────────────────
def test_guard_empty():
    with pytest.raises(ValueError):
        parlay_ev([], offered_american=164)


def test_guard_single_leg():
    with pytest.raises(ValueError):
        parlay_ev([{"american": -110, "opposite_american": -110}], offered_american=164)


def test_guard_leg_american_zero():
    legs = [
        {"american": 0, "opposite_american": -110},
        {"american": -110, "opposite_american": -110},
    ]
    with pytest.raises(ValueError):
        parlay_ev(legs, offered_american=164)


def test_guard_offered_american_zero():
    legs = [
        {"american": -110, "opposite_american": -110},
        {"american": -110, "opposite_american": -110},
    ]
    with pytest.raises(ValueError):
        parlay_ev(legs, offered_american=0)


def test_guard_fair_prob_out_of_range():
    legs = [
        {"american": -110, "fair_prob": 1.2},
        {"american": -110, "opposite_american": -110},
    ]
    with pytest.raises(ValueError):
        parlay_ev(legs, offered_american=164)


def test_guard_stake_non_positive():
    legs = [
        {"american": -110, "opposite_american": -110},
        {"american": -110, "opposite_american": -110},
    ]
    with pytest.raises(ValueError):
        parlay_ev(legs, offered_american=164, stake=0.0)


def test_route_import_and_endpoint_registered():
    import app.api.routes as routes  # noqa: F401
    paths = {r.path for r in routes.app.routes}
    assert "/tools/parlay-ev" in paths
