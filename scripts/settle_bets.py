"""settle_bets.py — batch-settle BetRecords from final game scores.

For each unsettled bet on a given date range, look up the final score in the
games table and compute WIN / LOSS / PUSH:

  Moneyline: selection team wins → WIN, loses → LOSS.
  Total:     selection OVER/UNDER vs (home_score + away_score) vs total_line.
             Exact match → PUSH.

Skips any game whose status is not "Final" so in-progress games are never
accidentally settled.

Usage:
    # Settle a single date
    python scripts/settle_bets.py --date 2026-05-17

    # Settle a range
    python scripts/settle_bets.py --from 2026-05-16 --to 2026-05-18

    # Dry run (print what would happen, write nothing)
    python scripts/settle_bets.py --from 2026-05-16 --to 2026-05-18 --dry-run
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

# Allow running from repo root without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.games import Game
from app.models.tracker import BetRecord, compute_units_returned
from app.models.entities import Team
from app.betting.clv import apply_clv_to_bet, compute_clv_for_bet


# ── helpers ───────────────────────────────────────────────────────────────────

def _daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _result_moneyline(bet: BetRecord, game: Game, home_abbr: str, away_abbr: str) -> str | None:
    """WIN / LOSS / PUSH for a moneyline bet, or None if score unavailable."""
    if game.home_score is None or game.away_score is None:
        return None

    home_won = game.home_score > game.away_score
    away_won = game.away_score > game.home_score
    # Ties are extremely rare in MLB (extra innings always produce a winner)
    # but guard against them as PUSH.
    if game.home_score == game.away_score:
        return "PUSH"

    bet_on_home = bet.selection == home_abbr
    if bet_on_home:
        return "WIN" if home_won else "LOSS"
    else:
        return "WIN" if away_won else "LOSS"


def _result_total(bet: BetRecord, game: Game) -> str | None:
    """WIN / LOSS / PUSH for a totals bet, or None if data unavailable."""
    if game.home_score is None or game.away_score is None:
        return None
    if bet.total_line is None:
        return None

    actual = game.home_score + game.away_score
    if actual == bet.total_line:
        return "PUSH"
    if bet.selection == "OVER":
        return "WIN" if actual > bet.total_line else "LOSS"
    if bet.selection == "UNDER":
        return "WIN" if actual < bet.total_line else "LOSS"
    return None


# ── main ──────────────────────────────────────────────────────────────────────

def settle_range(
    db: Session,
    start: date,
    end: date,
    *,
    dry_run: bool = False,
) -> None:
    # Fetch all unsettled bets in range
    bets = db.execute(
        select(BetRecord)
        .where(
            BetRecord.game_date >= start,
            BetRecord.game_date <= end,
            BetRecord.result.is_(None),
        )
        .order_by(BetRecord.game_date, BetRecord.game_id)
    ).scalars().all()

    if not bets:
        print(f"No unsettled bets found for {start} – {end}.")
        return

    print(f"Found {len(bets)} unsettled bet(s) for {start} – {end}.\n")

    # Preload games and teams for the date range in one query
    games_by_id: dict[int, Game] = {
        g.id: g
        for g in db.execute(
            select(Game).where(Game.game_date >= start, Game.game_date <= end)
        ).scalars().all()
    }

    team_abbrs: dict[int, str] = {
        t.id: t.abbr
        for t in db.execute(select(Team)).scalars().all()
    }

    settled = skipped_not_final = skipped_no_score = skipped_unknown = 0

    for bet in bets:
        game = games_by_id.get(bet.game_id)
        if game is None:
            print(f"  SKIP  bet #{bet.id}: game {bet.game_id} not in DB")
            skipped_unknown += 1
            continue

        # MLB terminal statuses: "Final", "Game Over", "Completed Early" (rain/mercy)
        _TERMINAL = ("Final", "Game Over", "Completed Early")
        if not any(t in game.status for t in _TERMINAL):
            print(
                f"  SKIP  bet #{bet.id} ({bet.game_date} "
                f"{bet.away_team_abbr}@{bet.home_team_abbr} {bet.market}): "
                f"game status='{game.status}'"
            )
            skipped_not_final += 1
            continue

        home_abbr = team_abbrs.get(game.home_team_id, bet.home_team_abbr)
        away_abbr = team_abbrs.get(game.away_team_id, bet.away_team_abbr)

        if bet.market == "moneyline":
            result = _result_moneyline(bet, game, home_abbr, away_abbr)
        elif bet.market == "total":
            result = _result_total(bet, game)
        else:
            print(f"  SKIP  bet #{bet.id}: unknown market '{bet.market}'")
            skipped_unknown += 1
            continue

        if result is None:
            print(
                f"  SKIP  bet #{bet.id} ({bet.game_date} "
                f"{away_abbr}@{home_abbr} {bet.market} {bet.selection}): "
                f"score={game.home_score}-{game.away_score} line={bet.total_line} — can't determine result"
            )
            skipped_no_score += 1
            continue

        units_returned = compute_units_returned(result, bet.units, bet.american_odds)
        sign = "+" if units_returned >= 0 else ""
        print(
            f"  {'DRY ' if dry_run else ''}SETTLE  bet #{bet.id:>4}  "
            f"{bet.game_date}  {away_abbr}@{home_abbr}  "
            f"{bet.market:<10} {bet.selection:<6}  "
            f"{result:<4}  {sign}{units_returned:+.2f}u  "
            f"(score {game.away_score}-{game.home_score})"
        )

        if not dry_run:
            bet.result = result
            bet.units_returned = units_returned
            # CLV is final once first pitch passes; capture it in the same pass so
            # the manual script matches the /admin/run-settlement endpoint (which
            # already wires this). Best-effort — never let CLV break settlement.
            try:
                apply_clv_to_bet(bet, compute_clv_for_bet(db, bet, game))
            except Exception as exc:  # noqa: BLE001
                print(f"    clv compute failed for bet #{bet.id}: {exc}")
            settled += 1

    if not dry_run:
        db.commit()

    print(f"\n{'[DRY RUN] Would settle' if dry_run else 'Settled'}: {len(bets) - skipped_not_final - skipped_no_score - skipped_unknown} bet(s)")
    if skipped_not_final:
        print(f"Skipped (game not Final): {skipped_not_final}")
    if skipped_no_score:
        print(f"Skipped (can't determine result): {skipped_no_score}")
    if skipped_unknown:
        print(f"Skipped (unknown market/missing game): {skipped_unknown}")


def main():
    parser = argparse.ArgumentParser(description="Settle bets from final game scores.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--date", type=date.fromisoformat, help="Single date (YYYY-MM-DD)")
    group.add_argument("--from", dest="date_from", type=date.fromisoformat, help="Start of range")
    parser.add_argument("--to", dest="date_to", type=date.fromisoformat, help="End of range (requires --from)")
    parser.add_argument("--dry-run", action="store_true", help="Print results without writing to DB")
    args = parser.parse_args()

    if args.date:
        start = end = args.date
    else:
        if args.date_to is None:
            parser.error("--to is required when using --from")
        start, end = args.date_from, args.date_to
        if end < start:
            parser.error("--to must be >= --from")

    if args.dry_run:
        print("=== DRY RUN — no changes will be written ===\n")

    with SessionLocal() as db:
        settle_range(db, start, end, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
