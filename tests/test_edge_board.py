"""Tests for the +EV Edge Board helper (app.betting.edge_board) and the
auto-track totals-plural regression fix.

Covers (from the design + adversarial review):
  * edge sign / definition: edge = model_prob − novig_prob on the lean side
  * ML & total leaned-side selection (HOME→home/away_prob, OVER→over/under)
  * total no-vig prob recovered algebraically (no qt_shin_vig_free field)
  * PASS market → model-implied side, actionable=False, never a recommendation
  * no real two-sided odds → null edge (NOT a fabricated 0.0% edge)
  * hold% / movement_agreement read from the same fair/movement attach
  * regression: auto-track totals odds lookup queries market == "total"
"""
import inspect

from app.betting.edge_board import build_model_edge, model_market_edge


# ── pure edge math ────────────────────────────────────────────────────────────
def test_model_market_edge_sign_and_rounding():
    # model gives the side MORE prob than the no-vig book → positive edge
    assert model_market_edge(0.56, 0.52) == 0.04
    # model trails the market → honest negative edge (never hidden)
    assert model_market_edge(0.50, 0.55) == -0.05
    # 4dp rounding
    assert model_market_edge(0.561234, 0.520000) == 0.0412


# ── moneyline: leaned-side selection + edge ───────────────────────────────────
def _ml_analysis(**over):
    base = {
        "q_has_real_odds": True,
        "ml_tier": "LEAN",
        "ml_lean": "HOME",
        "q_p_shrunk": 0.56,
        "q_shin_vig_free": 0.52,
        "q_edge_quant": 0.04,
        "model_home_win_prob": 0.58,
        # totals absent → total edge null
        "qt_has_real_odds": False,
    }
    base.update(over)
    return base


def test_ml_home_lean_positive_edge():
    me = build_model_edge(_ml_analysis(), live_odds=None)
    ml = me["moneyline"]
    assert ml["side"] == "home"
    assert ml["tier"] == "LEAN"
    assert ml["actionable"] is True
    assert ml["model_prob"] == 0.56
    assert ml["novig_prob"] == 0.52
    assert ml["edge"] == 0.04
    # total has no real odds → honest null, not a 0 edge
    assert me["total"] is None


def test_ml_away_lean_uses_away_probs():
    a = _ml_analysis(ml_lean="AWAY", q_p_shrunk=0.47, q_shin_vig_free=0.45)
    ml = build_model_edge(a, live_odds=None)["moneyline"]
    assert ml["side"] == "away"
    assert ml["edge"] == round(0.47 - 0.45, 4)


def test_ml_lean_case_insensitive():
    a = _ml_analysis(ml_lean="home")
    assert build_model_edge(a, live_odds=None)["moneyline"]["side"] == "home"


# ── moneyline: PASS → model-implied side, non-actionable ──────────────────────
def test_ml_pass_uses_model_implied_side_nonactionable():
    a = _ml_analysis(ml_lean="PASS", ml_tier="PASS", model_home_win_prob=0.41)
    ml = build_model_edge(a, live_odds=None)["moneyline"]
    assert ml["side"] == "away"          # home_p < 0.5 → away
    assert ml["actionable"] is False
    assert ml["tier"] == "PASS"
    # edge still computable + honest
    assert ml["edge"] == round(0.56 - 0.52, 4)


def test_ml_pass_home_implied_when_prob_at_or_above_half():
    a = _ml_analysis(ml_lean="PASS", ml_tier="PASS", model_home_win_prob=0.50)
    ml = build_model_edge(a, live_odds=None)["moneyline"]
    assert ml["side"] == "home"
    assert ml["actionable"] is False


# ── no real odds → null edge (never fabricated 0%) ────────────────────────────
def test_ml_no_real_odds_is_null_not_zero_edge():
    a = _ml_analysis(q_has_real_odds=False)
    assert build_model_edge(a, live_odds=None)["moneyline"] is None


def test_no_analysis_returns_none():
    assert build_model_edge(None, live_odds=None) is None


# ── totals: leaned-side + algebraic no-vig prob ───────────────────────────────
def _total_analysis(**over):
    base = {
        "q_has_real_odds": False,
        "qt_has_real_odds": True,
        "total_tier": "LEAN",
        "total_lean": "OVER",
        "qt_p_shrunk": 0.55,
        "qt_edge_quant": 0.03,
        "projected_total": 9.5,
        "total_line": 8.5,
    }
    base.update(over)
    return base


def test_total_over_lean_algebraic_novig():
    t = build_model_edge(_total_analysis(), live_odds=None)["total"]
    assert t["side"] == "over"
    assert t["actionable"] is True
    assert t["model_prob"] == 0.55
    # novig = p_shrunk − edge_quant  (no qt_shin_vig_free field exists)
    assert t["novig_prob"] == 0.52
    assert t["edge"] == round(0.55 - 0.52, 4)  # == qt_edge_quant
    assert t["line"] == 8.5


def test_total_under_lean_uses_under_side():
    t = build_model_edge(
        _total_analysis(total_lean="UNDER", qt_p_shrunk=0.53, qt_edge_quant=0.02),
        live_odds=None,
    )["total"]
    assert t["side"] == "under"
    assert t["novig_prob"] == round(0.53 - 0.02, 4)


def test_total_pass_uses_projected_vs_line_nonactionable():
    t = build_model_edge(
        _total_analysis(total_lean="PASS", total_tier="PASS", projected_total=7.0, total_line=8.5),
        live_odds=None,
    )["total"]
    assert t["side"] == "under"       # proj < line → under
    assert t["actionable"] is False


def test_total_pass_no_line_is_null():
    a = _total_analysis(total_lean="PASS", total_tier="PASS", total_line=None)
    assert build_model_edge(a, live_odds=None)["total"] is None


def test_total_no_real_odds_is_null():
    a = _total_analysis(qt_has_real_odds=False)
    assert build_model_edge(a, live_odds=None)["total"] is None


# ── hold% + movement read from the same fair/movement attach ──────────────────
def test_hold_and_movement_from_live_odds():
    a = _ml_analysis()
    live = {
        "moneyline": {
            "home": -130,
            "away": +110,
            "fair": {"home_prob": 0.55, "away_prob": 0.45, "hold_pct": 4.3},
            "movement": {"agreement": "toward"},
        },
        "total": None,
    }
    ml = build_model_edge(a, live_odds=live)["moneyline"]
    assert ml["hold_pct"] == 4.3
    assert ml["movement_agreement"] == "toward"


def test_hold_and_movement_null_when_no_fair_block():
    ml = build_model_edge(_ml_analysis(), live_odds={"moneyline": {"home": -130}})["moneyline"]
    assert ml["hold_pct"] is None
    assert ml["movement_agreement"] is None


def test_does_not_mutate_caller_analysis():
    a = _ml_analysis()
    build_model_edge(a, live_odds={"moneyline": {"fair": {"hold_pct": 1.0}}})
    assert "_live_odds" not in a


# ── regression: auto-track totals odds lookup uses canonical market == "total" ─
def test_auto_track_totals_query_uses_singular_total():
    """The over/under odds lookup in POST /tracker/auto-track must filter on the
    canonical stored market value 'total' (singular), not the non-canonical
    'totals'. 'totals' matched ZERO odds_snapshots rows and silently fell back to
    the hardcoded -110 — a fabricated price on a tracked bet."""
    import app.api.routes as routes

    src = inspect.getsource(routes)
    # the broken plural string must be gone from the totals odds lookup
    assert 'OddsSnapshotRow.market == "totals"' not in src
    # and the canonical singular must be present in the auto-track total branch
    assert 'OddsSnapshotRow.market == "total"' in src
