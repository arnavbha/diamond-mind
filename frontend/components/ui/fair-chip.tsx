"use client";

import React from "react";
import { HOLD_COLOR } from "@/lib/visual-tokens";
import { OddsValue } from "./odds-row";

/**
 * FairChip — a compact "offered vs fair (+ hold)" readout for a single market
 * side. Preserves the both-sides-only fair-line rule: when a fair price is
 * unavailable, render the offered price and an honest "no fair line" note —
 * NEVER fabricate a fair number.
 *
 * --hold orange is reserved here for the vig/hold% friction.
 */
type FairChipProps = {
  label: React.ReactNode;
  offered?: number | null;
  /** Vig-free fair odds; null when not both-sides available. */
  fair?: number | null;
  /** Book hold/vig %, rendered in --hold orange. */
  holdPct?: number | null;
  style?: React.CSSProperties;
};

export function FairChip({ label, offered, fair, holdPct, style }: FairChipProps) {
  const hasFair = fair != null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-1)",
        padding: "var(--sp-2) var(--sp-3)",
        background: "var(--surface-inset)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r-sm)",
        minWidth: 0,
        ...style,
      }}
    >
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
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sp-3)" }}>
        <span style={{ display: "inline-flex", flexDirection: "column" }}>
          <span style={miniLabel}>Offered</span>
          <OddsValue odds={offered} />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column" }}>
          <span style={miniLabel}>Fair</span>
          {hasFair ? (
            <OddsValue odds={fair} muted />
          ) : (
            <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>no fair line</span>
          )}
        </span>
        {holdPct != null && (
          <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: "auto" }}>
            <span style={miniLabel}>Hold</span>
            <span className="num" style={{ color: HOLD_COLOR, fontWeight: "var(--weight-semibold)" }}>
              {(holdPct * 100).toFixed(1)}%
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

const miniLabel: React.CSSProperties = {
  fontSize: "var(--fs-micro)",
  letterSpacing: "var(--tracking-label)",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};
