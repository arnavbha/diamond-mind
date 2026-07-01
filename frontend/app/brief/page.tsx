"use client";

// ── /brief — Morning Brief MVP (user-testing artifact) ──────────────────────
// The smallest page that expresses the product philosophy so real users can
// react to it: today's reads lead (the reason to open), yesterday's reckoning
// is a quiet footer (the reason to return), claims lead with baseball reality,
// judgment is handed back (no bet buttons).
//
// Hierarchy carries conviction: the top-ranked read is THE read — full claim,
// why-line, and the hero edge glyph (market tick vs model distribution, the
// page's one visual anchor). The remaining reads are compact instrument rows
// with mini glyphs. Model-vs-market numbers live on the glyph, not in a
// metadata log-line. Hypotheses under test, not truths: see memory
// frontend_redesign_direction.

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, todayET, type SlateGame, type BetRecord, type GameAnalysis } from "@/lib/api";
import { translateRead } from "@/lib/read-translation";
import { EdgeGlyph } from "@/components/brief/edge-glyph";
import { fmtDateHuman } from "@/lib/date";
import { Loading, SkeletonText, ErrorBanner, TierBadge } from "@/components/ui";

function yesterdayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function leanAbbr(a: GameAnalysis): string | null {
  if (a.ml_lean === "HOME") return a.home_team_abbr;
  if (a.ml_lean === "AWAY") return a.away_team_abbr;
  return a.ml_lean && a.ml_lean !== "PASS" ? a.ml_lean : null;
}

/** THE read — the slate's highest-conviction disagreement, at full weight.
 *  Claim → why → the edge glyph (the numbers live on the object). Ends with a
 *  door into the work, never a bet button. */
function HeroRead({ g, today }: { g: SlateGame; today: string }) {
  const a = g.analysis!;
  const side = leanAbbr(a);
  const { reality, why } = translateRead(a, 0);
  const marketPct = a.q_shin_vig_free * 100;
  const modelPct = a.q_p_shrunk * 100;

  return (
    <section style={{ padding: "var(--sp-5) 0 var(--sp-6)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ width: "20px", height: "2px", background: "var(--clay)", display: "inline-block" }} />
        <span className="num" style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-bold)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-2)" }}>
          Tonight&apos;s strongest read
        </span>
        <TierBadge tier={a.ml_tier} />
        <span className="num" style={{ marginLeft: "auto", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
          {g.away_team_abbr} @ {g.home_team_abbr}{g.start_time_et ? ` · ${g.start_time_et}` : ""}
        </span>
      </div>

      <h2 style={{ margin: "var(--sp-4) 0 0", fontFamily: "var(--font-body)", fontSize: "var(--fs-headline)", fontWeight: "var(--weight-semibold)", lineHeight: "var(--lh-tight)", letterSpacing: "-0.02em", color: "var(--text)", maxWidth: "34ch" }}>
        {reality}
      </h2>
      <p style={{ margin: "var(--sp-2) 0 0", fontFamily: "var(--font-body)", fontSize: "var(--fs-data)", color: "var(--text-2)", lineHeight: "var(--lh-prose)", maxWidth: "52ch" }}>
        {why}
      </p>

      <div style={{ marginTop: "var(--sp-4)" }}>
        <EdgeGlyph hero marketPct={marketPct} modelPct={modelPct} />
      </div>

      <div style={{ marginTop: "var(--sp-3)", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <span className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>
          {side ? `${side} moneyline` : "moneyline"}
        </span>
        <Link href={`/game/${g.game_id}?date=${today}`} className="num" style={{ fontSize: "var(--fs-data)", color: "var(--clay)", textDecoration: "none" }}>
          open the work ›
        </Link>
      </div>
    </section>
  );
}

/** The remaining reads — same disagreement, compact instrument row. */
function CompactRead({ g, today, variant }: { g: SlateGame; today: string; variant: number }) {
  const a = g.analysis!;
  const side = leanAbbr(a);
  const { reality } = translateRead(a, variant);
  const marketPct = a.q_shin_vig_free * 100;
  const modelPct = a.q_p_shrunk * 100;
  const pts = modelPct - marketPct;

  return (
    <div className="mobile-stack" style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", padding: "var(--sp-4) 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: "220px" }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-data)", fontWeight: "var(--weight-semibold)", color: "var(--text)", lineHeight: "var(--lh-tight)" }}>
          {reality}
        </div>
        <div className="num" style={{ marginTop: "var(--sp-1)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
          {g.away_team_abbr} @ {g.home_team_abbr}{g.start_time_et ? ` · ${g.start_time_et}` : ""}{side ? ` · ${side} moneyline` : ""}
        </div>
      </div>
      <EdgeGlyph marketPct={marketPct} modelPct={modelPct} />
      <div style={{ width: "84px", textAlign: "right", flexShrink: 0 }}>
        <div className="num" style={{ fontSize: "var(--fs-data)", fontWeight: "var(--weight-bold)", color: "var(--clay)" }}>
          +{pts.toFixed(1)}
        </div>
        <Link href={`/game/${g.game_id}?date=${today}`} className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", textDecoration: "none" }}>
          open ›
        </Link>
      </div>
    </div>
  );
}

/** Yesterday, one quiet line. Honest: names losses, only claims repricing when
 *  a real close was captured, says "no tracked reads" when there were none. */
function Reckoning({ bets }: { bets: BetRecord[] | null }) {
  let line: string;
  if (bets === null) line = "Yesterday: couldn't load.";
  else if (bets.length === 0) line = "Yesterday: no tracked reads.";
  else {
    const won = bets.filter((b) => b.result === "WIN").length;
    const lost = bets.filter((b) => b.result === "LOSS").length;
    const unsettled = bets.filter((b) => b.result == null).length;
    const withClose = bets.filter((b) => b.beat_close != null);
    const repriced = withClose.filter((b) => b.beat_close === true).length;
    const parts = [`${bets.length} read${bets.length === 1 ? "" : "s"}`];
    if (withClose.length > 0) parts.push(`market repriced toward us on ${repriced} of ${withClose.length}`);
    if (won > 0) parts.push(`${won} won`);
    if (lost > 0) parts.push(`${lost} we missed`);
    if (unsettled > 0) parts.push(`${unsettled} unsettled`);
    line = `Yesterday: ${parts.join(" · ")}.`;
  }
  return (
    <div style={{ marginTop: "var(--sp-7)", paddingTop: "var(--sp-4)", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
      <span className="num" style={{ fontSize: "var(--fs-body)", color: "var(--text-2)" }}>{line}</span>
      <Link href="/track-record" className="num" style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", textDecoration: "none" }}>
        full record ›
      </Link>
    </div>
  );
}

function BriefPageInner() {
  // ?date= override for user testing on data-rich days; defaults to today.
  const params = useSearchParams();
  const today = params.get("date") ?? todayET();
  const [games, setGames] = useState<SlateGame[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [yBets, setYBets] = useState<BetRecord[] | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    api.slate(today).then((g) => { if (alive) { setGames(g); setFailed(g === null); } });
    api.trackerBets({ game_date: yesterdayOf(today) }).then((b) => { if (alive) setYBets(b); });
    return () => { alive = false; };
  }, [today]);

  const actionable = (games ?? [])
    .filter((g) => g.analysis && g.analysis.ml_tier !== "PASS" && g.analysis.ml_lean !== "PASS")
    .sort((a, b) => (b.analysis!.q_prob_positive ?? 0) - (a.analysis!.q_prob_positive ?? 0));
  const reads = actionable.slice(0, 3);
  const [hero, ...rest] = reads;
  const quiet = (games?.length ?? 0) - reads.length;

  return (
    <div style={{ maxWidth: "680px", margin: "0 auto" }}>
      <div className="num" style={{ fontSize: "var(--fs-meta)", color: "var(--text-2)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase" }}>
        Morning Brief · {fmtDateHuman(today)}
      </div>

      {games === null && !failed && (
        <Loading label="Loading the brief"><div style={{ marginTop: "var(--sp-5)" }}><SkeletonText lines={6} /></div></Loading>
      )}
      {failed && (
        <ErrorBanner kind="outage" title="Couldn't load today's brief" detail="The API isn't reachable. Try again in a minute." />
      )}

      {games !== null && (
        <>
          <div style={{ marginTop: "var(--sp-3)", fontFamily: "var(--font-body)", fontSize: "var(--fs-data)", color: "var(--text-2)" }}>
            {reads.length > 0
              ? `${reads.length} read${reads.length === 1 ? "" : "s"} worth your attention today.`
              : "The market looks sharp today. Nothing worth your attention."}
          </div>

          {hero && (
            <div style={{ marginTop: "var(--sp-3)" }}>
              <HeroRead g={hero} today={today} />
            </div>
          )}

          {rest.length > 0 && (
            <div style={{ marginTop: "var(--sp-5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
                <span className="num" style={{ fontSize: "var(--fs-caption)", fontWeight: "var(--weight-bold)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", color: "var(--text-3)" }}>
                  {rest.length === 1 ? "One more worth a look" : "Two more worth a look"}
                </span>
                <span style={{ flex: 1, height: "1px", background: "var(--border)" }} />
              </div>
              {rest.map((g, i) => (
                <CompactRead key={g.game_id} g={g} today={today} variant={i + 1} />
              ))}
            </div>
          )}

          {quiet > 0 && (
            <div style={{ marginTop: "var(--sp-4)", fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-muted)", fontStyle: "italic" }}>
              The other {quiet} game{quiet === 1 ? " looks" : "s look"} priced about right. Nothing to force.
            </div>
          )}

          {reads.length > 0 && (
            <div style={{ marginTop: "var(--sp-5)", fontFamily: "var(--font-body)", fontSize: "var(--fs-body)", color: "var(--text-2)" }}>
              That&apos;s the read. Your call.
            </div>
          )}

          <Reckoning bets={yBets === undefined ? null : yBets} />
        </>
      )}
    </div>
  );
}

export default function BriefPage() {
  // useSearchParams requires a Suspense boundary (same idiom as the slate page).
  return (
    <Suspense fallback={<Loading label="Loading the brief"><SkeletonText lines={6} /></Loading>}>
      <BriefPageInner />
    </Suspense>
  );
}
