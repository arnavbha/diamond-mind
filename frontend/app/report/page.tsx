"use client";

import { useState } from "react";
import { api, todayET } from "@/lib/api";
import {
  Card,
  Button,
  Markdown,
  DateNav,
  DateField,
  ErrorBanner,
  EmptyState,
  SkeletonText,
  Loading,
} from "@/components/ui";

const METHOD_STYLE: Record<string, { label: string; color: string }> = {
  sdk: { label: "AI · SDK", color: "var(--pos)" },
  cli: { label: "AI · CLI", color: "var(--warn)" },
  none: { label: "Raw", color: "var(--text-2)" },
};

type View = "polished" | "raw";

export default function ReportPage() {
  const today = todayET();
  const [date, setDate] = useState(today);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [polishedText, setPolishedText] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>("polished");

  async function loadReport(d = date) {
    setMarkdown(null);
    setPolishedText(null);
    setMethod(null);
    setError(null);
    setView("polished");
    setLoading(true);
    try {
      const md = await api.reportMarkdown(d);
      if (md === null) throw new Error("not found");
      setMarkdown(md);
    } catch {
      setError(`No report for ${d}. Run: python scripts/run_daily_report.py`);
    } finally {
      setLoading(false);
    }
  }

  function changeDate(d: string) {
    setDate(d);
    loadReport(d);
  }

  async function polish() {
    if (!markdown) return;
    setPolishing(true);
    const result = await api.polishReport(markdown);
    if (!result) {
      setError("Polish failed — check ANTHROPIC_API_KEY or Claude CLI install");
    } else {
      setPolishedText(result.markdown);
      setMethod(result.method);
      setView("polished");
    }
    setPolishing(false);
  }

  async function copyText() {
    const text = displayText;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // displayText follows the explicit raw/polished toggle when both exist.
  const hasPolish = polishedText != null;
  const displayText =
    hasPolish && view === "polished" ? polishedText : markdown;
  const methodMeta = method ? METHOD_STYLE[method] ?? METHOD_STYLE.none : null;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "var(--sp-3)",
          marginBottom: "var(--sp-6)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-display)",
              fontSize: "var(--fs-headline)",
              letterSpacing: "var(--tracking-num)",
              margin: 0,
              color: "var(--text)",
            }}
          >
            Daily Report
          </h1>
          <div
            className="num"
            style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: "var(--sp-1)" }}
          >
            {date}
          </div>
        </div>

        {/* Date nav (auto-loads on change) */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <DateNav value={date} onChange={changeDate} maxToday />
          <DateField value={date} max={today} onChange={changeDate} aria-label="Report date" />
        </div>
      </div>

      {/* Controls row */}
      {markdown && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-2)",
            marginBottom: "var(--sp-4)",
            flexWrap: "wrap",
          }}
        >
          {/* Raw / Polished toggle — only meaningful once polish exists */}
          {hasPolish && (
            <div
              role="group"
              aria-label="Report view"
              style={{
                display: "inline-flex",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                overflow: "hidden",
              }}
            >
              {(["polished", "raw"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  style={{
                    minHeight: "44px",
                    padding: "0 var(--sp-3)",
                    border: "none",
                    background: view === v ? "var(--surface-2)" : "transparent",
                    color: view === v ? "var(--text)" : "var(--text-2)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-meta)",
                    letterSpacing: "var(--tracking-label)",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          <Button variant="primary" size="sm" onClick={polish} disabled={polishing}>
            {polishing ? "Polishing…" : hasPolish ? "Re-polish" : "Polish with Claude"}
          </Button>

          {methodMeta && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-meta)",
                color: methodMeta.color,
                border: `1px solid ${methodMeta.color}`,
                borderRadius: "var(--r-sm)",
                padding: "var(--sp-1) var(--sp-2)",
                letterSpacing: "var(--tracking-label)",
              }}
            >
              {methodMeta.label}
            </span>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={copyText}
            style={{ marginLeft: "auto", color: copied ? "var(--pos)" : undefined }}
          >
            {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      )}

      {error && (
        <ErrorBanner
          kind="outage"
          title={`No report for ${date}`}
          detail={error}
          style={{ marginBottom: "var(--sp-4)" }}
        />
      )}

      {loading && (
        <Loading label="Loading report">
          <Card>
            <SkeletonText lines={8} />
          </Card>
        </Loading>
      )}

      {!loading && displayText && (
        <Card variant="well" style={{ padding: "var(--sp-6)" }}>
          <Markdown source={displayText} />
        </Card>
      )}

      {!loading && !error && !displayText && (
        <EmptyState
          title="No report loaded"
          detail="Use ← → or pick a date to load that day's report. Reports are generated by the daily pipeline."
        />
      )}
    </div>
  );
}
