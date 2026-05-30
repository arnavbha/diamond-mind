"use client";

import React from "react";
import { tierColor, RESULT_COLOR, type ResultKey } from "@/lib/visual-tokens";

/**
 * Badge family — single tier→color source (replaces tierColor / tierBarColor /
 * .game-card-tier-* / .tier-badge dupes). COLOR IS NEVER THE SOLE SIGNAL:
 * every badge renders a text label alongside its color.
 */

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  color?: string;
  /** Solid = filled tint bg; outline = hairline border (default). */
  fill?: boolean;
};

function Badge({ color = "var(--text-2)", fill = false, style, children, ...rest }: BadgeProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-1)",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-caption)",
        fontWeight: "var(--weight-bold)",
        letterSpacing: "var(--tracking-label)",
        textTransform: "uppercase",
        lineHeight: 1,
        padding: "var(--sp-1) var(--sp-2)",
        borderRadius: "var(--r-sm)",
        color,
        border: "1px solid currentColor",
        background: fill ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}

/**
 * TierBadge — the verification-not-picks recommendation label. Tier text is
 * the signal; color reinforces it. Pass the raw tier string; unknown tiers
 * render neutral.
 */
export function TierBadge({
  tier,
  fill = false,
  ...rest
}: { tier: string; fill?: boolean } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <Badge color={tierColor(tier)} fill={fill} {...rest}>
      {tier}
    </Badge>
  );
}

/**
 * ResultBadge — W / L / P (/ pending) outcome. Label always present so
 * colorblind users get the signal without color.
 */
const RESULT_LABEL: Record<string, { key: ResultKey; text: string }> = {
  WIN: { key: "WIN", text: "W" },
  LOSS: { key: "LOSS", text: "L" },
  PUSH: { key: "PUSH", text: "P" },
};

export function ResultBadge({
  result,
  ...rest
}: { result: "WIN" | "LOSS" | "PUSH" | null } & React.HTMLAttributes<HTMLSpanElement>) {
  if (!result) {
    return (
      <Badge color={RESULT_COLOR.PENDING} {...rest}>
        Pending
      </Badge>
    );
  }
  const meta = RESULT_LABEL[result];
  return (
    <Badge color={RESULT_COLOR[meta.key]} fill {...rest}>
      {meta.text}
    </Badge>
  );
}

/**
 * StatusBadge — game lifecycle (LIVE / FINAL / scheduled / pending). LIVE pairs
 * the color with a pulsing .live-dot (the one allowed infinite animation) so
 * "live" reads without relying on color alone.
 */
export function StatusBadge({
  status,
  ...rest
}: { status: "LIVE" | "FINAL" | "SCHEDULED" | "PENDING" | string } & React.HTMLAttributes<HTMLSpanElement>) {
  const s = status.toUpperCase();
  if (s === "LIVE" || s === "IN_PROGRESS") {
    return (
      <Badge color="var(--pos)" {...rest}>
        <span className="live-dot" aria-hidden="true" />
        Live
      </Badge>
    );
  }
  if (s === "FINAL") {
    return (
      <Badge color="var(--text-2)" {...rest}>
        Final
      </Badge>
    );
  }
  if (s === "PENDING") {
    return (
      <Badge color="var(--warn)" {...rest}>
        Pending
      </Badge>
    );
  }
  return (
    <Badge color="var(--text-2)" {...rest}>
      {status}
    </Badge>
  );
}

export { Badge };
