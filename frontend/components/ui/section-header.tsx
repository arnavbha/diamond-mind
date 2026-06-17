"use client";

import React from "react";

/**
 * SectionHeader — a quiet structural subhead on the .infield-divider clay
 * accent, with an optional right-aligned action slot (controls, counts).
 *
 * Sentence case (not uppercase): caps + wide tracking are reserved for the loud
 * tier — nav, page titles, badges. Section heads repeat all over the app
 * ("Bankroll math", "Devig engine", "Actionable"), so shouting them too made
 * every screen feel uniformly intense; this keeps them legible but subordinate.
 */
export function SectionHeader({
  children,
  action,
  divider = true,
  as = "h2",
  style,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  /** Render the clay infield-divider underline (default true). */
  divider?: boolean;
  as?: React.ElementType;
  style?: React.CSSProperties;
}) {
  const Heading = as as React.ElementType;
  return (
    <div
      className={divider ? "infield-divider" : undefined}
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "var(--sp-3)",
        paddingBottom: divider ? "var(--sp-2)" : 0,
        marginBottom: "var(--sp-3)",
        ...style,
      }}
    >
      <Heading
        style={{
          margin: 0,
          fontSize: "var(--fs-meta)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "normal",
          textTransform: "none",
          color: "var(--text-2)",
        }}
      >
        {children}
      </Heading>
      {action != null && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
