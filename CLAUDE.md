# diamond-mind — agent bootstrap

You are an AI agent (Claude, or otherwise) working on **diamond-mind**, an AI-native baseball intelligence system. **Arnav** owns this repo and drives all the work. You own the entire codebase — data platform, analysis, betting, reports, frontend — end to end. There is no second track to coordinate with or wait on. This file tells your agent how to get oriented at the start of every session.

## Read these in order before doing anything

1. **`docs/PROJECT_BRIEF.md`** — the full project vision, MVP scope, build phases, formulas (bullpen fatigue, vulnerability, betting math), data contracts, and behavior rules. This is the source of truth for *what* we're building and *how*.
2. **`docs/collab/decisions/`** — durable cross-cutting decisions (tooling, schema choices, naming). Skim once; don't relitigate. The rest of `docs/collab/` (tracks, interfaces, handoffs) is legacy from an earlier two-person split — treat it as historical reference, not as gating coordination. Don't block on it.

## Hard rules (from PROJECT_BRIEF.md, surfaced here so you can't miss them)

- **Database is the source of truth.** Obsidian is the human-readable memory layer, not canonical storage.
- **Deterministic logic first, LLM second.** The LLM interprets and writes; it never invents stats or replaces computed features.
- **No fake data.** If an API key is missing, stub the client and document it. Never fabricate values to make a report look complete.
- **Betting language: verification, not picks.** Use "Strong Lean / Lean / Pass / Avoid / Need More Info". Never "lock", "guaranteed", "hammer", "free money", "must bet".
- **The whole codebase is yours.** `app/ingestion/`, `app/models/`, `app/features/`, `app/betting/`, `app/reports/`, `app/obsidian/`, and `frontend/` — edit any of it directly when the work calls for it. No track scoping, no handoffs, no waiting on another agent.

## What to do when you finish a unit of work

1. Run tests. Report what passes and what's stubbed.
2. Don't push or merge without the human asking.

## Commit style

All commit messages must read as written by a human developer. Never include AI attribution footers (`Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`, or similar). Write concise imperative subject lines and plain-English body text. No sign-off lines, no automation markers.

## What gstack / other skills are for

The repo owner (Arnav) has gstack skills installed in Claude Code. They are **dev workflow tools only** — never add gstack as a runtime dependency. Skills like `/office-hours`, `/plan-eng-review`, `/review`, `/qa`, `/document-generate` are useful at phase boundaries. Don't invoke them unprompted.
