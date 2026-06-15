"use client";

import React from "react";

/**
 * States — EmptyState / ErrorBanner / Skeleton. Replaces the bare "Loading…"
 * jumps and centered-text empties. Skeleton variants match final card/chart
 * layouts so there is no layout shift (CLS) when real data arrives.
 */

/* ── EmptyState ──────────────────────────────────────────────────────────── */
export function EmptyState({
  title,
  detail,
  icon,
  action,
  style,
}: {
  title: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--sp-2)",
        padding: "var(--sp-8) var(--sp-4)",
        textAlign: "center",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        background: "var(--surface)",
        color: "var(--text-2)",
        ...style,
      }}
    >
      {icon != null && <div style={{ color: "var(--text-muted)" }}>{icon}</div>}
      <div style={{ fontSize: "var(--fs-data)", color: "var(--text)", fontWeight: "var(--weight-medium)" }}>
        {title}
      </div>
      {detail != null && (
        <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", maxWidth: "44ch" }}>{detail}</div>
      )}
      {action != null && <div style={{ marginTop: "var(--sp-2)" }}>{action}</div>}
    </div>
  );
}

/* ── ErrorBanner ─────────────────────────────────────────────────────────── */
/**
 * ErrorBanner — distinguishes a validation problem (caller input) from an
 * outage (backend down). `kind` drives the framing, not just the color.
 */
export function ErrorBanner({
  kind = "outage",
  title,
  detail,
  action,
  style,
}: {
  kind?: "validation" | "outage";
  title?: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const isValidation = kind === "validation";
  const color = isValidation ? "var(--warn)" : "var(--neg)";
  const heading = title ?? (isValidation ? "Check your input" : "Couldn't load data");
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-3)",
        padding: "var(--sp-3) var(--sp-4)",
        borderRadius: "var(--r-md)",
        border: `1px solid ${color}`,
        background: "var(--surface)",
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: "var(--weight-semibold)", color }}>{heading}</div>
        {detail != null && (
          <div style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}>{detail}</div>
        )}
      </div>
      {action != null && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

/* ── Skeleton ────────────────────────────────────────────────────────────── */
/**
 * Skeleton — shimmer placeholder. The `.skeleton` class (reduced-motion-aware)
 * lives in globals.css. Compose `lines` / `variant` to match final layouts.
 */
export function Skeleton({
  width = "100%",
  height = 12,
  radius = "var(--r-sm)",
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className="skeleton"
      style={{
        display: "block",
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

/** SkeletonText — N shimmer lines, last one short, to mimic a paragraph. */
export function SkeletonText({ lines = 3, style }: { lines?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", ...style }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={12} />
      ))}
    </div>
  );
}

/**
 * SkeletonCard — a card-shaped placeholder matching the standard Card layout so
 * slate/pick lists don't jump when data arrives.
 */
export function SkeletonCard({ lines = 3, style }: { lines?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        padding: "var(--sp-3) var(--sp-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-3)",
        ...style,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--sp-3)" }}>
        <Skeleton width="40%" height={14} />
        <Skeleton width="64px" height={14} />
      </div>
      <SkeletonText lines={lines} />
    </div>
  );
}

/** Loading — accessible busy region (announces, no bare "Loading…" text jump). */
export function Loading({ label = "Loading", children }: { label?: string; children?: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {label}
      </span>
      {children ?? <SkeletonCard />}
    </div>
  );
}
