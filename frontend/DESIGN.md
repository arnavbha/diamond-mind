# Diamond Mind — Design System (source of truth)

One-line aesthetic direction: **a refined "quant terminal" stadium scoreboard —
dark instrument panel, box-score grids, stencil display numerals, with a
restrained grass-green / clay-amber field accent on the existing GitHub-dark base.**

This is an *extension* of an already-shipped house style, not a redesign. The
anti-slop mandate here means: do not regress the existing terminal aesthetic
into a generic SaaS dashboard. No indigo/violet hero, no glassmorphism, no
emoji icons, no uniform `rounded-2xl`, no centered hero + 3 equal cards.

## 1. Palette (constrained, one confident accent system)

Inherited base (unchanged — do not touch):
- `--bg #080C10` · `--surface #0D1117` · `--surface-2 #161B22` · `--surface-3 #1C2330`
- `--border #1C2330` · `--border-2 #2D3748`
- text ramp: `--text #CDD9E5` → `--text-2 #768390` → `--text-3 #444C56`
- signal: `--blue #58A6FF` (market/flat), `--green #3FB950` (edge/Kelly),
  `--amber #D29922` (caution), `--red #F85149` (negative), `--purple #BC8CFF`

New baseball field accent (the one deliberate addition — earthy, not neon):
- `--grass #1A6B2A` — deep outfield green (structural accent: dividers, pills)
- `--clay #B5651D` — infield clay amber (the single hero accent on Track Record)
- `--grass-dim #0D3315` / `--clay-dim #3D1F08` — pill fills only

Rule: green/blue/red keep their existing *quant* meaning (edge, market, loss).
grass/clay are *identity* colors — used for chrome (dividers, watermark,
section accents, the Track Record P&L hero), never to encode a stat value.

## 2. Type scale (deliberate, not one-font-no-scale)

Two families, already loaded:
- `--font-mono` JetBrains Mono — all data, labels, tabular values (the voice
  of the product).
- `--font-display` Syne 700/800 — headlines and the new `--font-scoreboard`
  alias for big stencil numerals.

Display numeral treatment (new `.scoreboard-num`): Syne 800, `tabular-nums`,
`letter-spacing: -0.04em`. Used ONLY for headline figures (Brier, P&L total,
confidence %, Kelly %) so a number reads like a stadium scoreboard, not body
text. Everything else stays mono.

Step scale in use: 28/22/20 (page titles) · 15/13 (body+data) · 11/10/9
(labels, uppercase, `0.04–0.1em` tracking). No new arbitrary sizes.

## 3. Spacing & rhythm

Inherited 4px-ish rhythm kept: card padding 14–20px, section gaps 24px,
data-row padding 5–6px. New `.box-score-grid` enforces a real tabular rhythm
(6px 10px cells, ruled columns) so charts/tables read like an actual box score
rather than floating divs. `.infield-divider` replaces ad-hoc
`borderLeft: 2px solid` tier accents with a bottom rule + a 32px clay tab —
a deliberate, repeatable motif.

## 4. Baseball identity layer (refined, not kitsch)

- ~~`.diamond-watermark`~~ — **removed in the 2026-06-15 de-slop pass** (see §9).
  The single scanline texture (`body::before`) is now the *only* background
  decoration. Do not re-introduce full-page decorative layers.
- `.box-score-grid` — ruled grid header on `--surface-2`, the canonical layout
  for any tabular metric block.
- `.stat-pill-grass` / `.stat-pill-clay` — small uppercase status pills
  (10px/700/0.06em) for "ACCRUING", tier tags, etc.
- Scoreboard numerals for hero figures (see §2).
- No clip-art, no baseball emoji, no green felt gradients.

## 5. Motion (has a reason)

Reuse existing `fade-up` (entrance) and `fillBar` (value reveal). SVG charts
animate stroke/area in with a single `chartDraw` keyframe (250–600ms,
`cubic-bezier(0.16,1,0.3,1)`) — motion communicates "data populating", matching
the existing `duelGrow`. Respect `prefers-reduced-motion` (charts render at
final state, no animation).

## 6. Charts (hand-rolled SVG, zero new deps)

All five Track Record charts are inline `<svg viewBox>` with `role="img"` and
a descriptive `aria-label`. No recharts/d3/chart.js/etc. — that would be slop
*and* a dependency violation. Axes/ticks in mono 9px `--text-3`. Lines use the
quant palette (blue=flat, green=Kelly). Every chart has an explicit, designed
`.accruing-state` empty state — never a blank div, never a fabricated number
(hard project rule: no fake data).

## 7. Progressive disclosure

`ExplainTooltip` — inline `ⓘ` affordance, keyboard-focusable, click-outside
close, popover from `--surface-2`. Copy is the canonical `GLOSSARY` map (12
terms, exact spec copy, zero forbidden betting words). `GlossaryPanel` —
right drawer opened by a persistent `?` button at the right end of the nav,
sectioned (Quant Terms / Recommendation Tiers / Model Components).

## 8. Anti-slop self-audit (checked before done)

- [x] No indigo/violet/purple gradient hero — base is GitHub-dark; accent is earthy grass/clay
- [x] No glassmorphism — surfaces are flat panels with 1px rules
- [x] Not uniformly over-rounded — radii stay 3–6px as in the existing system
- [x] No emoji as icons or in headings — `ⓘ`/`?` glyphs and SVG only
- [x] Not centered-hero + 3 equal cards — box-score grids, asymmetric strips
- [x] Tailwind defaults unused — bespoke tokens, mono type, custom shadows
- [x] Real type scale + one confident accent (clay) + intentional rhythm
- [x] Charts are hand-rolled, every one has a designed empty state

## 9. De-slop pass (2026-06-15)

The terminal bones were strong but buried under decoration that read as
"vibe-coded." This pass subtracted, it did not redesign. Verified with the
impeccable detector: **0 anti-patterns** across `app/` + `components/`.

**Removed (do not re-add):**
- Background effect-soup. Deleted `DotGrid`, `NoiseOverlay`, `DitherHeader`
  (3 WebGL shader banners), `diamond-watermark`, and `liquid-chrome-bg`.
  The **scanline `body::before` is now the single signature texture.**
- Decorative motion. `DecryptedText` scramble on the nav wordmark (now plain
  text); per-card `spotlight-card` / `glare-card` / `potd-card` grain.
  Kept all *state* motion: `live-dot` pulse, `fillBar`, `chartDraw`, skeletons.
- Gradient text. `shiny-text` no longer uses `background-clip:text`; it is a
  solid `--green` + bold. (Absolute ban: gradient text.)
- Side-stripe borders (absolute ban). `border-left: 2–3px` colored accents on
  cards/rows/callouts are gone:
  - bet-result rows → flat even background tint (label carries meaning).
  - slate tier accents → full hairline ring (`box-shadow inset 0 0 0 1px`);
    PASS de-emphasised via opacity.
  - formula block, ErrorBanner, tools honesty callouts → full hairline border.

**Page headers:** the 3 dither banners became flat `.infield-divider` headers
(display h1 + mono meta) — keeps baseball identity, drops the canvas.

**Deliberately kept (NOT side-tabs):** `paddingLeft + borderLeft` blockquote /
caveat-note indents on prose (markdown blockquote, verify plugs, track-record
footnotes, quant explainer). The ban targets cards/callouts, not quotes.

## 10. Design overhaul — Abyssal Observatory (2026-06-15)

**Scene:** a serious bettor at 6am in a dark room, three hours before lineups
set, scanning edges across 8 games. Not here to be impressed — here to extract
information fast. The interface must feel like professional equipment: lit from
within the dark, every signal color sharp enough to read without a second look.

**Direction — Abyssal Observatory** (instrument-panel terminal). The prior
"quant terminal" bones were kept; this round pushed the base toward true
near-black so the chrome reads as equipment lit from within, and turned the
signal colors *louder* so STRONG-LEAN green / AVOID red pop from two feet like
LED indicators. Clay (`#C6701F`) is the **single identity trim** — measurement
brackets, the `infield-divider` tab, the active nav border, the wordmark
diamond. refero.design references that informed the move: dark trading/observatory
dashboards (pressurised near-black surfaces, ruled grids as structure, hot
single-hue signal accents), and instrument/console UIs (corner-bracket reticles,
tick-rule legends) — not the glassmorphic-SaaS or neon-cyberpunk dark themes.

**What changed, per layer:**

- **Tokens (prior agent — `globals.css`, do not re-touch):** base deepened to
  `--bg #05080B` (+ `--surface #0A0F15` / `-2 #11171F` / `-3 #1A222D`); signals
  hotter — `--green #34D399`, `--red #FF5C5C`, `--blue #5BB0FF`; field trim
  warmer — `--grass #2A8C3D`, `--clay #C6701F`. Wider label tracking
  (`--tracking-label .11em` / `--tracking-wide .16em`), bigger hierarchy jumps
  (`--fs-headline 1.625rem`, `--fs-hero 2.875rem`), sharper radii (cards `4px`,
  bars square). New `.slab` / reticle / `ruled-head` instrument chrome; glow
  tokens wired to tier cards. Scanline `body::before` preserved.

- **Components (this agent):** the component library was *already* fully
  token-driven from the B0 migration — every card/badge/bar/stat consumes the
  semantic `var(--…)` names, so the new token values cascaded automatically and
  needed no per-component rework. The targeted change was the nav: the active
  link's underline moved from `--blue` → **`--clay`** (the active-state trim is
  now the identity color, not the market-blue). `glossary-panel` tier swatches
  were single-sourced through `tierColor()` so the legend can never drift from
  the live tier palette.

- **Pages (this agent):** the `layout` wordmark gained a leading clay `◆` glyph
  and `--tracking-wide`. `verify` (the one page that predated the token
  migration) was aligned to the semantic vocabulary every other page already
  used — raw `--green/--red/--blue/--amber` → `--pos/--neg/--lean/--warn`, its
  verdict color single-sourced through `tierColor()`, decoration-only `--text-3`
  captions lifted to `--text-2` for legibility, and a clay `infield-divider`
  header. `tools` got the same clay header and its "read before sizing" caveat
  callout moved off the reserved `--hold` orange to a proper `--warn` border +
  `--amber-tint` wash. `edge`'s inline CLV link uses the semantic `--lean`.

**Kept from the prior system:** the whole B0 component library + `visual-tokens`
typed color maps (the single source of truth for tier/odds/result/heat colors);
the de-slop bans (no gradient text, no side-stripe accents, no effect-soup, one
scanline texture); `--purple` as ACE's identity hue; the `paddingLeft +
borderLeft` prose-indent exception. `lib/visual-tokens.ts` `HEX` (canvas-only
mirror of `:root`, currently unconsumed) was refreshed to the Abyssal values to
keep the documented "in sync with globals.css" contract honest.

**Verified:** impeccable detector **0 anti-patterns** across `app/` +
`components/`; `tsc --noEmit` clean. (`next lint` is removed in Next 16 — the
project lints via `eslint` flat config; this overhaul added no new findings over
the pre-existing baseline.)

