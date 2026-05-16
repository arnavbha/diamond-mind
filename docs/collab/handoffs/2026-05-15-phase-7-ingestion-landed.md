# Handoff: Phase 7 — MLB Stats API Ingestion

**From:** Track A (Arnav)
**To:** Track B (Jack)
**Date:** 2026-05-15

## What landed

`app/ingestion/mlb_stats_api.py` is live. 49 tests green.

### New module: `app/ingestion/mlb_stats_api.py`

**MLBStatsClient** — injectable httpx wrapper. Endpoints covered:
- `fetch_schedule(date)` → schedule + probable pitchers
- `fetch_teams()` → all active MLB teams
- `fetch_roster(team_id)` → 40-man roster
- `fetch_player(player_id)` → full player detail (bats/throws/position)
- `fetch_boxscore(game_pk)` → completed game stats
- `fetch_live(game_pk)` → live feed (available but not yet parsed)

**Parse helpers** (pure, no DB, easy to unit test):
- `parse_schedule(payload)` → list of `_ScheduledGame`
- `parse_teams(payload)` → list of dicts
- `parse_roster(payload)` → list of dicts
- `parse_player_detail(payload)` → dict
- `parse_boxscore(payload, game_pk, game_date)` → `(batters, pitchers, home_stats, away_stats)`

**High-level ingest functions** (session + client → DB):
- `ingest_teams(session, client)` — upserts all active teams
- `ingest_roster(session, client, team_id)` — upserts 40-man
- `ingest_player(session, client, player_id)` — upserts one player
- `ingest_schedule(session, client, date)` → list of game_pks
- `ingest_boxscore(session, client, game_pk, date)` — upserts team/player/pitcher logs

All upserts are **idempotent** — safe to re-run without duplicating rows.

### Model change: `Game` now has probable starter columns

```python
home_probable_starter_id: Optional[int]  # FK → players.id
away_probable_starter_id: Optional[int]  # FK → players.id
```

These are populated by `ingest_schedule()` when the API returns a probable pitcher.

## What this means for Track B

Your `GameContext` dataclass already has `home_probable_starter_id` / `away_probable_starter_id` optional fields. Once `ingest_schedule` runs daily, those will be populated from real API data — no change needed on your side.

The swap from fixtures to real data for `BullpenState` will come when `run_pregame_update.py` (Phase 11) wires everything together. For now, your fixture-based path is unchanged.

## What's next (Track A)

- Phase 11 (partial): `run_pregame_update.py` — orchestrates schedule fetch → box score ingestion → form window computation for the day
- `backfill_history.py` — seeds historical game logs from the API

## No action needed from Track B

Nothing in the contracts changed. Your tests should still be green.
