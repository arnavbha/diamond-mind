"""Fit the offense-first logistic win model and write configs/fitted_model.json.

Leak-free (as_of = game_date - 1). Regularized logistic via IRLS (pure numpy).
Chronological train/test split: reports OOS Brier vs base rate so we never
trust an in-sample number. Single source of truth for features =
app.betting.fitted_model.assemble_features (no drift with the live path).

Usage: .venv/bin/python scripts/fit_model.py [--train-frac 0.7]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import timedelta

os.environ.setdefault("DM_MODEL_VARIANT", "off")  # build raw features, not recursive
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.games import Game  # noqa: E402
from app.betting.fitted_model import FEATURES, assemble_features, _CONFIG_PATH  # noqa: E402


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-frac", type=float, default=0.7)
    ap.add_argument("--lam", type=float, default=2.0, help="L2 strength")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        games = list(db.execute(select(Game).where(
            Game.home_score.is_not(None), Game.away_score.is_not(None)
        ).order_by(Game.game_date.asc(), Game.id.asc())).scalars())
        rows, Y = [], []
        for g in games:
            f = assemble_features(db, g, g.game_date - timedelta(days=1))
            rows.append([f.get(k) for k in FEATURES])
            Y.append(1.0 if g.home_score > g.away_score else 0.0)
    finally:
        db.close()

    X = np.array([[np.nan if v is None else v for v in r] for r in rows], float)
    Y = np.array(Y)
    n = len(Y); split = int(n * args.train_frac)

    mu = np.nanmean(X[:split], axis=0); mu = np.where(np.isnan(mu), 0.0, mu)
    sd = np.nanstd(X[:split], axis=0); sd = np.where(np.isnan(sd) | (sd < 1e-9), 1.0, sd)
    inds = np.where(np.isnan(X)); X[inds] = np.take(mu, inds[1])
    Xs = (X - mu) / sd

    Xtr = np.hstack([np.ones((split, 1)), Xs[:split]]); ytr = Y[:split]
    w = np.zeros(Xtr.shape[1]); lam = args.lam
    for _ in range(300):
        p = _sigmoid(Xtr @ w); W = np.clip(p * (1 - p), 1e-6, None)
        g_ = Xtr.T @ (p - ytr) + lam * np.r_[0.0, w[1:]]
        H = Xtr.T @ (Xtr * W[:, None]) + lam * np.eye(len(w))
        try:
            step = np.linalg.solve(H, g_)
        except Exception:
            break
        w -= step
        if np.max(np.abs(step)) < 1e-9:
            break

    def brier(p, y):
        return float(np.mean((p - y) ** 2))
    Xte = np.hstack([np.ones((n - split, 1)), Xs[split:]]); yte = Y[split:]
    pte = _sigmoid(Xte @ w)
    base = float(Y[:split].mean())
    print(f"n={n} train={split} test={n-split}")
    print(f"OOS Brier fitted={brier(pte, yte):.4f}  base_rate={brier(np.full(len(yte), base), yte):.4f}")
    print("\nLearned standardized coefficients:")
    for f, c in sorted(zip(FEATURES, w[1:]), key=lambda x: -abs(x[1])):
        print(f"  {f:<10}{c:+.3f}")

    # Refit on ALL data for the production config (max data), same lambda.
    Xall = np.hstack([np.ones((n, 1)), ((X - mu) / sd)])
    wf = np.zeros(Xall.shape[1])
    for _ in range(300):
        p = _sigmoid(Xall @ wf); W = np.clip(p * (1 - p), 1e-6, None)
        g_ = Xall.T @ (p - Y) + lam * np.r_[0.0, wf[1:]]
        H = Xall.T @ (Xall * W[:, None]) + lam * np.eye(len(wf))
        try:
            wf -= np.linalg.solve(H, g_)
        except Exception:
            break

    cfg = {
        "features": FEATURES,
        "mean": [round(float(x), 6) for x in mu],
        "std": [round(float(x), 6) for x in sd],
        "intercept": round(float(wf[0]), 6),
        "coef": [round(float(x), 6) for x in wf[1:]],
        "lambda": lam,
        "n_train": n,
        "oos_brier": round(brier(pte, yte), 4),
        "base_rate_brier": round(brier(np.full(len(yte), base), yte), 4),
    }
    os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
    with open(_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"\nWrote {_CONFIG_PATH} (refit on all {n} games for production).")


if __name__ == "__main__":
    main()
