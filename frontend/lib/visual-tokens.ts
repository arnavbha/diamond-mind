/**
 * visual-tokens — single typed source of truth for the design-system palette,
 * tier/heat/odds color maps, and the raw hex values that WebGL/canvas surfaces
 * (DotGrid, dither) need to read (they cannot consume CSS custom properties).
 *
 * CSS custom properties (the `var(--…)` strings exported here) are defined at
 * runtime in frontend/app/globals.css (bucket B0). This module mirrors those
 * names so TS and CSS share one vocabulary. Prefer the `var(--…)` token strings
 * for anything rendered into the DOM; use the raw `*_HEX` constants ONLY for
 * canvas/WebGL props that cannot resolve CSS variables.
 *
 * Verification-not-picks: tier meanings are LOCKED. Do not relabel.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Semantic palette — CSS var() references (preferred for DOM rendering).
 * Meanings are locked per the redesign spec.
 * ────────────────────────────────────────────────────────────────────────── */
export const palette = {
  // surfaces / structure
  bg: "var(--bg)",
  surface: "var(--surface)",
  surface2: "var(--surface-2)",
  surface3: "var(--surface-3)",
  surfaceInset: "var(--surface-inset)",
  borderSubtle: "var(--border-subtle)",
  border: "var(--border)",
  borderStrong: "var(--border-strong)",
  borderFocus: "var(--border-focus)",

  // text
  text: "var(--text)",
  text2: "var(--text-2)",
  textMuted: "var(--text-muted)",
  text3: "var(--text-3)",

  // semantic (locked)
  pos: "var(--pos)",
  posDim: "var(--pos-dim)",
  neg: "var(--neg)",
  negDim: "var(--neg-dim)",
  lean: "var(--lean)",
  leanDim: "var(--lean-dim)",
  warn: "var(--warn)",
  hold: "var(--hold)",
  purple: "var(--purple)",

  // baseball identity (thin accent thread — NEVER data color)
  grass: "var(--grass)",
  grassDim: "var(--grass-dim)",
  clay: "var(--clay)",
  clayDim: "var(--clay-dim)",
} as const;

export type PaletteToken = (typeof palette)[keyof typeof palette];

/* ────────────────────────────────────────────────────────────────────────────
 * Tier → color (LOCKED). STRONG LEAN→pos, LEAN→lean, PASS→text-2,
 * AVOID→neg, NEED MORE INFO→warn. Single-sourced; replaces the scattered
 * tierColor / tierBarColor redefinitions across pages.
 * ────────────────────────────────────────────────────────────────────────── */
export type Tier =
  | "STRONG LEAN"
  | "LEAN"
  | "PASS"
  | "AVOID"
  | "NEED MORE INFO";

export const TIER_COLOR: Record<Tier, string> = {
  "STRONG LEAN": palette.pos,
  LEAN: palette.lean,
  PASS: palette.text2,
  AVOID: palette.neg,
  "NEED MORE INFO": palette.warn,
};

/** Dim/background companion for a tier (tints, glows). */
export const TIER_DIM: Record<Tier, string> = {
  "STRONG LEAN": palette.posDim,
  LEAN: palette.leanDim,
  PASS: palette.surface3,
  AVOID: palette.negDim,
  "NEED MORE INFO": palette.surface3,
};

/**
 * Resolve a tier color from an arbitrary string (case/space tolerant).
 * Unknown tiers fall back to the neutral PASS color so nothing renders broken.
 */
export function tierColor(tier: string | null | undefined): string {
  const key = normalizeTier(tier);
  return key ? TIER_COLOR[key] : palette.text2;
}

export function tierDim(tier: string | null | undefined): string {
  const key = normalizeTier(tier);
  return key ? TIER_DIM[key] : palette.surface3;
}

/** Normalize a free-form tier string to a known Tier, or null. */
export function normalizeTier(tier: string | null | undefined): Tier | null {
  if (!tier) return null;
  const t = tier.trim().toUpperCase();
  if (t === "STRONG LEAN") return "STRONG LEAN";
  if (t === "LEAN") return "LEAN";
  if (t === "PASS") return "PASS";
  if (t === "AVOID") return "AVOID";
  if (t === "NEED MORE INFO") return "NEED MORE INFO";
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Heat ramp — a CONTINUOUS gauge (vulnerability, calibration error). Distinct
 * intent from win/loss so a red gauge never reads as "loss". low→pos, mid→warn,
 * high→neg.
 * ────────────────────────────────────────────────────────────────────────── */
export const HEAT = {
  low: "var(--heat-low)",
  mid: "var(--heat-mid)",
  high: "var(--heat-high)",
} as const;

/**
 * Map a normalized intensity (0..1, where 1 = most intense / "hottest") to a
 * heat-ramp color token. Used by VulnBar and calibration-error gauges.
 * Thresholds: <0.34 low, <0.67 mid, else high.
 */
export function heatColor(intensity: number): string {
  const t = clamp01(intensity);
  if (t < 0.34) return HEAT.low;
  if (t < 0.67) return HEAT.mid;
  return HEAT.high;
}

/**
 * Heat color for a raw value within an explicit [min,max] domain. Higher raw
 * value = hotter by default; pass invert=true when LOWER is hotter.
 */
export function heatColorFor(
  value: number,
  min: number,
  max: number,
  invert = false
): string {
  const span = max - min || 1;
  let t = (value - min) / span;
  if (invert) t = 1 - t;
  return heatColor(t);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Odds-sign colors — NEUTRAL by mandate. Odds sign must NOT borrow semantic
 * amber/blue (those are reserved for caution / informational). These lean on
 * text weight, not meaning.
 * ────────────────────────────────────────────────────────────────────────── */
export const ODDS_COLOR = {
  plus: "var(--odds-plus)",
  minus: "var(--odds-minus)",
} as const;

/** Neutral color for an american-odds value (underdog + vs favorite −). */
export function oddsColor(american: number | null | undefined): string {
  if (american == null) return palette.text2;
  return american >= 0 ? ODDS_COLOR.plus : ODDS_COLOR.minus;
}

/** --hold orange is the ONLY place vig/hold% friction is colored. */
export const HOLD_COLOR = palette.hold;

/* ────────────────────────────────────────────────────────────────────────────
 * Sign / threshold semantics — shared by SemanticValue and friends.
 * +EV/win/ROI>=0/units>=0 → pos; negatives → neg; flat/neutral → text-2.
 * win% uses the 0.524 breakeven (−110 vig) threshold.
 * ────────────────────────────────────────────────────────────────────────── */
export const WIN_RATE_BREAKEVEN = 0.524;

export type SignKind = "pos" | "neg" | "neutral";

export function signOf(
  value: number,
  opts: { threshold?: number; neutralAt?: number } = {}
): SignKind {
  const { threshold = 0, neutralAt } = opts;
  if (neutralAt != null && value === neutralAt) return "neutral";
  if (value > threshold) return "pos";
  if (value < threshold) return "neg";
  return "neutral";
}

/** Resolve a sign kind to its palette token. */
export function signColor(kind: SignKind): string {
  if (kind === "pos") return palette.pos;
  if (kind === "neg") return palette.neg;
  return palette.text2;
}

/** Convenience: color for a signed value vs a threshold. */
export function semanticColor(
  value: number,
  opts: { threshold?: number; neutralAt?: number } = {}
): string {
  return signColor(signOf(value, opts));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Result badge colors — W / L / P paired (never color-alone; the consuming
 * component must also render the label).
 * ────────────────────────────────────────────────────────────────────────── */
export const RESULT_COLOR = {
  WIN: palette.pos,
  LOSS: palette.neg,
  PUSH: palette.text2,
  PENDING: palette.warn,
} as const;

export type ResultKey = keyof typeof RESULT_COLOR;

/* ────────────────────────────────────────────────────────────────────────────
 * Raw hex — ONLY for canvas/WebGL props (DotGrid, dither) that cannot read CSS
 * variables. Keep in sync with globals.css :root. Prefer var() tokens elsewhere.
 * ────────────────────────────────────────────────────────────────────────── */
export const HEX = {
  bg: "#080C10",
  surface: "#0D1117",
  surface2: "#161B22",
  surface3: "#1C2330",
  pos: "#3FB950",
  neg: "#F85149",
  lean: "#58A6FF",
  warn: "#D29922",
  hold: "#F0883E",
  purple: "#BC8CFF",
  grass: "#1A6B2A",
  clay: "#B5651D",
} as const;

/** Normalized [r,g,b] in 0..1 (the form OGL/three shaders expect). */
export type RgbTriplet = [number, number, number];

export function hexToRgb01(hex: string): RgbTriplet {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16
  );
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Picks-page dither accent (the green grain), now routed through the module. */
export const PICKS_DITHER_COLOR: RgbTriplet = hexToRgb01(HEX.pos);

/* ── small shared util ───────────────────────────────────────────────────── */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
