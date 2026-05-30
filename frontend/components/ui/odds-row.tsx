"use client";

import React from "react";
import { oddsColor, HOLD_COLOR } from "@/lib/visual-tokens";

/**
 * OddsRow / OddsTable — a fixed 2-column odds/fair table (replaces the wrapping
 * flexWrap odds row on the slate). Odds-sign coloring is NEUTRAL (--odds-plus /
 * --odds-minus); --hold orange is reserved for vig/hold% only.
 */

/** Format an american-odds number (+150 / −120). null → em dash. */
export function fmtAmerican(odds: number | null | undefined): string {
  if (odds == null) return "—";
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

/** A single offered/fair odds value with neutral sign color and the .num style. */
export function OddsValue({
  odds,
  muted = false,
  style,
}: {
  odds: number | null | undefined;
  muted?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="num"
      style={{
        color: odds == null ? "var(--text-muted)" : muted ? "var(--text-2)" : oddsColor(odds),
        fontWeight: "var(--weight-semibold)",
        ...style,
      }}
    >
      {fmtAmerican(odds)}
    </span>
  );
}

export type OddsRowItem = {
  label: React.ReactNode;
  /** Offered (book) odds. */
  offered?: number | null;
  /** Fair (vig-free) odds. Omit the column entirely if no fair line. */
  fair?: number | null;
};

/**
 * OddsTable — labeled rows with an Offered column and an optional Fair column.
 * Set `showFair={false}` to honor the both-sides-only fair-line rule when only
 * one side has a fair price.
 */
export function OddsTable({
  rows,
  showFair = true,
  holdPct,
  style,
}: {
  rows: OddsRowItem[];
  showFair?: boolean;
  /** Book hold/vig %, rendered in the reserved --hold orange. */
  holdPct?: number | null;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", ...style }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: showFair ? "1fr auto auto" : "1fr auto",
          gap: "var(--sp-2) var(--sp-4)",
          alignItems: "baseline",
        }}
      >
        <span style={headStyle} />
        <span style={headStyle}>Offered</span>
        {showFair && <span style={headStyle}>Fair</span>}
        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{r.label}</span>
            <OddsValue odds={r.offered} />
            {showFair && <OddsValue odds={r.fair} muted />}
          </React.Fragment>
        ))}
      </div>
      {holdPct != null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: "var(--sp-1)",
            paddingTop: "var(--sp-1)",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <span style={headStyle}>Hold</span>
          <span className="num" style={{ color: HOLD_COLOR, fontWeight: "var(--weight-semibold)" }}>
            {(holdPct * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

const headStyle: React.CSSProperties = {
  fontSize: "var(--fs-caption)",
  letterSpacing: "var(--tracking-label)",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  textAlign: "right",
};
