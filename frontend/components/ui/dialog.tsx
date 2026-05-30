"use client";

import React, { useEffect, useRef, useCallback, useId } from "react";

/**
 * Dialog / Drawer — accessible modal: role=dialog + aria-modal + focus trap +
 * focus restore + Escape-to-close. Wraps the slate GameDetailPanel drawer and
 * the picks TrackModal. Presentational shell; parent owns open state + content.
 *
 * `variant`:
 *  - center  centered modal card (TrackModal)
 *  - drawer  right-side sheet; full-screen on phones (GameDetailPanel)
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  variant = "center",
  labelledBy,
  initialFocusRef,
  children,
  footer,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  variant?: "center" | "drawer";
  /** id of an external heading if `title` isn't used. */
  labelledBy?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number | string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Capture the element to restore focus to, on open.
  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
    }
  }, [open]);

  // Initial focus + restore on close.
  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    const target =
      initialFocusRef?.current ??
      node?.querySelector<HTMLElement>(FOCUSABLE) ??
      node;
    target?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  // Escape + focus trap.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  if (!open) return null;

  const isDrawer = variant === "drawer";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-drawer)" as unknown as number,
        display: "flex",
        alignItems: isDrawer ? "stretch" : "center",
        justifyContent: isDrawer ? "flex-end" : "center",
        padding: isDrawer ? 0 : "var(--sp-4)",
      }}
    >
      {/* scrim */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, background: "var(--scrim-2)" }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        onKeyDown={onKeyDown}
        tabIndex={-1}
        className="dialog-panel"
        style={{
          position: "relative",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: isDrawer ? 0 : "var(--r-lg)",
          boxShadow: "var(--shadow-pop)",
          width: width ?? (isDrawer ? "min(620px, 96vw)" : "min(480px, 94vw)"),
          maxHeight: isDrawer ? "100dvh" : "90dvh",
          height: isDrawer ? "100dvh" : undefined,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {title != null && (
          <div
            className="infield-divider"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--sp-3)",
              padding: "var(--sp-3) var(--sp-4)",
              flexShrink: 0,
            }}
          >
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: "var(--fs-data)",
                fontWeight: "var(--weight-bold)",
                color: "var(--text)",
              }}
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              style={{
                minWidth: "44px",
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                color: "var(--text-2)",
                fontSize: "var(--fs-data)",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", padding: "var(--sp-4)" }}>{children}</div>
        {footer != null && (
          <div
            style={{
              flexShrink: 0,
              padding: "var(--sp-3) var(--sp-4)",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "flex-end",
              gap: "var(--sp-2)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
