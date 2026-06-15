"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, todayET, getAdminToken, type BetRecord, type TrackerSummary, type TrackerSummaryGroup } from "@/lib/api";
import AdminGate from "@/components/AdminGate";
import CountUp from "@/components/count-up";
import {
  Card,
  Button,
  ConfirmButton,
  TierBadge,
  ResultBadge,
  SemanticValue,
  Accruing,
  DataTable,
  EmptyState,
  ErrorBanner,
  Loading,
  Tabs,
  type Column,
  type TabItem,
} from "@/components/ui";
import { oddsColor } from "@/lib/visual-tokens";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtOdds(o: number): string {
  return o >= 0 ? `+${o}` : `${o}`;
}

// ── CLV chip ───────────────────────────────────────────────────────────────
// Closing-line value = did the picked-side price beat the market's close?
// Honest by construction: if no pre-first-pitch close was captured, we show
// "no close" — never a fabricated number. clv_pct is in prob-points.
const CLV_NO_CLOSE: ReadonlySet<string> = new Set([
  "no_close_captured",
  "no_first_pitch",
]);

function ClvChip({ bet }: { bet: BetRecord }) {
  // No close captured (or backend predates CLV) → honest placeholder, styled as
  // the first-class Accruing primitive (dashed border, --text-muted, never red).
  if (
    bet.clv_source == null ||
    bet.beat_close == null ||
    bet.clv_pct == null ||
    CLV_NO_CLOSE.has(bet.clv_source)
  ) {
    return (
      <span
        title={
          bet.clv_source === "no_first_pitch"
            ? "No scheduled first pitch on record — cannot define a closing line"
            : "No pre-first-pitch closing snapshot was captured for this market"
        }
        style={{ display: "inline-flex" }}
      >
        <Accruing inline note="no close" style={{ fontSize: "var(--fs-caption)" }} />
      </span>
    );
  }

  const beat = bet.beat_close === true;
  const col = beat ? "var(--pos)" : "var(--neg)";
  const pct = (bet.clv_pct * 100).toFixed(1);
  const sign = bet.clv_pct >= 0 ? "+" : "";
  return (
    <span
      title={
        `${beat ? "Beat" : "Missed"} the close by ${sign}${pct} prob-points` +
        (bet.closing_odds != null ? ` · close ${fmtOdds(bet.closing_odds)}` : "")
      }
      className="num"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--sp-1)",
        fontSize: "var(--fs-caption)",
        fontWeight: "var(--weight-bold)",
        lineHeight: 1,
        padding: "var(--sp-1) var(--sp-2)",
        borderRadius: "var(--r-sm)",
        color: col,
        border: `1px solid ${col}`,
        background: "transparent",
        whiteSpace: "nowrap",
      }}
    >
      {beat ? "beat" : "miss"} {sign}{pct}%
    </span>
  );
}

// ── Summary stat block ────────────────────────────────────────────────────────
// CountUp is stabilized: it animates from the PREVIOUS rendered value to the new
// one, so a settle/delete refresh counts only the delta instead of re-running
// the full 0→net sweep on every reload.

function SummaryGroup({ label, g }: { label: string; g: TrackerSummaryGroup }) {
  // Stabilize CountUp: animate from 0 only on first mount, then count the delta
  // from the previously-rendered net on each settle/delete refresh (no jumpy
  // full 0→net re-sweep). We commit the prior net into state AFTER render (in an
  // effect), so render never reads/mutates a ref. The single effect reads the
  // last committed value, then stores the new one for next time.
  const prevNet = useRef(0);
  const [from, setFrom] = useState(0);
  useEffect(() => {
    if (prevNet.current !== g.units_net) {
      setFrom(prevNet.current);
      prevNet.current = g.units_net;
    }
  }, [g.units_net]);

  const netColor = g.units_net >= 0 ? "var(--pos)" : "var(--neg)";
  const winRate = g.wins + g.losses > 0
    ? ((g.wins / (g.wins + g.losses)) * 100).toFixed(0) + "%"
    : "—";
  return (
    <Card
      variant="inset"
      className="tracker-summary-card"
      style={{ flex: 1, minWidth: 0, background: "var(--surface-2)" }}
    >
      <div
        style={{
          fontSize: "var(--fs-caption)",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
          marginBottom: "var(--sp-2)",
        }}
      >
        {label}
      </div>
      <div
        className="num"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--fs-headline)",
          fontWeight: "var(--weight-display)",
          color: netColor,
          lineHeight: "var(--lh-tight)",
        }}
      >
        {g.units_net >= 0 ? "+" : ""}
        <CountUp to={g.units_net} from={from} direction="up" duration={1.2} delay={0.1} />
        u
      </div>
      <div style={{ marginTop: "var(--sp-2)", display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        {[
          ["Bets", g.bets],
          ["W", g.wins],
          ["L", g.losses],
          ["P", g.pushes],
          ["Pend", g.pending],
          ["W%", winRate],
          ["Wagered", g.units_wagered.toFixed(1) + "u"],
        ].map(([k, v]) => (
          <div key={k as string} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span
              style={{
                fontSize: "var(--fs-micro)",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-label)",
              }}
            >
              {k}
            </span>
            <span className="num" style={{ fontSize: "var(--fs-body)", fontWeight: "var(--weight-semibold)", color: "var(--text)" }}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Ledger columns (DataTable) ────────────────────────────────────────────────

type RowActions = {
  onSettle: (id: number, result: "WIN" | "LOSS" | "PUSH") => void;
  onDelete: (id: number) => void;
  unlocked: boolean;
};

function rowAccentClass(r: BetRecord["result"]): string {
  if (r === "WIN") return "bet-result-win";
  if (r === "LOSS") return "bet-result-loss";
  if (r === "PUSH") return "bet-result-push";
  return "bet-result-pending";
}

function GameStatusSub({ bet }: { bet: BetRecord }) {
  if (bet.result !== null || !bet.game_status) return null;
  const isLive = bet.game_status === "In Progress";
  const isPreGame = bet.game_status === "Pre-Game";
  if (isLive) {
    return (
      <span
        style={{
          display: "block",
          fontSize: "var(--fs-micro)",
          fontWeight: "var(--weight-bold)",
          letterSpacing: "var(--tracking-label)",
          color: "var(--neg)",
          marginTop: "2px",
        }}
      >
        <span className="live-dot" aria-hidden="true" /> LIVE
      </span>
    );
  }
  if ((bet.game_status === "Scheduled" || isPreGame) && bet.game_time_utc) {
    const d = new Date(bet.game_time_utc);
    const etStr = d.toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return (
      <span style={{ display: "block", fontSize: "var(--fs-micro)", color: "var(--text-muted)", marginTop: "2px" }}>
        {etStr} ET
      </span>
    );
  }
  return null;
}

function buildColumns({ onSettle, onDelete, unlocked }: RowActions): Column<BetRecord>[] {
  return [
    {
      key: "date",
      header: "Date",
      width: "92px",
      cell: (bet) => (
        <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
          {bet.game_date}
          <GameStatusSub bet={bet} />
        </span>
      ),
    },
    {
      key: "pick",
      header: "Game / Pick",
      width: "1fr",
      hideMobileLabel: true,
      cell: (bet) => (
        <div style={{ minWidth: 0 }}>
          <div className="num" style={{ fontSize: "var(--fs-body)", fontWeight: "var(--weight-semibold)" }}>
            {bet.away_team_abbr} @ {bet.home_team_abbr}
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "var(--fs-body)",
              color: "var(--text)",
              marginTop: "2px",
              lineHeight: "var(--lh-data)",
            }}
          >
            {bet.selection}
            {bet.market === "total" && bet.total_line != null && (
              <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
                {" "}· o/u {bet.total_line}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "odds",
      header: "Odds",
      width: "72px",
      align: "right",
      cell: (bet) => (
        <span className="num" style={{ fontSize: "var(--fs-body)", color: oddsColor(bet.american_odds) }}>
          {fmtOdds(bet.american_odds)}
        </span>
      ),
    },
    {
      key: "units",
      header: "Units",
      width: "56px",
      align: "right",
      cell: (bet) => (
        <span className="num" style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
          {bet.units}u
        </span>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      width: "92px",
      cell: (bet) => <TierBadge tier={bet.tier} />,
    },
    {
      key: "result",
      header: "Result",
      width: "84px",
      cell: (bet) => <ResultBadge result={bet.result} />,
    },
    {
      key: "net",
      header: "+/− Units",
      width: "88px",
      align: "right",
      cell: (bet) =>
        bet.units_returned === null ? (
          <span className="num" style={{ fontSize: "var(--fs-data)", color: "var(--text-muted)" }}>
            —
          </span>
        ) : (
          <SemanticValue
            value={bet.units_returned}
            mode="units"
            digits={2}
            suffix="u"
            style={{ fontSize: "var(--fs-data)", fontWeight: "var(--weight-bold)" }}
          />
        ),
    },
    {
      key: "clv",
      header: "CLV",
      width: "100px",
      cell: (bet) => <ClvChip bet={bet} />,
    },
    {
      key: "actions",
      header: "Actions",
      width: "150px",
      cell: (bet) => {
        const isPending = bet.result === null;
        if (!unlocked) return <span style={{ color: "var(--text-muted)" }}>—</span>;
        const game = `${bet.away_team_abbr} @ ${bet.home_team_abbr}`;
        return (
          <div style={{ display: "flex", gap: "var(--sp-1)", alignItems: "center", flexWrap: "wrap" }}>
            {isPending && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={`Mark ${game} as a win`}
                  title="Mark WIN"
                  onClick={() => onSettle(bet.id, "WIN")}
                  style={{ color: "var(--pos)", borderColor: "var(--pos)", minHeight: "32px", minWidth: "32px" }}
                >
                  W
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={`Mark ${game} as a loss`}
                  title="Mark LOSS"
                  onClick={() => onSettle(bet.id, "LOSS")}
                  style={{ color: "var(--neg)", borderColor: "var(--neg)", minHeight: "32px", minWidth: "32px" }}
                >
                  L
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={`Mark ${game} as a push`}
                  title="Mark PUSH"
                  onClick={() => onSettle(bet.id, "PUSH")}
                  style={{ minHeight: "32px", minWidth: "32px" }}
                >
                  P
                </Button>
              </>
            )}
            <ConfirmButton
              iconOnly
              aria-label={`Delete tracked bet ${game}`}
              confirmLabel="Delete?"
              onConfirm={() => onDelete(bet.id)}
              style={{ minHeight: "32px", minWidth: "32px" }}
            >
              ×
            </ConfirmButton>
          </div>
        );
      },
    },
  ];
}

// ── Group sub-header (Pending / Settled / per-date roll-up) ───────────────────

function GroupBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-2)",
        padding: "var(--sp-1) var(--sp-4)",
        background: "var(--surface-2)",
        fontSize: "var(--fs-caption)",
        fontWeight: "var(--weight-bold)",
        letterSpacing: "var(--tracking-label)",
        textTransform: "uppercase",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "all" | "moneyline" | "total";

export default function TrackerPage() {
  const [bets, setBets] = useState<BetRecord[] | null>(null);
  const [summary, setSummary] = useState<TrackerSummary | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [error, setError] = useState(false);
  const [autoTracking, setAutoTracking] = useState(false);
  const [autoResult, setAutoResult] = useState<{ created: number; skipped: number } | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminToken()));

  const today = todayET();

  const load = useCallback(async () => {
    const [b, s] = await Promise.all([
      api.trackerBets(),
      api.trackerSummary(),
    ]);
    if (b === null) { setError(true); return; }
    setBets(b);
    setSummary(s);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function handleAutoTrack() {
    setAutoTracking(true);
    setAutoResult(null);
    setAutoError(null);
    const result = await api.trackerAutoTrack(today);
    setAutoTracking(false);
    if (result) {
      setAutoResult(result);
      await load();
    } else {
      setAutoError("Auto-track failed — check that admin is unlocked and the API is reachable.");
    }
  }

  async function handleSettle(id: number, result: "WIN" | "LOSS" | "PUSH") {
    setSettleError(null);
    const updated = await api.trackerSettleBet(id, result);
    if (updated) {
      setBets((prev) => prev?.map((b) => b.id === id ? updated : b) ?? null);
      const s = await api.trackerSummary();
      if (s) setSummary(s);
    } else {
      setSettleError(`Failed to settle bet #${id} — check admin token and API status.`);
    }
  }

  async function handleDelete(id: number) {
    const ok = await api.trackerDeleteBet(id);
    if (ok) {
      setBets((prev) => prev?.filter((b) => b.id !== id) ?? null);
      const s = await api.trackerSummary();
      if (s) setSummary(s);
    }
  }

  // Filter + sort: chronological ascending by date, then id
  const visible = (bets ?? [])
    .filter((b) => tab === "all" ? true : b.market === (tab === "moneyline" ? "moneyline" : "total"))
    .sort((a, b) => {
      if (a.game_date !== b.game_date) return a.game_date < b.game_date ? -1 : 1;
      return a.id - b.id;
    });

  const pending = visible.filter((b) => b.result === null);
  const settled = visible.filter((b) => b.result !== null);

  const emptySummary: TrackerSummary = {
    ml: { bets: 0, wins: 0, losses: 0, pushes: 0, pending: 0, units_wagered: 0, units_net: 0 },
    total: { bets: 0, wins: 0, losses: 0, pushes: 0, pending: 0, units_wagered: 0, units_net: 0 },
    combined: { bets: 0, wins: 0, losses: 0, pushes: 0, pending: 0, units_wagered: 0, units_net: 0 },
  };
  const s = summary ?? emptySummary;

  const columns = buildColumns({ onSettle: handleSettle, onDelete: handleDelete, unlocked });

  const tabItems: TabItem[] = [
    { value: "all", label: "All" },
    { value: "moneyline", label: "Moneyline" },
    { value: "total", label: "Over / Under" },
  ];

  // Group settled bets by date descending for per-day roll-ups.
  const settledByDate: [string, BetRecord[]][] = (() => {
    const byDate: Record<string, BetRecord[]> = {};
    settled.forEach((b) => {
      (byDate[b.game_date] ??= []).push(b);
    });
    return Object.entries(byDate).sort(([a], [b]) => b.localeCompare(a));
  })();

  return (
    <div>
      {/* Scoped responsive toggle for the DataTable (table on desktop, card
          list on phones). The shared globals.css doesn't yet define these, so
          we wire the breakpoint here without touching the component. */}
      <style>{`
        .data-table-mobile { display: none; }
        @media (max-width: 640px) {
          .data-table-desktop { display: none; }
          .data-table-mobile { display: flex; }
        }
      `}</style>

      {/* Page header */}
      <div className="infield-divider" style={{ paddingBottom: "var(--sp-3)", marginBottom: "var(--sp-5)" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-display)",
            fontSize: "var(--fs-headline)",
            margin: 0,
            textTransform: "uppercase",
            color: "var(--text)",
          }}
        >
          Picks Tracker
        </h1>
        <div
          className="num"
          style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", marginTop: "var(--sp-1)" }}
        >
          Performance log · {s.combined.bets} tracked · {s.combined.pending} pending
        </div>
      </div>

      {/* Controls row */}
      <div
        className="infield-divider"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "var(--sp-2)",
          flexWrap: "wrap",
          padding: "var(--sp-3) 0",
          marginBottom: "var(--sp-5)",
        }}
      >
        <AdminGate onUnlocked={() => setUnlocked(true)} />
        <Button
          variant="primary"
          onClick={handleAutoTrack}
          disabled={autoTracking || !unlocked}
          aria-label={`Auto-track today's picks for ${today}`}
          style={(autoTracking || !unlocked) ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        >
          {autoTracking ? "Tracking…" : `⚡ Auto-track ${today}`}
        </Button>
        {autoResult && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: autoResult.created > 0 ? "var(--pos)" : "var(--text-2)" }}>
            {autoResult.created > 0
              ? `+${autoResult.created} logged · ${autoResult.skipped} already tracked`
              : `All picks already tracked (${autoResult.skipped} skipped)`}
          </div>
        )}
        {autoError && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--hold)" }}>
            {autoError}
          </div>
        )}
      </div>

      {settleError && (
        <ErrorBanner
          kind="outage"
          title="Settle failed"
          detail={settleError}
          action={
            <Button variant="ghost" size="sm" onClick={() => setSettleError(null)} aria-label="Dismiss error">
              Dismiss
            </Button>
          }
          style={{ marginBottom: "var(--sp-3)" }}
        />
      )}

      {error && (
        <ErrorBanner
          kind="outage"
          title="Unable to load tracker data"
          detail="The backend may be starting up — try refreshing in a moment."
          style={{ marginBottom: "var(--sp-4)" }}
        />
      )}

      {/* Summary stats */}
      <div className="pnl-summary-wrap">
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <SummaryGroup label="Combined" g={s.combined} />
          <SummaryGroup label="Moneyline" g={s.ml} />
          <SummaryGroup label="Over / Under" g={s.total} />
        </div>
      </div>
      <div style={{ marginBottom: "var(--sp-5)" }} />

      {/* Tabs */}
      <Tabs items={tabItems} value={tab} onChange={(v) => setTab(v as Tab)} ariaLabel="Filter ledger by market" />

      {/* Table */}
      {bets === null && !error && (
        <Loading label="Loading tracked bets">
          <div style={{ padding: "var(--sp-8) 0" }}>
            <Loading />
          </div>
        </Loading>
      )}

      {bets !== null && visible.length === 0 && (
        <EmptyState
          title="No bets tracked yet"
          detail="Hit ⚡ Auto-track to log today's picks automatically."
          style={{ marginTop: "var(--sp-4)" }}
        />
      )}

      {visible.length > 0 && (
        <Card
          pad={false}
          style={{ marginTop: "var(--sp-3)", overflow: "hidden", border: "1px solid var(--border)" }}
        >
          {pending.length > 0 && (
            <>
              <GroupBar>
                <span style={{ color: "var(--warn)" }}>▸ Pending</span>
                <span className="num" style={{ color: "var(--text-2)" }}>{pending.length}</span>
              </GroupBar>
              <DataTable
                columns={columns}
                rows={pending}
                rowKey={(b) => b.id}
                rowClassName={(b) => rowAccentClass(b.result)}
                caption="Pending tracked bets"
              />
            </>
          )}

          {settledByDate.length > 0 && (
            <>
              <GroupBar>
                <span style={{ color: "var(--text-2)" }}>▸ Settled</span>
                <span className="num" style={{ color: "var(--text-2)" }}>{settled.length}</span>
              </GroupBar>
              {settledByDate.map(([date, dateBets]) => {
                const dayNet = dateBets.reduce((sum, b) => sum + (b.units_returned ?? 0), 0);
                const wins = dateBets.filter((b) => b.result === "WIN").length;
                const losses = dateBets.filter((b) => b.result === "LOSS").length;
                return (
                  <div key={date}>
                    <div className="date-group-header">
                      <span className="num">{date}</span>
                      <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
                        <span className="num" style={{ color: "var(--text-2)" }}>{wins}W–{losses}L</span>
                        <SemanticValue
                          value={dayNet}
                          mode="units"
                          digits={2}
                          suffix="u"
                          className="dgh-pnl"
                        />
                      </div>
                    </div>
                    <DataTable
                      columns={columns}
                      rows={dateBets}
                      rowKey={(b) => b.id}
                      rowClassName={(b) => rowAccentClass(b.result)}
                      caption={`Settled tracked bets for ${date}`}
                    />
                  </div>
                );
              })}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
