"use client";

import React, { useState } from "react";

/**
 * Button — real <button> elements (replaces clickable <div>s and inline
 * <button style>). Focus-visible ring comes from the global :focus-visible rule
 * (B0); a 44px min touch target (WCAG 2.5.5 / iOS HIG) is enforced here.
 *
 * Variants:
 *  - primary  accent bg, dark text (NORMALIZE the off-palette color:#fff tools)
 *  - ghost    transparent, hairline border
 *  - track    ＋Track / Tracked✓ toggle (active = tracked)
 *  - danger   delete; pair with `confirm` for a two-tap guard
 */
export type ButtonVariant = "primary" | "ghost" | "track" | "danger";
export type ButtonSize = "sm" | "md";

type BaseProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** track variant: render the tracked (✓) state. */
  active?: boolean;
  /** Square icon-only button — REQUIRE an aria-label from the caller. */
  iconOnly?: boolean;
  type?: "button" | "submit" | "reset";
};

function variantStyle(variant: ButtonVariant, active: boolean): React.CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "var(--lean)",
        color: "var(--surface)",
        border: "1px solid var(--lean)",
      };
    case "track":
      return active
        ? {
            background: "var(--pos-dim)",
            color: "var(--pos)",
            border: "1px solid var(--pos)",
          }
        : {
            background: "transparent",
            color: "var(--text-2)",
            border: "1px solid var(--border)",
          };
    case "danger":
      return {
        background: "transparent",
        color: "var(--neg)",
        border: "1px solid var(--border)",
      };
    case "ghost":
    default:
      return {
        background: "transparent",
        color: "var(--text-2)",
        border: "1px solid var(--border)",
      };
  }
}

export function Button({
  variant = "ghost",
  size = "md",
  active = false,
  iconOnly = false,
  type = "button",
  className,
  style,
  children,
  ...rest
}: BaseProps) {
  const padY = size === "sm" ? "var(--sp-1)" : "var(--sp-2)";
  const padX = size === "sm" ? "var(--sp-2)" : "var(--sp-3)";
  return (
    <button
      type={type}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-2)",
        minHeight: "44px",
        minWidth: iconOnly ? "44px" : undefined,
        padding: iconOnly ? "0" : `${padY} ${padX}`,
        borderRadius: "var(--r-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-meta)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "var(--tracking-label)",
        lineHeight: "var(--lh-tight)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)",
        ...variantStyle(variant, active),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * TrackButton — ＋Track / Tracked✓ convenience wrapper over the track variant.
 * Presentational: parent owns the tracked state + onToggle wiring.
 */
export function TrackButton({
  tracked,
  onToggle,
  size = "sm",
  ...rest
}: {
  tracked: boolean;
  onToggle?: () => void;
  size?: ButtonSize;
} & Omit<BaseProps, "variant" | "active" | "children" | "onClick">) {
  return (
    <Button
      variant="track"
      active={tracked}
      size={size}
      aria-pressed={tracked}
      onClick={onToggle}
      {...rest}
    >
      {tracked ? "Tracked ✓" : "＋ Track"}
    </Button>
  );
}

/**
 * ConfirmButton — danger action with a two-tap confirm guard (delete). First
 * click arms ("Confirm?"); second within the window fires onConfirm. Blur or a
 * timeout disarms. Honesty: never a single-click destructive action.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm?",
  iconOnly = false,
  size = "sm",
  "aria-label": ariaLabel,
  ...rest
}: {
  onConfirm: () => void;
  confirmLabel?: React.ReactNode;
} & Omit<BaseProps, "onClick" | "variant" | "active">) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant="danger"
      size={size}
      iconOnly={iconOnly && !armed}
      aria-label={ariaLabel}
      style={armed ? { borderColor: "var(--neg)", color: "var(--neg)" } : undefined}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3000);
        }
      }}
      onBlur={() => setArmed(false)}
      {...rest}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
