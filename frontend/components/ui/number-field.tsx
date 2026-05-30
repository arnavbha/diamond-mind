"use client";

import React, { useId } from "react";

/**
 * NumberField — a labeled numeric input deduping the NumField/DateField atoms
 * across verify/tools. Real <input>, 44px touch target, inline error slot that
 * distinguishes INVALID INPUT from a backend outage. Presentational: parent
 * owns value + validation.
 */
export function NumberField({
  label,
  value,
  onChange,
  error,
  hint,
  suffix,
  placeholder,
  min,
  max,
  step,
  inputMode = "decimal",
  explain,
  id: idProp,
  style,
}: {
  label: React.ReactNode;
  value: string | number;
  onChange: (raw: string) => void;
  /** Inline validation message (renders the field in the warn state). */
  error?: string | null;
  hint?: React.ReactNode;
  suffix?: React.ReactNode;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number | string;
  inputMode?: "decimal" | "numeric";
  /** Slot for an ExplainTooltip trigger. */
  explain?: React.ReactNode;
  id?: string;
  style?: React.CSSProperties;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errId = `${id}-err`;
  const hasError = !!error;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", minWidth: 0, ...style }}>
      <label
        htmlFor={id}
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
        {label}
        {explain}
      </label>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input
          id={id}
          type="number"
          inputMode={inputMode}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errId : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="num"
          style={{
            width: "100%",
            minHeight: "44px",
            padding: `0 ${suffix ? "var(--sp-6)" : "var(--sp-3)"} 0 var(--sp-3)`,
            background: "var(--surface-inset)",
            border: `1px solid ${hasError ? "var(--warn)" : "var(--border)"}`,
            borderRadius: "var(--r-sm)",
            color: "var(--text)",
            fontSize: "var(--fs-data)",
            fontWeight: "var(--weight-semibold)",
          }}
        />
        {suffix != null && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: "var(--sp-3)",
              color: "var(--text-muted)",
              fontSize: "var(--fs-meta)",
              pointerEvents: "none",
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      {hasError ? (
        <span id={errId} role="alert" style={{ fontSize: "var(--fs-meta)", color: "var(--warn)" }}>
          {error}
        </span>
      ) : hint != null ? (
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{hint}</span>
      ) : null}
    </div>
  );
}
