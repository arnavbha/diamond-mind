"use client";

import React, { useId, useRef } from "react";

/**
 * Tabs — accessible tablist for track-record (Performance · CLV · Calibration)
 * and game-detail-panel (Matchup · Pitching · Bullpen · Model · Beat-the-Book).
 * Roving-tabindex keyboard nav (←/→/Home/End). Presentational: parent owns the
 * active value + panel content.
 */
export type TabItem = {
  value: string;
  label: React.ReactNode;
};

export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  style,
}: {
  items: TabItem[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    onChange(items[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="infield-divider"
      style={{ display: "flex", gap: "var(--sp-1)", ...style }}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${baseId}-tab-${item.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={`${baseId}-panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            style={{
              minHeight: "44px",
              padding: "0 var(--sp-3)",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${active ? "var(--clay)" : "transparent"}`,
              color: active ? "var(--text)" : "var(--text-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              fontWeight: active ? "var(--weight-bold)" : "var(--weight-medium)",
              letterSpacing: "var(--tracking-label)",
              textTransform: "uppercase",
              cursor: "pointer",
              marginBottom: "-1px",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * TabPanel — the region a tab controls. Render conditionally; wire `tabValue` to
 * the same value passed to <Tabs> so aria-controls/labelledby line up. The
 * `baseId` must match — use <TabsRegion> below if you want it handled for you.
 */
export function TabPanel({
  baseId,
  tabValue,
  active,
  children,
}: {
  baseId: string;
  tabValue: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${tabValue}`}
      aria-labelledby={`${baseId}-tab-${tabValue}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
