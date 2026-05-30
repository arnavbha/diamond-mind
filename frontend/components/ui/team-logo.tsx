"use client";

import React, { useState } from "react";
import { teamLogoUrl } from "@/lib/team-logos";

/**
 * TeamLogo — dedupes the 3 redefinitions (page/picks/game-detail-panel). Reads
 * the ESPN CDN URL from lib/team-logos. Falls back to the abbreviation text if
 * the image fails (never a broken-image glyph).
 */
export function TeamLogo({
  abbr,
  size = 24,
  showAbbr = false,
  style,
}: {
  abbr: string;
  size?: number;
  /** Render the abbreviation text alongside the mark. */
  showAbbr?: boolean;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  // teamLogoUrl ships fixed CDN sizes; pick the smallest >= our render size.
  const cdnSize: 40 | 60 | 80 | 120 = size <= 40 ? 40 : size <= 60 ? 60 : size <= 80 ? 80 : 120;

  const mark = failed ? (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--r-full)",
        background: "var(--surface-2)",
        color: "var(--text-2)",
        fontFamily: "var(--font-mono)",
        fontSize: Math.max(9, size * 0.36),
        fontWeight: "var(--weight-bold)",
      }}
    >
      {abbr.slice(0, 3)}
    </span>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={teamLogoUrl(abbr, cdnSize)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ display: "block", objectFit: "contain" }}
    />
  );

  if (!showAbbr) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", ...style }} title={abbr}>
        {mark}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", ...style }}>
      {mark}
      <span className="num" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text)" }}>
        {abbr}
      </span>
    </span>
  );
}
