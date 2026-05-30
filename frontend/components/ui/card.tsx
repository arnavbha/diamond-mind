"use client";

import React from "react";

/**
 * Card / Panel — the canonical surface primitive. Replaces the hundreds of
 * inline `border + radius + padding + surface` blocks and per-page hand-rolled
 * cards. Presentational and prop-driven; pages adopt it without changing data.
 *
 * Variants:
 *  - default     elev1 surface, hairline border, --r-md
 *  - strong-lean default + --glow-pos (actionable STRONG LEAN)
 *  - lean        default + --glow-lean
 *  - inset/well  recessed input/formula well (--surface-inset)
 *
 * Standard pad = var(--sp-3) var(--sp-4). Set `pad={false}` for bare content.
 */
export type CardVariant = "default" | "strong-lean" | "lean" | "inset" | "well";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: CardVariant;
  /** Apply the standard card padding (default true). */
  pad?: boolean;
  /** Subtle hover bg/border shift (state-feedback motion). */
  interactive?: boolean;
  as?: React.ElementType;
};

const STANDARD_PAD = "var(--sp-3) var(--sp-4)";

function variantStyle(variant: CardVariant): React.CSSProperties {
  switch (variant) {
    case "strong-lean":
      return { boxShadow: "var(--glow-pos)", borderColor: "var(--pos)" };
    case "lean":
      return { boxShadow: "var(--glow-lean)", borderColor: "var(--lean)" };
    case "inset":
    case "well":
      return { background: "var(--surface-inset)", borderColor: "var(--border-subtle)" };
    default:
      return {};
  }
}

export function Card({
  variant = "default",
  pad = true,
  interactive = false,
  as,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const Comp = (as ?? "div") as React.ElementType;
  return (
    <Comp
      className={[interactive ? "game-card" : "", className].filter(Boolean).join(" ")}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        padding: pad ? STANDARD_PAD : undefined,
        ...variantStyle(variant),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/**
 * Panel — a Card with an optional clay-accented header (the .infield-divider
 * thread). ChartFrame on track-record is a Panel. Body padding standard;
 * header sits above the divider.
 */
type PanelProps = Omit<CardProps, "title"> & {
  title?: React.ReactNode;
  /** Right-aligned header slot (tabs, controls, freshness chip). */
  action?: React.ReactNode;
};

export function Panel({
  title,
  action,
  variant = "default",
  pad = true,
  className,
  style,
  children,
  ...rest
}: PanelProps) {
  return (
    <Card variant={variant} pad={false} className={className} style={style} {...rest}>
      {(title || action) && (
        <div
          className="infield-divider"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            padding: "var(--sp-3) var(--sp-4)",
          }}
        >
          {typeof title === "string" ? (
            <span
              style={{
                fontSize: "var(--fs-caption)",
                fontWeight: "var(--weight-bold)",
                letterSpacing: "var(--tracking-label)",
                textTransform: "uppercase",
                color: "var(--text-2)",
              }}
            >
              {title}
            </span>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      <div style={{ padding: pad ? STANDARD_PAD : undefined }}>{children}</div>
    </Card>
  );
}
