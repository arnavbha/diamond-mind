"use client";

import React from "react";
import { semanticColor, WIN_RATE_BREAKEVEN } from "@/lib/visual-tokens";

/**
 * SemanticValue — wraps a number and picks --pos / --neg / --text-2 from its
 * sign and a threshold. Replaces the ~8 repeated threshold-color blocks (ClvChip,
 * P&L, ROI, units, win%). Renders with the .num utility (tabular mono).
 *
 * The component is display-only: pass a preformatted string in `display`, or a
 * raw `value` + optional formatter. Coloring is driven by `value` (or `colorBy`
 * when the displayed and the colored quantity differ).
 */
type Mode = "signed-zero" | "roi" | "units" | "clv" | "win-rate" | "raw";

type Props = {
  value: number;
  /** Preformatted text to show; falls back to a sensible default per mode. */
  display?: React.ReactNode;
  /** Color decision quantity if different from `value`. */
  colorBy?: number;
  mode?: Mode;
  /** Force a "+" on positive values (default true except raw). */
  showSign?: boolean;
  /** Decimal places for the default formatter. */
  digits?: number;
  /** Suffix appended to the default-formatted number (e.g. "u", "%"). */
  suffix?: string;
  className?: string;
  style?: React.CSSProperties;
};

function threshold(mode: Mode): number {
  // win-rate uses the −110 breakeven; everything else uses 0.
  return mode === "win-rate" ? WIN_RATE_BREAKEVEN : 0;
}

function defaultDisplay(value: number, mode: Mode, showSign: boolean, digits: number, suffix: string): string {
  const sign = showSign && value > 0 ? "+" : "";
  if (mode === "win-rate") return `${(value * 100).toFixed(digits)}${suffix || "%"}`;
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

export function SemanticValue({
  value,
  display,
  colorBy,
  mode = "signed-zero",
  showSign,
  digits = 2,
  suffix = "",
  className,
  style,
}: Props) {
  const sign = showSign ?? mode !== "raw";
  const colorVal = colorBy ?? value;
  const color =
    mode === "raw"
      ? "var(--text)"
      : semanticColor(colorVal, { threshold: threshold(mode) });
  return (
    <span
      className={["num", className].filter(Boolean).join(" ")}
      style={{ color, fontWeight: "var(--weight-semibold)", ...style }}
    >
      {display ?? defaultDisplay(value, mode, sign, digits, suffix)}
    </span>
  );
}
