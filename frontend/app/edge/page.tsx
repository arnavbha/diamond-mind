"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  api,
  todayET,
  type SlateGame,
  type ModelEdge,
} from "@/lib/api";
import {
  Card,
  DataTable,
  type Column,
  TierBadge,
  SemanticValue,
  SectionHeader,
  DateNav,
  TeamLogo,
  Tabs,
  type TabItem,
  EmptyState,
  ErrorBanner,
  SkeletonCard,
} from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────────
// +EV Edge Board
//
// EDGE per game/market = the model's vig-free fair prob for its lean side MINUS
// the book's Shin no-vig fair prob for that same side. Positive = the model
// thinks the true price is better than the de-vigged market = a genuine edge,
// independent of the book's vig and of the tier heuristic. This is where the
// model DISAGREES with the no-vig market — NOT a guaranteed-winners list. The
// realized proof that beating the no-vig market is real shows up as CLV on the
// Track Record.
//
// HONEST EMPTY STATES: a market with no two-sided same-book price (model_edge.
// <mkt> == null) has no edge number at all — it is rendered as a "no market"
// row and EXCLUDED from the ranking. We never fabricate a 0-edge cell.
// ─────────────────────────────────────────────────────────────────────────────

type MarketKey = "moneyline" | "total";

// One flattened row per (game, market) — the table's unit.
type EdgeRow = {
  game: SlateGame;
  market: MarketKey;
  // The model_edge slice for this market. null => "no market" (excluded from rank).
  edge: ModelEdge | null;
};

const MARKET_LABEL: Record<MarketKey, string> = {
  moneyline: "ML",
  total: "Total",
};

function sideLabel(row: EdgeRow): string {
  if (!row.edge) return "—";
  const { game, market, edge } = row;
  if (market === "moneyline") {
    return edge.side === "home" ? game.home_team_abbr : game.away_team_abbr;
  }
  // total
  const dir = edge.side === "over" ? "O" : "U";
  const line = edge.line ?? row.game.live_odds?.total?.line ?? null;
  return line != null ? `${dir} ${line}` : dir;
}

// Movement → toward/away/neutral readout. Verification framing: a "toward" move
// means the market moved toward the model's lean (confirmation), "away" means it
// moved against (a fade). Never a decision input here — purely descriptive.
function MovementCell({ agreement }: { agreement: ModelEdge["movement_agreement"] }) {
  if (agreement == null) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  if (agreement === "toward") {
    return (
      <span className="num" style={{ color: "var(--pos)", fontWeight: "var(--weight-semibold)" }}>
        ↗ toward
      </span>
    );
  }
  if (agreement === "away") {
    return (
      <span className="num" style={{ color: "var(--neg)", fontWeight: "var(--weight-semibold)" }}>
        ↘ away
      </span>
    );
  }
  return (
    <span className="num" style={{ color: "var(--text-2)" }}>
      → flat
    </span>
  );
}

// Honest "no market" cell — used wherever a market has no two-sided price.
function NoMarket() {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-meta)",
        color: "var(--text-muted)",
        fontStyle: "italic",
      }}
    >
      no market
    </span>
  );
}

function ProbCell({ p }: { p: number | null }) {
  if (p == null) return <NoMarket />;
  return (
    <span className="num" style={{ color: "var(--text)", fontWeight: "var(--weight-semibold)" }}>
      {(p * 100).toFixed(1)}%
    </span>
  );
}

function HoldCell({ hold }: { hold: number | null }) {
  if (hold == null) return <NoMarket />;
  return (
    <span className="num" style={{ color: "var(--hold)", fontWeight: "var(--weight-semibold)" }}>
      {hold.toFixed(1)}%
    </span>
  );
}

// EDGE% — the headline. Green positive, red negative. Honest "no market" when
// the market has no two-sided price (edge slice null).
function EdgeCell({ edge }: { edge: ModelEdge | null }) {
  if (!edge) return <NoMarket />;
  return (
    <SemanticValue
      value={edge.edge}
      mode="signed-zero"
      digits={1}
      suffix="%"
      display={`${edge.edge > 0 ? "+" : ""}${(edge.edge * 100).toFixed(1)}%`}
      style={{ fontSize: "var(--fs-data)" }}
    />
  );
}

function MatchupCell({ game }: { game: SlateGame }) {
  return (
    <Link
      href={`/game/${game.game_id}?date=${game.game_date}`}
      style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "var(--sp-1)" }}
    >
      <TeamLogo abbr={game.away_team_abbr} size={18} />
      <span className="num" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text)" }}>
        {game.away_team_abbr}
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: "var(--fs-meta)" }}>@</span>
      <TeamLogo abbr={game.home_team_abbr} size={18} />
      <span className="num" style={{ fontWeight: "var(--weight-semibold)", color: "var(--text)" }}>
        {game.home_team_abbr}
      </span>
    </Link>
  );
}

// Lean side + tier. When the lean is not actionable (PASS / model-implied side
// only), we dim it and label it so it never reads as a recommendation.
function LeanCell({ row }: { row: EdgeRow }) {
  if (!row.edge) return <NoMarket />;
  const { edge } = row;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
      <span
        className="num"
        style={{
          fontWeight: "var(--weight-bold)",
          color: edge.actionable ? "var(--text)" : "var(--text-2)",
          textTransform: "uppercase",
        }}
      >
        {sideLabel(row)}
      </span>
      <span style={{ opacity: edge.actionable ? 1 : 0.65 }}>
        <TierBadge tier={edge.tier} fill={edge.actionable} />
      </span>
      {!edge.actionable && (
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>
          (no lean)
        </span>
      )}
    </span>
  );
}

type SortKey = "edge" | "model" | "novig" | "hold";

export default function EdgePage() {
  const today = todayET();
  const [date, setDate] = useState(today);
  const [slate, setSlate] = useState<SlateGame[] | null>(null);
  const [error, setError] = useState(false);
  const [marketFilter, setMarketFilter] = useState<"all" | MarketKey>("all");
  const [tierFilter, setTierFilter] = useState<"all" | "STRONG LEAN" | "LEAN" | "PASS">("all");
  const [sortKey] = useState<SortKey>("edge");

  useEffect(() => {
    let alive = true;
    setSlate(null);
    setError(false);
    api.slate(date).then((s) => {
      if (!alive) return;
      if (s === null) setError(true);
      else setSlate(s);
    });
    return () => {
      alive = false;
    };
  }, [date]);

  // Flatten slate → one row per (game, market). A market with no analysis at all
  // (model_edge == null) contributes nothing. A market that has analysis but no
  // two-sided price contributes a "no market" row (edge slice null).
  const allRows: EdgeRow[] = useMemo(() => {
    if (!slate) return [];
    const out: EdgeRow[] = [];
    for (const game of slate) {
      const me = game.model_edge;
      if (me == null) continue; // no analysis for this game at all
      out.push({ game, market: "moneyline", edge: me.moneyline });
      out.push({ game, market: "total", edge: me.total });
    }
    return out;
  }, [slate]);

  // Apply market + tier filters. The tier filter only constrains rows that have
  // an edge slice (a tier); "no market" rows survive only when not tier-filtered.
  const filtered: EdgeRow[] = useMemo(() => {
    return allRows.filter((r) => {
      if (marketFilter !== "all" && r.market !== marketFilter) return false;
      if (tierFilter !== "all") {
        if (!r.edge) return false;
        if (r.edge.tier !== tierFilter) return false;
      }
      return true;
    });
  }, [allRows, marketFilter, tierFilter]);

  // Rank: rows WITH a real edge first, sorted by edge desc (the default and the
  // only sort that respects honest empties). "no market" rows sink to the bottom
  // and are never assigned a fabricated 0.
  const ranked: EdgeRow[] = useMemo(() => {
    const withEdge = filtered.filter((r) => r.edge != null);
    const withoutEdge = filtered.filter((r) => r.edge == null);
    const val = (r: EdgeRow): number => {
      const e = r.edge!;
      switch (sortKey) {
        case "model":
          return e.model_prob;
        case "novig":
          return e.novig_prob;
        case "hold":
          return e.hold_pct ?? -Infinity;
        case "edge":
        default:
          return e.edge;
      }
    };
    withEdge.sort((a, b) => val(b) - val(a));
    return [...withEdge, ...withoutEdge];
  }, [filtered, sortKey]);

  const rankedCount = useMemo(() => ranked.filter((r) => r.edge != null).length, [ranked]);
  const positiveCount = useMemo(
    () => ranked.filter((r) => r.edge != null && r.edge.edge > 0).length,
    [ranked],
  );

  const columns: Column<EdgeRow>[] = [
    {
      key: "matchup",
      header: "Matchup",
      width: "minmax(150px, 1.4fr)",
      cell: (r) => <MatchupCell game={r.game} />,
      hideMobileLabel: true,
    },
    {
      key: "market",
      header: "Market",
      width: "70px",
      cell: (r) => (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            color: "var(--text-2)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          {MARKET_LABEL[r.market]}
        </span>
      ),
    },
    {
      key: "lean",
      header: "Model lean",
      width: "minmax(140px, 1.2fr)",
      cell: (r) => <LeanCell row={r} />,
    },
    {
      key: "model",
      header: "Model prob",
      width: "90px",
      align: "right",
      cell: (r) => <ProbCell p={r.edge?.model_prob ?? null} />,
    },
    {
      key: "novig",
      header: "No-vig mkt",
      width: "90px",
      align: "right",
      cell: (r) => <ProbCell p={r.edge?.novig_prob ?? null} />,
    },
    {
      key: "edge",
      header: "Edge%",
      width: "90px",
      align: "right",
      cell: (r) => <EdgeCell edge={r.edge} />,
    },
    {
      key: "hold",
      header: "Hold%",
      width: "80px",
      align: "right",
      cell: (r) => <HoldCell hold={r.edge?.hold_pct ?? null} />,
    },
    {
      key: "movement",
      header: "Line move",
      width: "100px",
      align: "right",
      cell: (r) =>
        r.edge ? <MovementCell agreement={r.edge.movement_agreement} /> : <NoMarket />,
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      align: "right",
      cell: (r) => {
        if (!r.edge) return <NoMarket />;
        if (!r.edge.actionable) {
          return (
            <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>
              non-directional
            </span>
          );
        }
        const positive = r.edge.edge > 0;
        return (
          <span
            className="num"
            style={{
              fontSize: "var(--fs-micro)",
              color: positive ? "var(--pos)" : "var(--text-2)",
              fontWeight: "var(--weight-semibold)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            {positive ? "model +ev" : "below mkt"}
          </span>
        );
      },
    },
  ];

  const marketTabs: TabItem[] = [
    { value: "all", label: "All" },
    { value: "moneyline", label: "ML" },
    { value: "total", label: "Total" },
  ];
  const tierTabs: TabItem[] = [
    { value: "all", label: "All tiers" },
    { value: "STRONG LEAN", label: "Strong" },
    { value: "LEAN", label: "Lean" },
    { value: "PASS", label: "Pass" },
  ];

  return (
    <div>
      {/* Header */}
      <SectionHeader
        as="h1"
        style={{ marginBottom: "var(--sp-2)" }}
        action={<DateNav value={date} onChange={setDate} />}
      >
        +EV Edge Board
      </SectionHeader>

      {/* Credibility / framing note — verification, not guaranteed winners. */}
      <Card variant="default" style={{ marginBottom: "var(--sp-5)" }}>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--fs-body)",
            color: "var(--text-2)",
            lineHeight: "var(--lh-data)",
          }}
        >
          <strong style={{ color: "var(--text)" }}>Where the model disagrees with the no-vig market.</strong>{" "}
          Edge% is the model&apos;s vig-free fair probability for its lean side minus the book&apos;s
          Shin no-vig probability for that same side — the purest edge signal, independent of vig and
          of the tier heuristic. A positive edge means the model thinks the true price is better than
          the de-vigged market. This is a disagreement readout, <strong style={{ color: "var(--text)" }}>not a
          guaranteed-winners list</strong>. The realized proof that beating the no-vig market is real
          shows up as closing-line value —{" "}
          <Link
            href="/track-record"
            style={{ color: "var(--lean)", textDecoration: "underline", fontWeight: "var(--weight-semibold)" }}
          >
            see the Track Record CLV
          </Link>
          . Markets with no two-sided same-book price show{" "}
          <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>no market</span> and are
          excluded from the ranking — never a fabricated zero.
        </div>
      </Card>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--sp-5)",
          alignItems: "center",
          marginBottom: "var(--sp-4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>
            Market
          </span>
          <Tabs
            ariaLabel="Filter by market"
            items={marketTabs}
            value={marketFilter}
            onChange={(v) => setMarketFilter(v as "all" | MarketKey)}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)" }}>
            Tier
          </span>
          <Tabs
            ariaLabel="Filter by tier"
            items={tierTabs}
            value={tierFilter}
            onChange={(v) => setTierFilter(v as "all" | "STRONG LEAN" | "LEAN" | "PASS")}
          />
        </div>
        {slate && (
          <span
            className="num"
            style={{ marginLeft: "auto", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}
          >
            {rankedCount} ranked · {positiveCount} model +EV
          </span>
        )}
      </div>

      {/* States */}
      {error && (
        <ErrorBanner
          kind="outage"
          title="Unable to load the slate"
          detail="The backend may be starting up — try refreshing in a moment."
          style={{ marginBottom: "var(--sp-4)" }}
        />
      )}
      {!error && slate === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <SkeletonCard lines={5} />
          <SkeletonCard lines={5} />
        </div>
      )}
      {!error && slate && ranked.length === 0 && (
        <EmptyState
          title={`No edge data for ${date}.`}
          detail="Either the slate is empty, or no games have been analyzed against a two-sided market price yet. Try another date."
        />
      )}

      {!error && slate && ranked.length > 0 && (
        <DataTable
          columns={columns}
          rows={ranked}
          rowKey={(r) => `${r.game.game_id}-${r.market}`}
          caption="Model edge versus the no-vig market, ranked by edge"
        />
      )}
    </div>
  );
}
