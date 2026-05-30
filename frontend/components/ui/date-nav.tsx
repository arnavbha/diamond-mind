"use client";

import React from "react";
import { todayET } from "@/lib/api";

/**
 * DateNav — the ←/→ date stepper duplicated across page/picks/report/
 * track-record/verify/tools. ET-aware (todayET). aria-labelled arrows, 44px
 * touch targets. Presentational: parent owns the date string + onChange.
 *
 * Date strings are ISO `YYYY-MM-DD` (the format api.* endpoints expect).
 */

/** Shift an ISO YYYY-MM-DD date by `days`, staying in calendar-date space. */
export function offsetDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function fmtLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function DateNav({
  value,
  onChange,
  /** Prevent stepping past todayET(). */
  maxToday = false,
  showToday = true,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  maxToday?: boolean;
  showToday?: boolean;
  style?: React.CSSProperties;
}) {
  const today = todayET();
  const atMax = maxToday && value >= today;

  const step = (days: number) => {
    const next = offsetDate(value, days);
    if (maxToday && next > today) return;
    onChange(next);
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", ...style }}>
      <ArrowButton dir="prev" onClick={() => step(-1)} />
      <span
        className="num"
        style={{
          minWidth: "11ch",
          textAlign: "center",
          fontSize: "var(--fs-data)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text)",
        }}
      >
        {fmtLabel(value)}
      </span>
      <ArrowButton dir="next" onClick={() => step(1)} disabled={atMax} />
      {showToday && value !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          style={{
            minHeight: "44px",
            padding: "0 var(--sp-2)",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)",
            color: "var(--text-2)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            letterSpacing: "var(--tracking-label)",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Today
        </button>
      )}
    </div>
  );
}

function ArrowButton({
  dir,
  onClick,
  disabled,
}: {
  dir: "prev" | "next";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous day" : "Next day"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "44px",
        minHeight: "44px",
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-sm)",
        color: disabled ? "var(--text-muted)" : "var(--text-2)",
        fontSize: "var(--fs-data)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {dir === "prev" ? "←" : "→"}
    </button>
  );
}

/**
 * DateField — a native date input styled to the system, for jump-to-date. ET
 * default via todayET(). Wraps a real <input type="date"> (keyboard + a11y).
 */
export function DateField({
  value,
  onChange,
  max,
  "aria-label": ariaLabel = "Select date",
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  max?: string;
  "aria-label"?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type="date"
      value={value}
      max={max}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      style={{
        minHeight: "44px",
        padding: "0 var(--sp-3)",
        background: "var(--surface-inset)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-sm)",
        color: "var(--text)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-body)",
        colorScheme: "dark",
        ...style,
      }}
    />
  );
}
