"""Offline probability calibration (Phase 1).

Replays the deterministic model over every completed game LEAK-FREE
(as_of = game_date - 1, matching the corrected backtest) and fits a calibration
map from raw model probability -> empirical outcome rate.

Why: live tracker data showed the model's high-confidence ML picks were
INVERTED (model_prob 65%+ -> ~38% actual win rate). A calibrator corrects the
systematic over/under-confidence before edge/tier logic consumes the prob.

Labels come from ALL completed games (every game has model_home_win_prob), not
just the bet rows -- ~800 clean labels vs ~130 live bets. NO DB writes.

Two fitters, both pure-numpy (no sklearn/scipy):
  * Platt  : calibrated = sigmoid(a * logit(p) + b). 2 params, robust on small n.
  * Isotonic (PAVA): nonparametric monotonic map. Needs more data; can overfit.

Outputs a reliability report + writes configs/calibration.json (the fit params).
It does NOT wire the map into the model -- that is a separate, reviewed step.

Usage:
    .venv/bin/python scripts/calibrate.py
    .venv/bin/python scripts/calibrate.py --start 2026-03-25 --end 2026-05-24
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta

import numpy as np

# Allow `python scripts/calibrate.py` from repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models.games import Game  # noqa: E402


_EPS = 1e-6


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, _EPS, 1.0 - _EPS)
    return np.log(p / (1.0 - p))


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _brier(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean((p - y) ** 2))


# ── Platt scaling: fit a, b in sigmoid(a*logit(p)+b) via Newton/IRLS ──────────
def fit_platt(p: np.ndarray, y: np.ndarray, iters: int = 100) -> tuple[float, float]:
    """Logistic regression of y on x=logit(p). Returns (a, b)."""
    x = _logit(p)
    a, b = 1.0, 0.0  # init: identity in log-odds space
    n = len(x)
    for _ in range(iters):
        z = a * x + b
        q = _sigmoid(z)
        w = np.clip(q * (1.0 - q), _EPS, None)  # IRLS weights
        # gradient of NLL
        g_a = np.sum((q - y) * x)
        g_b = np.sum(q - y)
        # Hessian (2x2)
        h_aa = np.sum(w * x * x)
        h_ab = np.sum(w * x)
        h_bb = np.sum(w)
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-12:
            break
        # Newton step: [a,b] -= H^-1 g
        da = (h_bb * g_a - h_ab * g_b) / det
        db = (-h_ab * g_a + h_aa * g_b) / det
        a -= da
        b -= db
        if abs(da) < 1e-9 and abs(db) < 1e-9:
            break
    return float(a), float(b)


def apply_platt(p: np.ndarray, a: float, b: float) -> np.ndarray:
    return _sigmoid(a * _logit(p) + b)


# ── Isotonic regression via Pool Adjacent Violators (PAVA) ────────────────────
def fit_isotonic(p: np.ndarray, y: np.ndarray) -> tuple[list[float], list[float]]:
    """Monotonic non-decreasing fit of y on p. Returns (x_knots, y_values)
    sorted by x, suitable for np.interp at apply time."""
    order = np.argsort(p)
    xs = p[order].astype(float)
    ys = y[order].astype(float)
    # PAVA
    n = len(ys)
    # blocks: value, weight, start_idx
    vals = list(ys)
    wts = [1.0] * n
    # iterative pooling
    i = 0
    block_vals: list[float] = []
    block_wts: list[float] = []
    for k in range(n):
        block_vals.append(vals[k])
        block_wts.append(wts[k])
        while len(block_vals) > 1 and block_vals[-2] > block_vals[-1]:
            v2 = block_vals.pop()
            w2 = block_wts.pop()
            v1 = block_vals.pop()
            w1 = block_wts.pop()
            merged = (v1 * w1 + v2 * w2) / (w1 + w2)
            block_vals.append(merged)
            block_wts.append(w1 + w2)
    # expand block values back to per-point fitted values
    fitted: list[float] = []
    for v, w in zip(block_vals, block_wts):
        fitted.extend([v] * int(round(w)))
    fitted = fitted[:n]
    # collapse to knots at unique x (keep last fitted per x)
    ux: list[float] = []
    uy: list[float] = []
    for xv, fv in zip(xs, fitted):
        if ux and abs(ux[-1] - xv) < 1e-9:
            uy[-1] = fv
        else:
            ux.append(float(xv))
            uy.append(float(fv))
    # Compress: isotonic is a step function — keep only the FIRST x of each
    # constant-y run plus the final point. np.interp reconstructs identically.
    knots_x: list[float] = []
    knots_y: list[float] = []
    for i, (xv, yv) in enumerate(zip(ux, uy)):
        if i == 0 or abs(yv - knots_y[-1]) > 1e-9 or i == len(ux) - 1:
            knots_x.append(xv)
            knots_y.append(yv)
    return knots_x, knots_y


def apply_isotonic(p: np.ndarray, kx: list[float], ky: list[float]) -> np.ndarray:
    if not kx:
        return p
    return np.interp(p, kx, ky, left=ky[0], right=ky[-1])


# ── Reliability table (deciles) ───────────────────────────────────────────────
def reliability(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0.0, 1.0, bins + 1)
    out = []
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi) if i < bins - 1 else (p >= lo) & (p <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        out.append({
            "bin": f"[{lo:.2f},{hi:.2f})",
            "n": n,
            "mean_pred": round(float(p[mask].mean()), 4),
            "actual": round(float(y[mask].mean()), 4),
        })
    return out


def _print_reliability(title: str, raw: list[dict]) -> None:
    print(f"\n{title}")
    print(f"  {'bin':<14} {'n':>5} {'pred':>7} {'actual':>7} {'gap':>7}")
    for r in raw:
        gap = r["actual"] - r["mean_pred"]
        flag = "  <-- inverted" if gap < -0.08 else ""
        print(f"  {r['bin']:<14} {r['n']:>5} {r['mean_pred']:>7.3f} {r['actual']:>7.3f} {gap:>+7.3f}{flag}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default=None, help="YYYY-MM-DD (default: season open)")
    ap.add_argument("--end", default=None, help="YYYY-MM-DD (default: latest completed)")
    ap.add_argument("--out", default="configs/calibration.json")
    args = ap.parse_args()

    from app.betting.analysis_builder import build_game_analysis

    db = SessionLocal()
    try:
        q = select(Game).where(
            Game.home_score.is_not(None), Game.away_score.is_not(None)
        )
        if args.start:
            q = q.where(Game.game_date >= date.fromisoformat(args.start))
        if args.end:
            q = q.where(Game.game_date <= date.fromisoformat(args.end))
        q = q.order_by(Game.game_date.asc(), Game.id.asc())
        games = list(db.execute(q).scalars())

        ml_p: list[float] = []
        ml_y: list[float] = []
        tot_p: list[float] = []
        tot_y: list[float] = []

        skipped = 0
        for g in games:
            a = build_game_analysis(g.id, g.game_date - timedelta(days=1), db)
            if a is None:
                skipped += 1
                continue
            home_won = 1.0 if g.home_score > g.away_score else 0.0
            ml_p.append(float(a.model_home_win_prob))
            ml_y.append(home_won)

            # Totals (PROVISIONAL: qt_p_model orientation assumed P(over)).
            if a.total_line is not None and a.qt_has_real_odds:
                total_runs = g.home_score + g.away_score
                if total_runs != a.total_line:  # drop pushes
                    over_hit = 1.0 if total_runs > a.total_line else 0.0
                    tot_p.append(float(a.qt_p_model))
                    tot_y.append(over_hit)

        print(f"Replayed {len(games)} completed games (skipped {skipped} unanalyzable).")
        print(f"ML labels: {len(ml_p)}  |  Totals labels: {len(tot_p)} (PROVISIONAL)")

        report: dict = {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "n_games": len(games),
            "as_of_rule": "game_date - 1 (leak-free replay)",
        }

        # ── ML calibration ───────────────────────────────────────────────────
        p = np.array(ml_p)
        y = np.array(ml_y)
        a_pl, b_pl = fit_platt(p, y)
        kx, ky = fit_isotonic(p, y)
        p_platt = apply_platt(p, a_pl, b_pl)
        p_iso = apply_isotonic(p, kx, ky)

        br_raw = _brier(p, y)
        br_platt = _brier(p_platt, y)
        br_iso = _brier(p_iso, y)

        print("\n=== MONEYLINE (model_home_win_prob -> P(home win)) ===")
        print(f"  n={len(p)}  base_rate(home win)={y.mean():.3f}")
        print(f"  Brier  raw={br_raw:.4f}  platt={br_platt:.4f}  isotonic={br_iso:.4f}")
        print(f"  Platt: a={a_pl:.4f} b={b_pl:.4f}  (a<1 => shrink toward 0.5)")
        _print_reliability("Reliability RAW:", reliability(p, y))
        _print_reliability("Reliability PLATT:", reliability(p_platt, y))

        report["moneyline"] = {
            "n": len(p),
            "base_rate": round(float(y.mean()), 4),
            "brier_raw": round(br_raw, 4),
            "brier_platt": round(br_platt, 4),
            "brier_isotonic": round(br_iso, 4),
            "platt": {"a": round(a_pl, 6), "b": round(b_pl, 6)},
            "isotonic": {"x": [round(v, 4) for v in kx], "y": [round(v, 4) for v in ky]},
            "recommended": "platt" if br_platt <= br_iso else "isotonic",
        }

        # ── Totals (provisional) ──────────────────────────────────────────────
        if len(tot_p) >= 30:
            tp = np.array(tot_p)
            ty = np.array(tot_y)
            ta, tb = fit_platt(tp, ty)
            tkx, tky = fit_isotonic(tp, ty)
            tbr_raw = _brier(tp, ty)
            tbr_platt = _brier(apply_platt(tp, ta, tb), ty)
            tbr_iso = _brier(apply_isotonic(tp, tkx, tky), ty)
            print("\n=== TOTALS (qt_p_model -> P(over))  [PROVISIONAL: verify orientation] ===")
            print(f"  n={len(tp)}  base_rate(over)={ty.mean():.3f}")
            print(f"  Brier  raw={tbr_raw:.4f}  platt={tbr_platt:.4f}  isotonic={tbr_iso:.4f}")
            _print_reliability("Reliability RAW:", reliability(tp, ty))
            report["totals_provisional"] = {
                "n": len(tp),
                "base_rate": round(float(ty.mean()), 4),
                "brier_raw": round(tbr_raw, 4),
                "brier_platt": round(tbr_platt, 4),
                "brier_isotonic": round(tbr_iso, 4),
                "platt": {"a": round(ta, 6), "b": round(tb, 6)},
                "note": "orientation of qt_p_model unverified; do NOT wire in yet",
            }
        else:
            print(f"\nTotals: only {len(tot_p)} labels — skipping (need >=30).")

        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nWrote {args.out}")
        print("NOTE: this only PRODUCES the calibration map. Wiring it into "
              "game_analyzer is a separate reviewed step.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
