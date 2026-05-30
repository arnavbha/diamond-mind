"use client";

import { useState, useEffect, useRef } from "react";
import { api, todayET, getAdminToken } from "@/lib/api";
import AdminGate from "@/components/AdminGate";

type SettleResult = { date: string; settled: number; skipped_not_final: number; skipped_no_score: number; bets: { bet_id: number; game: string; market: string; selection: string; result: string; score: string; units_returned: number }[] };

const today = todayET();

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
  const pollRef = useRef<NodeJS.Timeout | null>(null);

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
    pollRef.current = setInterval(async () => {
      try {
        const data = await api.adminIngestionStatus(jobId, 200);
        if (!data) return;
        setStatus(data.status);
        setLogs(data.log_tail);
        setTotalLines(data.log_lines_total);
        setError(data.error);
        if (data.status === "done" || data.status === "error") {
          setRunning(false);
          clearInterval(pollRef.current!);
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
      const data = await api.trackerAutoSettle(date) as SettleResult | null;
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
      ? "var(--green)"
      : status === "error"
        ? "var(--red)"
        : status === "running"
          ? "var(--amber)"
          : "var(--text-2)";

  const panelStyle: React.CSSProperties = {
    background: "var(--surface)",
    border: "1px solid var(--border-2)",
    borderRadius: "8px",
    padding: "20px",
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-display)",
    fontSize: "16px",
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: "12px",
  };
  const bodyStyle: React.CSSProperties = {
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    color: "var(--text-2)",
    marginBottom: "16px",
    lineHeight: 1.6,
  };
  const buttonStyle = (active: boolean, accent: string): React.CSSProperties => ({
    padding: "7px 16px",
    borderRadius: "6px",
    border: "1px solid var(--border-2)",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    fontWeight: 600,
    cursor: active ? "pointer" : "not-allowed",
    background: active ? accent : "var(--surface-2)",
    color: active ? "#0d1117" : "var(--text-3)",
    transition: "background 0.12s, color 0.12s",
  });
  const errorBoxStyle: React.CSSProperties = {
    background: "var(--red-dim)",
    border: "1px solid var(--red)",
    borderRadius: "6px",
    padding: "12px",
    color: "var(--red)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    marginBottom: "12px",
  };
  const consoleStyle: React.CSSProperties = {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    padding: "12px",
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    color: "var(--text)",
    lineHeight: "20px",
  };

  return (
    <div>
      <div style={{ maxWidth: "896px", margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "4px" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 800, color: "var(--text)", textTransform: "uppercase", letterSpacing: "-0.01em" }}>Admin</h1>
          <AdminGate onUnlocked={() => setUnlocked(true)} />
        </div>
        <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-2)", marginBottom: "24px" }}>
          Server-side operations — these run on the Render VM, not your local machine.
        </p>

        {/* Ingestion panel */}
        <div style={panelStyle}>
          <h2 style={labelStyle}>Run Pregame Ingestion</h2>
          <p style={bodyStyle}>
            Fetches teams, rosters, box scores, and recomputes all form windows for the
            selected date. Runs server-side — no local DB connection needed.
          </p>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--border-2)",
                borderRadius: "6px",
                padding: "6px 12px",
                fontFamily: "var(--font-mono)",
                fontSize: "13px",
                color: "var(--text)",
                outline: "none",
              }}
              disabled={running}
            />
            <button
              onClick={handleRunIngestion}
              disabled={running || !unlocked}
              style={buttonStyle(!running && unlocked, "var(--blue)")}
            >
              {running ? "Running…" : "Run Ingestion"}
            </button>
            {status && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: statusColor }}>
                {status}
                {jobId && <span style={{ color: "var(--text-3)", marginLeft: "8px" }}>({jobId})</span>}
              </span>
            )}
          </div>

          {error && <div style={errorBoxStyle}>{error}</div>}

          {logs.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-3)" }}>
                  Log output ({totalLines} lines total, showing last {logs.length})
                </span>
              </div>
              <div
                ref={logRef}
                style={{ ...consoleStyle, height: "384px", overflowY: "auto" }}
              >
                {logs.map((line, i) => (
                  <div key={i} style={line.includes("ERROR") || line.includes("WARNING") ? { color: "var(--amber)" } : undefined}>
                    {line}
                  </div>
                ))}
                {running && (
                  <div style={{ color: "var(--text-3)", marginTop: "4px" }} className="animate-pulse">▌</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Settle bets panel */}
        <div style={{ ...panelStyle, marginTop: "16px" }}>
          <h2 style={labelStyle}>Settle Bets</h2>
          <p style={bodyStyle}>
            Resolves all unsettled bets for the selected date using final scores.
            Only settles games with status&nbsp;<code style={{ color: "var(--text)" }}>Final</code>.
          </p>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--text-2)" }}>{date}</span>
            <button
              onClick={handleAutoSettle}
              disabled={settling || !unlocked}
              style={buttonStyle(!settling && unlocked, "var(--green)")}
            >
              {settling ? "Settling…" : "Settle Bets"}
            </button>
          </div>

          {settleError && <div style={errorBoxStyle}>{settleError}</div>}

          {settleResult && (
            <div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-2)", marginBottom: "8px" }}>
                Settled <span style={{ color: "var(--green)", fontWeight: 600 }}>{settleResult.settled}</span> bet(s)
                {settleResult.skipped_not_final > 0 && <span style={{ marginLeft: "8px", color: "var(--text-3)" }}>· {settleResult.skipped_not_final} not Final</span>}
                {settleResult.skipped_no_score > 0 && <span style={{ marginLeft: "8px", color: "var(--text-3)" }}>· {settleResult.skipped_no_score} missing score</span>}
              </div>
              {settleResult.bets.length > 0 && (
                <div style={consoleStyle}>
                  {settleResult.bets.map((b) => (
                    <div key={b.bet_id} style={{ color: b.result === "WIN" ? "var(--green)" : b.result === "LOSS" ? "var(--red)" : "var(--text-2)" }}>
                      #{b.bet_id} {b.game} {b.market} {b.selection} → {b.result} ({b.score}) {b.units_returned > 0 ? "+" : ""}{b.units_returned.toFixed(2)}u
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
