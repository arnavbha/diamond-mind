"use client";

import React from "react";

/**
 * SectionHeader — wraps the old .section-label with the .infield-divider clay
 * accent and standardized uppercase label tracking. Optional right-aligned
 * action slot (controls, counts).
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
          fontSize: "var(--fs-caption)",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
        }}
      >
        {children}
      </Heading>
      {action != null && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
