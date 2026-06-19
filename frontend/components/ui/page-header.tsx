"use client";

import React from "react";

/**
 * PageHeader — the canonical page-title block. Replaces the three hand-rolled
 * `.infield-divider` + inline <h1> headers (Slate, Picks, Tracker) that had
 * drifted apart in padding, tracking, and tab width. One component, one rhythm.
 *
 * Visual: a full-width header sitting on the `.infield-divider` measurement
 * bracket, here widened to a 48×3 clay tab (vs the 36×2 inline-section default)
 * so the top of the page reads as the heaviest legend mark on the screen.
 *
 *  - title    display serif (IBM Plex Serif 700), up to 2rem, uppercase, --text.
 *  - subtitle mono (--font-mono), --fs-meta, --text-2 (status / count / date line).
 *  - action   optional right-aligned slot (a button, a count chip, a control).
 */
export function PageHeader({
  title,
  subtitle,
  action,
  style,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <header
      className="infield-divider"
      style={{
        // Wider, taller clay tab than the inline-section default — the page's
        // primary measurement bracket.
        ["--divider-tab-w" as string]: "48px",
        ["--divider-tab-h" as string]: "3px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: "var(--sp-4)",
        flexWrap: "wrap",
        paddingBottom: "var(--sp-4)",
        marginBottom: "var(--sp-8)",
        ...style,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display-serif)",
            fontWeight: "var(--weight-display)",
            // Push past the shared --fs-headline (26px) toward the spec's 2rem
            // ceiling so the page title outranks every section header below it.
            fontSize: "clamp(var(--fs-headline), 4vw, 2rem)",
            lineHeight: "var(--lh-tight)",
            // Condensed caps are already narrow — keep tracking neutral (the prior
            // -0.02em was tuned for the wide Syne and crowds the condensed face).
            letterSpacing: "0",
            textTransform: "uppercase",
            color: "var(--text)",
          }}
        >
          {title}
        </h1>
        {subtitle != null && (
          <div
            className="num"
            style={{
              marginTop: "var(--sp-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              letterSpacing: "var(--tracking-num)",
              color: "var(--text-2)",
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-2)",
              flexWrap: "wrap",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {action != null && <div style={{ flexShrink: 0 }}>{action}</div>}
    </header>
  );
}
