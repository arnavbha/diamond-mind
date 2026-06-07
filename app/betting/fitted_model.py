"""Offense-first FITTED win-probability model (Path B rebuild).

Replaces hand-tuned component scales with weights LEARNED from data, on the
feature set that actually carried out-of-sample signal (950-game importance
study): offense dominates (wOBA, ISO, contact/K-rate, BB-rate), pitching CONTROL
matters modestly (WHIP, BB9, pitcher xwOBA-against), run environment a little.
The dead weight our old model leaned on — FIP, bullpen vulnerability, CSW,
team-xwOBA — is intentionally DROPPED (all ~0 importance).

This is "do Cui's method properly": a regularized logistic regression fit on
leak-free features, not guessed coefficients.

assemble_features() is the single source of truth for the feature vector, used
by BOTH the trainer (scripts/fit_model.py) and the live path
(analysis_builder under DM_MODEL_VARIANT=fitted) so they can never drift.
All lookups are as_of-bounded (the replay path passes as_of = game_date - 1).

Coefficients live in configs/fitted_model.json (produced by the trainer).
"""
from __future__ import annotations

import json
import math
import os
from datetime import date
from functools import lru_cache
from typing import Optional

from sqlalchemy.orm import Session

from app.contracts import WindowKey

# Feature order is contractual — config coefs align to this list.
FEATURES = [
    "off_woba", "off_iso", "off_k", "off_bb",   # offense (dominant)
    "sp_whip", "sp_bb9", "sp_xwoba",            # pitching control
    "tf_rpg", "tf_rapg",                         # run environment
]

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "configs", "fitted_model.json",
)


def _d(hv, av):
    return (hv - av) if (hv is not None and av is not None) else None


def assemble_features(db: Session, game, as_of: date) -> dict:
    """Home-minus-away feature diffs for a game, as_of-bounded. Missing -> None
    (caller imputes to the league-mean diff). Single source of truth."""
    from app.betting.analysis_builder import _batting_stats_for_team
    from app.features.recent_form import build_starter_form_window, build_team_form_window
    from app.betting.statcast_quality import pitcher_xstat_window
    from app.models.entities import Team

    h, a = game.home_team_id, game.away_team_id
    hb = _batting_stats_for_team(db, team_id=h, as_of=as_of)
    ab = _batting_stats_for_team(db, team_id=a, as_of=as_of)

    def sp(pid):
        if not pid:
            return {}
        w = build_starter_form_window(db, pitcher_id=pid, window=WindowKey.LAST_5_STARTS, as_of_date=as_of)
        return {} if w is None else {"whip": w.whip, "bb9": w.bb_per_9}

    hsp, asp = sp(game.home_probable_starter_id), sp(game.away_probable_starter_id)

    def tf(tid):
        w = build_team_form_window(db, team_id=tid, window=WindowKey.L10, as_of_date=as_of)
        return {} if w is None else {"rpg": w.runs_per_game, "rapg": w.runs_allowed_per_game}

    htf, atf = tf(h), tf(a)

    hpx = pitcher_xstat_window(db, game.home_probable_starter_id, as_of) if game.home_probable_starter_id else None
    apx = pitcher_xstat_window(db, game.away_probable_starter_id, as_of) if game.away_probable_starter_id else None
    hx = hpx.get("xwoba_contact") if hpx else None
    ax = apx.get("xwoba_contact") if apx else None

    return {
        "off_woba": _d(hb.get("woba"), ab.get("woba")),
        "off_iso": _d(hb.get("iso"), ab.get("iso")),
        "off_k": _d(hb.get("k_rate"), ab.get("k_rate")),
        "off_bb": _d(hb.get("bb_rate"), ab.get("bb_rate")),
        # pitching: away-minus-home so a POSITIVE diff favors the home team
        "sp_whip": _d(asp.get("whip"), hsp.get("whip")),
        "sp_bb9": _d(asp.get("bb9"), hsp.get("bb9")),
        "sp_xwoba": _d(ax, hx),  # away SP xwOBA-against minus home's; + favors home
        "tf_rpg": _d(htf.get("rpg"), atf.get("rpg")),
        "tf_rapg": _d(atf.get("rapg"), htf.get("rapg")),  # + favors home (away allows more)
    }


@lru_cache(maxsize=1)
def _load() -> Optional[dict]:
    try:
        with open(_CONFIG_PATH) as f:
            cfg = json.load(f)
        # sanity: feature order must match
        if cfg.get("features") != FEATURES:
            return None
        return cfg
    except Exception:
        return None


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def fitted_home_prob(db: Session, game, as_of: date) -> Optional[float]:
    """Fitted logistic home-win probability, or None if config/features absent.

    Standardizes each feature with the trainer's stored mean/std, imputes missing
    with the train mean (= 0 standardized = league-average matchup), applies the
    learned coefficients. Clamped to [0.30, 0.72] to match the model's own clamp.
    """
    cfg = _load()
    if cfg is None:
        return None
    feats = assemble_features(db, game, as_of)
    mu = cfg["mean"]; sd = cfg["std"]; coef = cfg["coef"]; intercept = cfg["intercept"]
    z = intercept
    for i, f in enumerate(FEATURES):
        v = feats.get(f)
        s = sd[i] if sd[i] else 1.0
        xs = 0.0 if v is None else (v - mu[i]) / s  # missing -> standardized 0
        z += coef[i] * xs
    p = _sigmoid(z)
    return round(min(0.72, max(0.30, p)), 4)
