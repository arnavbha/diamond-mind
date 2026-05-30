"use client";

import type { LiveState } from "@/lib/api";

// Self-contained relative-time formatter (do NOT import from app/page.tsx).
function defaultRelTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

const IN_PROGRESS = new Set(["in_progress", "live", "In Progress", "InProgress"]);

function isInProgress(status: string): boolean {
  if (IN_PROGRESS.has(status)) return true;
  return status.toLowerCase().replace(/[\s_]/g, "") === "inprogress"
    || status.toLowerCase() === "live"
    || status.toLowerCase() === "inprogress";
}

interface LiveAlertProps {
  live: LiveState | null;
  /** Optional relative-time formatter; falls back to a local one. */
  relTime?: (iso: string | null) => string;
}

/**
 * Per-card live MONITORING block. Verification, not a pick.
 * Renders nothing unless the game is in progress.
 */
export function LiveAlert({ live, relTime = defaultRelTime }: LiveAlertProps) {
  // No live row, or game is not actually in progress -> render nothing.
  if (!live || !live.is_live || !isInProgress(live.status)) return null;

  const stale = live.stale === true;
  const rel = relTime(live.captured_at);
  const freshness = stale
    ? `stale · last update ${rel || "—"}`
    : `updated ${rel || "—"}`;

  // In progress but no alert fired -> small muted monitoring line.
  if (!live.alert) {
    return (
      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--text-3)",
          opacity: stale ? 0.5 : 1,
        }}
      >
        Live: monitoring · No live signal · {freshness}
      </div>
    );
  }

  const a = live.alert;
  const winPct = Math.round(a.pregame_win_prob * 100);
  // a.detail may already be fully composed by the backend; prefer it, else build.
  const detailLine = a.detail
    ? a.detail
    : `Pregame model: ${a.pregame_lean} ${winPct}% (${a.pregame_tier})`;

  return (
    <div
      style={{
        marginTop: 8,
        border: "1px solid var(--amber, #d29922)",
        borderRadius: 4,
        background: "rgba(210,153,34,0.06)",
        padding: "8px 10px",
        opacity: stale ? 0.5 : 1,
      }}
    >
      {/* line 1 — bold headline */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--text)",
          lineHeight: 1.3,
        }}
      >
        {a.headline}
      </div>

      {/* line 2 — muted detail */}
      <div
        style={{
          fontSize: 10.5,
          color: "var(--text-2)",
          marginTop: 3,
          lineHeight: 1.4,
        }}
      >
        {detailLine}
      </div>

      {/* line 3 — neutral-grey "not a pick" pill */}
      <div
        style={{
          display: "inline-block",
          marginTop: 6,
          fontSize: 8.5,
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-3)",
          background: "var(--surface-2, rgba(255,255,255,0.04))",
          border: "1px solid var(--border)",
          borderRadius: 3,
          padding: "2px 6px",
        }}
      >
        {a.label || "Monitoring alert — not a pick"}
      </div>

      {/* line 4 — right-aligned freshness */}
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          color: "var(--text-3)",
          textAlign: "right",
          marginTop: 4,
        }}
      >
        {freshness}
      </div>
    </div>
  );
}

export default LiveAlert;
