"use client";

import React from "react";

/**
 * DataTable / CardStack — a responsive table that becomes a true card-list on
 * mobile (replaces the tracker's fragile ::before data-label CSS hack and the
 * 9-col grid). Table on desktop, card list below the breakpoint.
 *
 * Generic over the row type. Each column supplies a header label and a cell
 * renderer; the SAME renderer is reused in both the desktop row and the mobile
 * card so NO column (incl CLV chip / admin actions) is lost on mobile.
 *
 * The responsiveness is intrinsic via CSS (the .data-table-* classes set up in
 * globals.css / Tailwind by later rounds); to stay self-contained here we render
 * both layouts and toggle them with a CSS-var-driven media wrapper. Until those
 * classes exist, the desktop grid + mobile cards are both present and the page
 * round wires the breakpoint. Presentational only.
 */
export type Column<T> = {
  /** Stable key. */
  key: string;
  /** Header / mobile data-label. */
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Desktop grid track (e.g. "1fr", "auto", "80px"). */
  width?: string;
  /** Right-align the cell (numbers). */
  align?: "left" | "right" | "center";
  /** Hide this column's label in the mobile card (e.g. a full-width selection). */
  hideMobileLabel?: boolean;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  /** Optional per-row className (e.g. bet-result-win left accent). */
  rowClassName?: (row: T, index: number) => string | undefined;
  /** Optional per-row click handler. */
  onRowClick?: (row: T, index: number) => void;
  caption?: string;
  empty?: React.ReactNode;
  style?: React.CSSProperties;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  onRowClick,
  caption,
  empty,
  style,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty != null) {
    return <>{empty}</>;
  }

  const gridTemplate = columns.map((c) => c.width ?? "1fr").join(" ");

  return (
    <div className="data-table" style={style}>
      {caption && (
        <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {caption}
        </span>
      )}

      {/* ── Desktop: CSS grid header + rows ── */}
      <div className="data-table-desktop" role="table" aria-label={caption}>
        <div
          role="row"
          className="data-table-head"
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate,
            gap: "var(--sp-3)",
            padding: "var(--sp-2) var(--sp-4)",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {columns.map((c) => (
            <span
              key={c.key}
              role="columnheader"
              style={{
                fontSize: "var(--fs-caption)",
                letterSpacing: "var(--tracking-label)",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                textAlign: c.align ?? "left",
              }}
            >
              {c.header}
            </span>
          ))}
        </div>
        {rows.map((row, i) => (
          <div
            key={rowKey(row, i)}
            role="row"
            className={["data-table-row", rowClassName?.(row, i)].filter(Boolean).join(" ")}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: gridTemplate,
              gap: "var(--sp-3)",
              padding: "var(--sp-2) var(--sp-4)",
              alignItems: "center",
              borderBottom: "1px solid var(--border)",
              cursor: onRowClick ? "pointer" : undefined,
            }}
          >
            {columns.map((c) => (
              <span
                key={c.key}
                role="cell"
                style={{ textAlign: c.align ?? "left", minWidth: 0 }}
              >
                {c.cell(row, i)}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* ── Mobile: real card list (every column becomes a labeled row) ──
          NOTE: do NOT set `display` inline here. The desktop/mobile toggle lives
          in globals.css (.data-table-desktop / .data-table-mobile media query);
          an inline `display:flex` would beat that class at every width, so BOTH
          layouts rendered at once → every row shown twice on desktop. Layout
          props that only matter once visible (flex-direction/gap) stay inline. */}
      <div className="data-table-mobile" style={{ flexDirection: "column", gap: "var(--sp-2)" }}>
        {rows.map((row, i) => (
          <div
            key={rowKey(row, i)}
            className={rowClassName?.(row, i)}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-1)",
              padding: "var(--sp-3) var(--sp-4)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              cursor: onRowClick ? "pointer" : undefined,
            }}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "var(--sp-3)",
                }}
              >
                {!c.hideMobileLabel && (
                  <span
                    style={{
                      fontSize: "var(--fs-caption)",
                      letterSpacing: "var(--tracking-label)",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    {c.header}
                  </span>
                )}
                <span style={{ minWidth: 0, textAlign: "right" }}>{c.cell(row, i)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
