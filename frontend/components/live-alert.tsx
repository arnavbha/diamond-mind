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
          marginTop: "var(--sp-2)",
          fontSize: "var(--fs-caption)",
          fontFamily: "var(--font-mono)",
          color: "var(--text-2)",
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
        marginTop: "var(--sp-2)",
        border: "1px solid var(--warn)",
        borderRadius: "var(--r-sm)",
        background: "var(--amber-tint)",
        padding: "var(--sp-2) var(--sp-3)",
        opacity: stale ? 0.5 : 1,
      }}
    >
      {/* line 1 — bold headline */}
      <div
        style={{
          fontSize: "var(--fs-body)",
          fontWeight: "var(--weight-bold)",
          color: "var(--text)",
          lineHeight: "var(--lh-data)",
        }}
      >
        {a.headline}
      </div>

      {/* line 2 — muted detail */}
      <div
        style={{
          fontSize: "var(--fs-caption)",
          color: "var(--text-2)",
          marginTop: "var(--sp-1)",
          lineHeight: "var(--lh-data)",
        }}
      >
        {detailLine}
      </div>

      {/* line 3 — neutral-grey "not a pick" pill */}
      <div
        style={{
          display: "inline-block",
          marginTop: "var(--sp-1)",
          fontSize: "var(--fs-micro)",
          fontFamily: "var(--font-mono)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-sm)",
          padding: "var(--sp-1) var(--sp-2)",
        }}
      >
        {a.label || "Monitoring alert — not a pick"}
      </div>

      {/* line 4 — right-aligned freshness */}
      <div
        style={{
          fontSize: "var(--fs-micro)",
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          textAlign: "right",
          marginTop: "var(--sp-1)",
        }}
      >
        {freshness}
      </div>
    </div>
  );
}

export default LiveAlert;
