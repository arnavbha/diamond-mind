"use client";

import React from "react";

/**
 * StatCell / StatTile — uppercase caption label + .num value, optional semantic
 * color and an explain-tooltip slot. Unifies SummaryStat, HudChip, .data-row,
 * and SummaryGroup stats.
 *
 * Presentational: pass a preformatted `value`. Use `color` for semantic emphasis
 * (e.g. from SemanticValue or tierColor).
 */
type StatCellProps = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Color for the value (semantic emphasis). Defaults to --text. */
  color?: string;
  /** Right-of-label slot — typically an ExplainTooltip trigger. */
  explain?: React.ReactNode;
  /** Visual size: tile = boxed HUD chip; row = label/value baseline row. */
  variant?: "tile" | "plain" | "row";
  /** Value type scale: stat (18px HUD) | data (14px) | body (13px). */
  emphasis?: "stat" | "data" | "body";
  sub?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

const FS: Record<NonNullable<StatCellProps["emphasis"]>, string> = {
  stat: "var(--fs-stat)",
  data: "var(--fs-data)",
  body: "var(--fs-body)",
};

function Label({ children, explain }: { children: React.ReactNode; explain?: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-1)",
        fontSize: "var(--fs-caption)",
        letterSpacing: "var(--tracking-label)",
        textTransform: "uppercase",
        color: "var(--text-2)",
      }}
    >
      {children}
      {explain}
    </span>
  );
}

export function StatCell({
  label,
  value,
  color = "var(--text)",
  explain,
  variant = "tile",
  emphasis = "stat",
  sub,
  className,
  style,
}: StatCellProps) {
  if (variant === "row") {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "var(--sp-3)",
          padding: "var(--sp-1) 0",
          borderBottom: "1px solid var(--border)",
          ...style,
        }}
      >
        <Label explain={explain}>{label}</Label>
        <span className="num" style={{ color, fontWeight: "var(--weight-semibold)", fontSize: FS[emphasis] }}>
          {value}
        </span>
      </div>
    );
  }

  const boxed = variant === "tile";
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-1)",
        minWidth: 0,
        ...(boxed
          ? {
              padding: "var(--sp-2) var(--sp-3)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
            }
          : {}),
        ...style,
      }}
    >
      <Label explain={explain}>{label}</Label>
      <span
        className="num"
        style={{ color, fontWeight: "var(--weight-bold)", fontSize: FS[emphasis], lineHeight: "var(--lh-tight)" }}
      >
        {value}
      </span>
      {sub != null && (
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>{sub}</span>
      )}
    </div>
  );
}

/**
 * StatGroup — responsive row of StatCells. Wraps; min column width keeps them
 * legible on phones.
 */
export function StatGroup({
  children,
  min = "120px",
  style,
}: {
  children: React.ReactNode;
  min?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))`,
        gap: "var(--sp-2)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
