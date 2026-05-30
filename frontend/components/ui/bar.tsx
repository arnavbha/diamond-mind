"use client";

import React from "react";
import { heatColor } from "@/lib/visual-tokens";

/**
 * Bar — the canonical track+fill primitive. Track = --surface-3; fill color via
 * the --fill-color var (semantic or heat). Unifies stat-bar, duel, VulnBar,
 * ClvSliceBars, Brier bar, tier-hit chart bars.
 *
 * Fill animation reuses the global .stat-bar-fill keyframe (fillBar) which is
 * reduced-motion-aware in globals.css (rests at --fill, never frozen at 0).
 * Set `animate={false}` to render at the final width with no motion.
 */
type BarProps = {
  /** 0..1 fraction of the track to fill. */
  value: number;
  /** Fill color token. Ignored when `heat` is set. */
  color?: string;
  /** Color the fill via the heat ramp using `value` as intensity. */
  heat?: boolean;
  height?: number | string;
  animate?: boolean;
  /** Stagger delay (ms) for data-entry confirmation. */
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
  "aria-label"?: string;
};

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function Bar({
  value,
  color = "var(--lean)",
  heat = false,
  height = 6,
  animate = true,
  delay = 0,
  className,
  style,
  "aria-label": ariaLabel,
}: BarProps) {
  const frac = clamp01(value);
  const fill = heat ? heatColor(frac) : color;
  const fillWidth = `${(frac * 100).toFixed(2)}%`;
  return (
    <div
      role={ariaLabel ? "meter" : undefined}
      aria-label={ariaLabel}
      aria-valuenow={ariaLabel ? Math.round(frac * 100) : undefined}
      aria-valuemin={ariaLabel ? 0 : undefined}
      aria-valuemax={ariaLabel ? 100 : undefined}
      className={className}
      style={{
        background: "var(--surface-3)",
        borderRadius: "var(--r-xs)",
        height: typeof height === "number" ? `${height}px` : height,
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        className={animate ? "stat-bar-fill" : undefined}
        style={
          {
            height: "100%",
            background: fill,
            borderRadius: "inherit",
            "--fill": fillWidth,
            "--delay": `${delay}ms`,
            width: animate ? 0 : fillWidth,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

/**
 * LabeledBar — a Bar with a leading label and trailing value, the common
 * stat-bar layout (FIP duel, vulnerability, tier-hit). Value text uses .num.
 */
export function LabeledBar({
  label,
  valueText,
  value,
  color,
  heat,
  delay,
  valueColor = "var(--text)",
}: {
  label: React.ReactNode;
  valueText?: React.ReactNode;
  value: number;
  color?: string;
  heat?: boolean;
  delay?: number;
  valueColor?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--sp-2)" }}>
        <span
          style={{
            fontSize: "var(--fs-caption)",
            letterSpacing: "var(--tracking-label)",
            textTransform: "uppercase",
            color: "var(--text-2)",
          }}
        >
          {label}
        </span>
        {valueText != null && (
          <span className="num" style={{ color: valueColor, fontWeight: "var(--weight-semibold)" }}>
            {valueText}
          </span>
        )}
      </div>
      <Bar
        value={value}
        color={color}
        heat={heat}
        delay={delay}
        aria-label={typeof label === "string" ? label : undefined}
      />
    </div>
  );
}
