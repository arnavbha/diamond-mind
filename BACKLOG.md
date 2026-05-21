# Post-Slate Backlog

Changes and improvements to make after today's slate (2026-05-16) is complete.

---

## Model Fixes

### ~~Rebalance bullpen vs SP component weights~~ ✅ Done 2026-05-17
**Context:** KC @ STL — model picked KC (STRONG LEAN) because STL bullpen vulnerability (74/100)
outweighed STL's clear SP edge (Leahy FIP 4.74 vs Cameron 5.38). STL won 4-2.
**Fix applied:**
- Lowered `BULLPEN_VULN_SCALE` 0.0012 → 0.0009 (global 25% reduction)
- Added SP dominance gate: if either starter FIP < 4.0, bullpen weight × 0.55
- KC@STL ratio now 2.3x (was 4x). Ace starts flip ratio to 0.6x (SP dominates)

---

## Infrastructure

### Auto-settle postgame picks
Run a postgame script that fetches final scores from the MLB API and automatically
settles all pending BetRecords. Currently manual.

### Calibration reporting
Once enough settled results exist, add an endpoint/page showing:
- Win rate by tier (STRONG LEAN vs LEAN)
- ROI by market (ML vs O/U)
- Which component scores correlate with actual wins

---

## LLM-assisted "intangibles" / contextual signals

**Question raised 2026-05-20:** can we add an LLM-generated metric for things
not captured by box-score data — pitcher coming back from IL, layoff effects,
clubhouse situations, manager comments on workload, etc.?

**Verdict:** feasible and cheap, but "sentiment analysis" is the wrong framing.
Generic vibes are noise and get priced into the line before first pitch.
What pays is **structured context signals** that aren't trivially scrape-able.

### Phase A — boring data, no LLM (do first)
Build `app/features/intangibles.py`:
- `days_since_il_return` (from MLB roster transactions)
- `pitch_count_last_7_days`
- `is_short_rest_start` (boolean, days_rest < 5)
- `days_since_last_appearance` (relievers / hitters)

Wire as features into `analysis_builder.py`. Backtest with
`app/betting/backtest.py`. Keep only if hit-rate lift ≥ 2% on big sample.
Est: ~6 hours CC. Cost: $0.

### Phase B — narrow LLM extraction (only if Phase A shows lift in this area)
Daily scrape of ~5 beat-writer RSS/sitemap sources per team. LLM prompt
extracts STRUCTURED JSON only:
```json
{
  "pitcher_X_return_from_injury": {"value": bool, "quote": "..."},
  "workload_concern_score": {"value": int, "quote": "..."},
  "lineup_changes_announced": [...]
}
```
Hard rule: every claim requires a `quote` field from source text. Reject
hallucination by validating quote substring-matches source. Use Claude Haiku
or GPT-4o-mini. Cache per-player-per-day.

Cost: ~$30–50/month.
Est: ~12 hours CC.

### Phase C — line-movement comparison (months)
Pair our intangible signal with sportsbook line moves. Find spots where
our signal is bigger than the market move. That's where the edge lives.
Long research project. Requires months of paired data.

### Smart alternative variant
**LLM as hallucination detector, not opinion generator.** Have it read
recent news + line moves + our model's prediction. If model says
"STRONG LEAN OVER" but news says "starting pitcher unavailable, AAA debut"
— flag the disconnect and downgrade the tier. Adds a safety layer to
existing recommendations rather than a new feature.

### What to NOT build
- Generic team "sentiment" / "hot streak" narrative — `pythag_win_pct`
  already captures this from runs scored/allowed.
- Anything that can't be backtested. If you can't measure it, you can't
  trust it.

### Traps to remember
1. **Lookahead bias** — every scraped article needs a timestamp; only
   feed articles strictly before first pitch.
2. **Already priced in** — by game time, Vegas has eaten 90% of public
   news. Our edge is in the gap between our signal magnitude and the
   line's reaction.
3. **Calibration** — LLM "confidence" means nothing without ground truth.
   Need backtested track record to trust any predictive number it emits.

### Next step
Revisit 2026-05-21. If green-lit: write a Track A handoff for the
roster-transaction + pitch-count features. Track B can sketch how the
model layer consumes them.

---

## Notes

Add notes here during the day as games play out.

