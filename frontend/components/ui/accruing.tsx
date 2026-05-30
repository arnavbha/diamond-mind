"use client";

import React from "react";

/**
 * Accruing / Provisional — a first-class HONESTY primitive. Dashed border +
 * --text-muted caption signals "data is still accruing / coverage is partial".
 * Used by track-record coverage notes, ClvChip "no close", calibration
 * snapshot-coverage. It must NEVER look like an error (no red, no alarm).
 */
export function Accruing({
  children,
  note,
  sampleSize,
  inline = false,
  style,
}: {
  children?: React.ReactNode;
  /** Coverage/explanation caption (e.g. "no closing line captured"). */
  note?: React.ReactNode;
  /** Sample-size [n] shown in the --fs-micro style. */
  sampleSize?: number | string;
  /** Inline (chip) vs block (panel) presentation. */
  inline?: boolean;
  style?: React.CSSProperties;
}) {
  const sample = sampleSize != null ? <SampleSize n={sampleSize} /> : null;

  if (inline) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--sp-1)",
          padding: "var(--sp-1) var(--sp-2)",
          border: "1px dashed var(--border)",
          borderRadius: "var(--r-sm)",
          color: "var(--text-muted)",
          fontSize: "var(--fs-meta)",
          ...style,
        }}
      >
        {children ?? note}
        {sample}
      </span>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--sp-1)",
        padding: "var(--sp-6) var(--sp-4)",
        border: "1px dashed var(--border)",
        borderRadius: "var(--r-md)",
        textAlign: "center",
        color: "var(--text-muted)",
        fontSize: "var(--fs-body)",
        ...style,
      }}
    >
      {children}
      {note != null && <span>{note}</span>}
      {sample}
    </div>
  );
}

/**
 * SampleSize — the [n] sample-size affordance (--fs-micro, --text-muted). Pairs
 * with rates/CIs so a small-n figure reads as provisional, not authoritative.
 */
export function SampleSize({ n, style }: { n: number | string; style?: React.CSSProperties }) {
  return (
    <span
      className="num"
      style={{
        fontSize: "var(--fs-micro)",
        color: "var(--text-muted)",
        letterSpacing: "var(--tracking-num)",
        ...style,
      }}
    >
      [{n}]
    </span>
  );
}
