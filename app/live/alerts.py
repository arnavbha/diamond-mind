"""Structural live-monitoring alerts — deterministic, no network, no DB.

The single alert kind today is ``starter_pulled_early``: a watchlisted game's
probable starter has been replaced by a reliever in innings 2-5. This is a
*monitoring* surface, not a pick — the language here is strictly verification
("Monitoring alert — not a pick"), and the pregame win probability shown is the
frozen pregame model number, never a live recompute.

`derive_live_alert` is a pure function. It takes the captured live row, the
serialized pregame analysis dict, the Game row (for probable-starter ids, which
are NOT in the serialized analysis), and a freshly-built BullpenReport for the
leaning side (for the vulnerability score, also absent from the analysis dict).
It returns a JSON-ready dict or None when no alert should fire.
"""

from __future__ import annotations

from typing import Any, Optional

_ALERT_LABEL = "Monitoring alert — not a pick"
_ACTIONABLE_TIERS = {"LEAN", "STRONG LEAN"}

# Innings during which a starter-pulled alert is meaningful. Never >=7 (per
# product scope: no late-game alerts) and never <2 (openers / first-inning
# hooks are noise, not signal).
_MIN_INNING = 2
_MAX_INNING = 5


def derive_live_alert(
    live_state: Any,
    pregame_analysis: dict,
    game: Any,
    bullpen_report: Any,
) -> Optional[dict]:
    """Return a structural monitoring alert dict, or None.

    Fires the ``starter_pulled_early`` alert iff ALL hold:
      * pregame ml_tier in {LEAN, STRONG LEAN}
      * the leaning side has a non-null probable_starter_id
      * a current pitcher is on the mound (current_pitcher_id non-null)
      * the current pitcher is NOT the leaning side's probable starter
      * inning is between 2 and 5 inclusive
    """
    if not pregame_analysis:
        return None

    tier = pregame_analysis.get("ml_tier")
    lean = pregame_analysis.get("ml_lean")
    if tier not in _ACTIONABLE_TIERS:
        return None
    if lean not in ("HOME", "AWAY"):
        return None

    # The leaning side's probable starter id lives on the Game row, not the
    # serialized analysis dict.
    if lean == "HOME":
        starter_id = getattr(game, "home_probable_starter_id", None)
        side = "HOME"
        side_abbr = pregame_analysis.get("home_team_abbr") or ""
        win_prob = pregame_analysis.get("model_home_win_prob")
    else:
        starter_id = getattr(game, "away_probable_starter_id", None)
        side = "AWAY"
        side_abbr = pregame_analysis.get("away_team_abbr") or ""
        win_prob = pregame_analysis.get("model_away_win_prob")
        if win_prob is None:
            home_wp = pregame_analysis.get("model_home_win_prob")
            win_prob = (1.0 - home_wp) if home_wp is not None else None

    current_pitcher_id = getattr(live_state, "current_pitcher_id", None)
    inning = getattr(live_state, "inning", None)

    if starter_id is None:
        return None
    if current_pitcher_id is None:
        return None
    if current_pitcher_id == starter_id:
        return None  # starter still pitching
    if inning is None or inning < _MIN_INNING or inning > _MAX_INNING:
        return None

    vuln = getattr(bullpen_report, "vulnerability_score", None)
    vuln_int = int(round(vuln)) if vuln is not None else 0

    win_prob_pct = int(round(win_prob * 100)) if win_prob is not None else 0

    headline = f"Starter pulled inning {inning} — bullpen vuln {vuln_int}/100"
    detail = (
        f"Pregame model: {side_abbr} {win_prob_pct}% ({tier}). "
        f"{_ALERT_LABEL}."
    )

    return {
        "kind": "starter_pulled_early",
        "severity": "info",
        "side": side,
        "headline": headline,
        "detail": detail,
        "label": _ALERT_LABEL,
        "pregame_tier": tier,
        "pregame_lean": lean,
        "pregame_win_prob": float(win_prob) if win_prob is not None else 0.0,
        "bullpen_vuln": vuln_int,
    }
