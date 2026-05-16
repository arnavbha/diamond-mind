# Handoff: Betting Aggregate Endpoints

**From:** Track A (Arnav)
**To:** Track B (Jack)
**Date:** 2026-05-16

## What landed

Two read-only FastAPI endpoints for the DraftKings-grade betting intelligence phase.

### `GET /teams/{team_id}/batting`

Query params:

- `as_of=YYYY-MM-DD` required
- `window=season|l20|l10|l5`, default `l10`

Returns team batting counters and rates computed from `player_game_logs`:

- AVG / OBP / SLG / OPS
- ISO
- K% / BB%
- HR, SB, H, 2B, 3B, BB, K, HBP, SF
- `estimated_woba` using static linear weights
- `unsupported.handedness_splits` note

### `GET /pitchers/{pitcher_id}/advanced`

Query params:

- `as_of=YYYY-MM-DD` required
- `window=season|l20|l10|l5|last_5_starts|last_10_starts`, default `last_5_starts`

Returns pitcher aggregates computed from `pitcher_game_logs`:

- ERA
- FIP with fixed MVP constant `3.10`
- BABIP approximation
- WHIP
- K% / BB%
- K/9, BB/9, HR/9
- average pitches per start
- pitcher `throws` when the `players` table is seeded
- `unsupported.strand_rate` and `unsupported.left_right_splits` notes

## Important limitations

True pitcher L/R splits are not available yet. The MVP schema stores player identity handedness (`players.bats`, `players.throws`) but does not store batter-handedness outcomes per plate appearance.

True strand rate is also not available yet because the MVP pitching logs do not store baserunner, LOB, inherited-runner, or play-by-play state.

## Verification

- `pytest`: 51 passed
- `frontend npm run lint`: passed
- `frontend npm run build`: passed
