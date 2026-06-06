"""Probability calibration (Platt scaling).

The deterministic model is systematically over-confident: leak-free replay over
950 games showed raw Brier (0.2535) WORSE than always predicting the home base
rate (~0.2494). Platt scaling shrinks the model's probabilities toward the base
rate so downstream edge/tier logic stops acting on phantom confidence.

This does NOT create edge. It makes the model honest, which collapses bet volume
and removes the over-confident heavy-favorite picks that bled in live play.

Canonical home of the Platt fit/apply math (used by both scripts/calibrate.py
and the live model). The fitted params live in configs/calibration.json,
produced by scripts/calibrate.py. Apply is gated by env DM_CALIBRATION (default
"on") so backtests can compare raw vs calibrated.
"""
from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from typing import Optional

import numpy as np

_EPS = 1e-6
_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "configs",
    "calibration.json",
)


def _logit(p):
    p = np.clip(p, _EPS, 1.0 - _EPS)
    return np.log(p / (1.0 - p))


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def fit_platt(p: np.ndarray, y: np.ndarray, iters: int = 100) -> tuple[float, float]:
    """Logistic regression of y on x=logit(p) via Newton/IRLS. Returns (a, b).
    calibrated = sigmoid(a * logit(p) + b). a<1 => shrink toward 0.5."""
    x = _logit(np.asarray(p, dtype=float))
    y = np.asarray(y, dtype=float)
    a, b = 1.0, 0.0
    for _ in range(iters):
        z = a * x + b
        q = _sigmoid(z)
        w = np.clip(q * (1.0 - q), _EPS, None)
        g_a = float(np.sum((q - y) * x))
        g_b = float(np.sum(q - y))
        h_aa = float(np.sum(w * x * x))
        h_ab = float(np.sum(w * x))
        h_bb = float(np.sum(w))
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-12:
            break
        da = (h_bb * g_a - h_ab * g_b) / det
        db = (-h_ab * g_a + h_aa * g_b) / det
        a -= da
        b -= db
        if abs(da) < 1e-9 and abs(db) < 1e-9:
            break
    return float(a), float(b)


def apply_platt(p: float, a: float, b: float) -> float:
    lp = math.log(min(max(p, _EPS), 1 - _EPS) / (1 - min(max(p, _EPS), 1 - _EPS)))
    return 1.0 / (1.0 + math.exp(-(a * lp + b)))


@lru_cache(maxsize=1)
def _load_ml_platt() -> Optional[tuple[float, float]]:
    """Load the moneyline Platt params from configs/calibration.json (cached).
    Returns (a, b) or None if the config is missing/incomplete."""
    try:
        with open(_CONFIG_PATH) as f:
            cfg = json.load(f)
        pl = cfg["moneyline"]["platt"]
        return float(pl["a"]), float(pl["b"])
    except Exception:
        return None


def calibration_enabled() -> bool:
    return os.environ.get("DM_CALIBRATION", "on").lower() not in ("0", "off", "false", "no")


def calibrate_home_prob(p: float) -> float:
    """Apply the ML Platt map to a raw home-win probability.

    Returns p unchanged when calibration is disabled (env) or no config exists,
    so the model degrades gracefully to raw behaviour. Clamped to [0.30, 0.72]
    to match the model's own probability clamp.
    """
    if not calibration_enabled():
        return p
    params = _load_ml_platt()
    if params is None:
        return p
    a, b = params
    return round(min(0.72, max(0.30, apply_platt(p, a, b))), 4)
