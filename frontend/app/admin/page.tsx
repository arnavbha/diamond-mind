"use client";

import { useState, useEffect, useRef } from "react";
import { api, todayET, getAdminToken } from "@/lib/api";
import AdminGate from "@/components/AdminGate";
import { Panel, Button, ConfirmButton, DateField, ErrorBanner } from "@/components/ui";

type SettleResult = {
  date: string;
  settled: number;
  skipped_not_final: number;
  skipped_no_score: number;
  bets: {
    bet_id: number;
    game: string;
    market: string;
    selection: string;
    result: string;
    score: string;
    units_returned: number;
  }[];
};

const today = todayET();

const consoleStyle: React.CSSProperties = {
  background: "var(--surface-inset)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--r-sm)",
  padding: "var(--sp-3)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-meta)",
  color: "var(--text)",
  lineHeight: "var(--lh-data)",
};

export default function AdminPage() {
  const [date, setDate] = useState(today);
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminToken()));
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalLines, setTotalLines] = useState(0);
  const [settling, setSettling] = useState(false);
  const [settleResult, setSettleResult] = useState<SettleResult | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Poll job status while running
  useEffect(() => {
    if (!jobId || status === "done" || status === "error") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const data = await api.adminIngestionStatus(jobId, 200);
        if (!data) return;
        setStatus(data.status);
        setLogs(data.log_tail);
        setTotalLines(data.log_lines_total);
        setError(data.error);
        if (data.status === "done" || data.status === "error") {
          setRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore transient fetch errors during polling
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, status]);

  async function handleRunIngestion() {
    setRunning(true);
    setLogs([]);
    setError(null);
    setStatus("queued");
    setJobId(null);
    try {
      const data = await api.adminRunIngestion(date);
      if (!data) throw new Error("No response from server");
      setJobId(data.job_id);
      setStatus(data.status);
    } catch (e: unknown) {
      setRunning(false);
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleAutoSettle() {
    setSettling(true);
    setSettleResult(null);
    setSettleError(null);
    try {
      const data = (await api.trackerAutoSettle(date)) as SettleResult | null;
      if (!data) throw new Error("No response from server");
      setSettleResult(data);
    } catch (e: unknown) {
      setSettleError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettling(false);
    }
  }

  const statusColor =
    status === "done"
      ? "var(--pos)"
      : status === "error"
        ? "var(--neg)"
        : status === "running"
          ? "var(--warn)"
          : "var(--text-2)";

  return (
    <div style={{ maxWidth: "896px", margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--sp-4)",
          marginBottom: "var(--sp-1)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display-serif)",
            fontSize: "var(--fs-headline)",
            fontWeight: "var(--weight-display)",
            color: "var(--text)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-num)",
            margin: 0,
          }}
        >
          Admin
        </h1>
        <AdminGate onUnlocked={() => setUnlocked(true)} />
      </div>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "var(--fs-body)",
          color: "var(--text-2)",
          marginBottom: "var(--sp-6)",
          lineHeight: "var(--lh-prose)",
        }}
      >
        Server-side operations — these run on the Render VM, not your local machine.
      </p>

      {/* Ingestion panel */}
      <Panel title="Run Pregame Ingestion">
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--fs-body)",
            color: "var(--text-2)",
            marginBottom: "var(--sp-4)",
            lineHeight: "var(--lh-prose)",
            marginTop: 0,
          }}
        >
          Fetches teams, rosters, box scores, and recomputes all form windows for the selected
          date. Runs server-side — no local DB connection needed.
        </p>

        <div
          style={{
            display: "flex",
            gap: "var(--sp-3)",
            alignItems: "center",
            marginBottom: "var(--sp-4)",
            flexWrap: "wrap",
          }}
        >
          <DateField
            value={date}
            onChange={setDate}
            aria-label="Ingestion date"
            style={running ? { opacity: 0.5, pointerEvents: "none" } : undefined}
          />
          <Button
            variant="primary"
            onClick={handleRunIngestion}
            disabled={running || !unlocked}
          >
            {running ? "Running…" : "Run Ingestion"}
          </Button>
          {status && (
            <span
              className="num"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)", color: statusColor }}
            >
              {status}
              {jobId && (
                <span style={{ color: "var(--text-muted)", marginLeft: "var(--sp-2)" }}>({jobId})</span>
              )}
            </span>
          )}
        </div>

        {error && <ErrorBanner kind="outage" title="Ingestion error" detail={error} style={{ marginBottom: "var(--sp-3)" }} />}

        {logs.length > 0 && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "var(--sp-1)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-caption)",
                  color: "var(--text-muted)",
                  letterSpacing: "var(--tracking-label)",
                  textTransform: "uppercase",
                }}
              >
                Log output ({totalLines} lines total, showing last {logs.length})
              </span>
            </div>
            <div ref={logRef} style={{ ...consoleStyle, height: "384px", overflowY: "auto" }}>
              {logs.map((line, i) => (
                <div
                  key={i}
                  style={
                    line.includes("ERROR") || line.includes("WARNING")
                      ? { color: "var(--warn)" }
                      : undefined
                  }
                >
                  {line}
                </div>
              ))}
              {running && (
                <div style={{ color: "var(--text-muted)", marginTop: "var(--sp-1)" }} className="animate-pulse">
                  ▌
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* Settle bets panel */}
      <Panel title="Settle Bets" style={{ marginTop: "var(--sp-4)" }}>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--fs-body)",
            color: "var(--text-2)",
            marginBottom: "var(--sp-4)",
            lineHeight: "var(--lh-prose)",
            marginTop: 0,
          }}
        >
          Resolves all unsettled bets for the selected date using final scores. Only settles games
          with status&nbsp;<code style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>Final</code>.
        </p>

        <div
          style={{
            display: "flex",
            gap: "var(--sp-3)",
            alignItems: "center",
            marginBottom: "var(--sp-4)",
            flexWrap: "wrap",
          }}
        >
          <span
            className="num"
            style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}
          >
            {date}
          </span>
          <ConfirmButton
            size="md"
            onConfirm={handleAutoSettle}
            disabled={settling || !unlocked}
            confirmLabel="Confirm settle?"
            style={{ color: "var(--pos)", borderColor: "var(--border)" }}
          >
            {settling ? "Settling…" : "Settle Bets"}
          </ConfirmButton>
        </div>

        {settleError && (
          <ErrorBanner kind="outage" title="Settle error" detail={settleError} style={{ marginBottom: "var(--sp-3)" }} />
        )}

        {settleResult && (
          <div>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "var(--fs-body)",
                color: "var(--text-2)",
                marginBottom: "var(--sp-2)",
              }}
            >
              Settled{" "}
              <span className="num" style={{ color: "var(--pos)", fontWeight: "var(--weight-semibold)" }}>
                {settleResult.settled}
              </span>{" "}
              bet(s)
              {settleResult.skipped_not_final > 0 && (
                <span style={{ marginLeft: "var(--sp-2)", color: "var(--text-muted)" }}>
                  · {settleResult.skipped_not_final} not Final
                </span>
              )}
              {settleResult.skipped_no_score > 0 && (
                <span style={{ marginLeft: "var(--sp-2)", color: "var(--text-muted)" }}>
                  · {settleResult.skipped_no_score} missing score
                </span>
              )}
            </div>
            {settleResult.bets.length > 0 && (
              <div style={consoleStyle}>
                {settleResult.bets.map((b) => (
                  <div
                    key={b.bet_id}
                    style={{
                      color:
                        b.result === "WIN"
                          ? "var(--pos)"
                          : b.result === "LOSS"
                            ? "var(--neg)"
                            : "var(--text-2)",
                    }}
                  >
                    #{b.bet_id} {b.game} {b.market} {b.selection} → {b.result} ({b.score}){" "}
                    {b.units_returned > 0 ? "+" : ""}
                    {b.units_returned.toFixed(2)}u
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
