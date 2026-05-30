"use client";

import { useState } from "react";
import {
  api,
  type BoostEv,
  type ParlayEv,
  type ParlayLegBody,
} from "@/lib/api";
import {
  Card,
  Button,
  NumberField,
  StatCell,
  StatGroup,
  SemanticValue,
  ErrorBanner,
  SectionHeader,
  DataTable,
  type Column,
} from "@/components/ui";

// ── shared atoms ────────────────────────────────────────────────────────────

/** A NumberField wrapper that accepts free text (preserves the original
 *  string-state validation flow — parent parses/validates before each call). */
function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", minWidth: 0 }}>
      <span
        style={{
          fontSize: "var(--fs-caption)",
          letterSpacing: "var(--tracking-label)",
          textTransform: "uppercase",
          color: "var(--text-2)",
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="num"
        style={{
          width: "100%",
          minHeight: "44px",
          padding: "0 var(--sp-3)",
          background: "var(--surface-inset)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-sm)",
          color: "var(--text)",
          fontSize: "var(--fs-body)",
          fontWeight: "var(--weight-semibold)",
        }}
      />
      {hint && (
        <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{hint}</span>
      )}
    </label>
  );
}

function verdictColor(v: "+EV" | "marginal" | "-EV"): string {
  return v === "+EV"
    ? "var(--pos)"
    : v === "-EV"
      ? "var(--neg)"
      : "var(--text-2)";
}

const fmtPct = (x: number, d = 1) => `${x.toFixed(d)}%`;
const fmtSignedPct = (x: number, d = 2) =>
  `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
const fmtDec = (x: number) => x.toFixed(4);

function Verdict({ verdict }: { verdict: "+EV" | "marginal" | "-EV" }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-display)",
        fontSize: "var(--fs-headline)",
        fontWeight: "var(--weight-display)",
        textTransform: "uppercase",
        color: verdictColor(verdict),
        lineHeight: "var(--lh-tight)",
        letterSpacing: "var(--tracking-num)",
      }}
    >
      {verdict}
    </div>
  );
}

// ── Profit-Boost EV calculator ──────────────────────────────────────────────

function BoostCard() {
  const [odds, setOdds] = useState("-110");
  const [boostPct, setBoostPct] = useState("33");
  const [fairProb, setFairProb] = useState("52");
  const [res, setRes] = useState<BoostEv | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [outage, setOutage] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setErr(null);
    setOutage(false);
    setBusy(true);
    const o = parseFloat(odds);
    const b = parseFloat(boostPct);
    const p = parseFloat(fairProb) / 100;
    if (!Number.isFinite(o) || o === 0) {
      setErr("American odds must be a non-zero number.");
      setBusy(false);
      return;
    }
    if (!Number.isFinite(b) || b < 0) {
      setErr("Boost % must be 0 or greater.");
      setBusy(false);
      return;
    }
    if (!Number.isFinite(p) || p <= 0 || p >= 1) {
      setErr("Fair win % must be between 0 and 100 (exclusive).");
      setBusy(false);
      return;
    }
    const r = await api.boostEv(o, b, p);
    setBusy(false);
    if (r === null) {
      setOutage(true);
      setRes(null);
      return;
    }
    setRes(r);
  }

  return (
    <Card>
      <SectionHeader>Profit-Boost EV</SectionHeader>
      <div
        style={{
          fontSize: "var(--fs-meta)",
          color: "var(--text-2)",
          marginTop: "calc(-1 * var(--sp-2))",
          marginBottom: "var(--sp-4)",
        }}
      >
        Is a profit boost actually +EV? Boost lifts NET PROFIT only — never the
        stake. Verification, not a pick.
      </div>

      <StatGroup min="120px" style={{ marginBottom: "var(--sp-4)" }}>
        <NumberField
          label="American odds"
          value={odds}
          onChange={setOdds}
          step={5}
          hint="the line you'd bet"
        />
        <NumberField
          label="Boost %"
          value={boostPct}
          onChange={setBoostPct}
          step={5}
          hint="e.g. 33 for a 33% boost"
        />
        <NumberField
          label="Fair win %"
          value={fairProb}
          onChange={setFairProb}
          step={1}
          hint="your no-vig prob 0–100"
        />
      </StatGroup>

      <Button variant="primary" onClick={run} disabled={busy}>
        {busy ? "Checking…" : "Check boost"}
      </Button>

      {err && (
        <ErrorBanner
          kind="validation"
          detail={err}
          style={{ marginTop: "var(--sp-4)" }}
        />
      )}
      {outage && (
        <ErrorBanner
          kind="outage"
          detail="Backend rejected these inputs or is unreachable."
          style={{ marginTop: "var(--sp-4)" }}
        />
      )}

      {res && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div style={{ marginBottom: "var(--sp-3)" }}>
            <Verdict verdict={res.verdict} />
          </div>
          <StatGroup min="120px">
            <StatCell
              label="EV %"
              value={
                <SemanticValue
                  value={res.ev_pct}
                  display={fmtSignedPct(res.ev_pct, 2)}
                />
              }
            />
            <StatCell
              label="Boosted line"
              value={
                res.boosted_american !== null
                  ? (res.boosted_american > 0 ? "+" : "") + res.boosted_american
                  : fmtDec(res.boosted_decimal)
              }
            />
            <StatCell
              label="Break-even prob"
              value={fmtPct(res.breakeven_prob * 100, 2)}
            />
            <StatCell
              label="Edge vs break-even"
              value={
                <SemanticValue
                  value={res.edge_vs_breakeven}
                  display={fmtSignedPct(res.edge_vs_breakeven * 100, 2)}
                />
              }
            />
          </StatGroup>
        </div>
      )}
    </Card>
  );
}

// ── Parlay / SGP checker ────────────────────────────────────────────────────

type LegInput = {
  american: string;
  opposite_american: string;
  fair_prob: string;
  game_tag: string;
  label: string;
};

function emptyLeg(): LegInput {
  return {
    american: "",
    opposite_american: "",
    fair_prob: "",
    game_tag: "",
    label: "",
  };
}

function ParlayCard() {
  const [legs, setLegs] = useState<LegInput[]>([
    { american: "-150", opposite_american: "130", fair_prob: "", game_tag: "NYY@BOS", label: "Yankees ML" },
    { american: "-110", opposite_american: "-110", fair_prob: "", game_tag: "NYY@BOS", label: "Over 8.5" },
  ]);
  const [offered, setOffered] = useState("250");
  const [stake, setStake] = useState("1");
  const [res, setRes] = useState<ParlayEv | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [outage, setOutage] = useState(false);
  const [busy, setBusy] = useState(false);

  function updateLeg(i: number, patch: Partial<LegInput>) {
    setLegs((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLeg() {
    setLegs((prev) => [...prev, emptyLeg()]);
  }
  function removeLeg(i: number) {
    setLegs((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function run() {
    setErr(null);
    setOutage(false);
    setBusy(true);

    if (legs.length < 2) {
      setErr("A parlay needs at least 2 legs.");
      setBusy(false);
      return;
    }

    const body: ParlayLegBody[] = [];
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      const a = parseInt(l.american, 10);
      if (!Number.isFinite(a) || a === 0) {
        setErr(`Leg ${i + 1}: American odds must be a non-zero integer.`);
        setBusy(false);
        return;
      }
      const leg: ParlayLegBody = { american: a };
      if (l.opposite_american.trim() !== "") {
        const opp = parseInt(l.opposite_american, 10);
        if (!Number.isFinite(opp) || opp === 0) {
          setErr(`Leg ${i + 1}: opposite odds must be non-zero if supplied.`);
          setBusy(false);
          return;
        }
        leg.opposite_american = opp;
      }
      if (l.fair_prob.trim() !== "") {
        const fp = parseFloat(l.fair_prob) / 100;
        if (!Number.isFinite(fp) || fp <= 0 || fp >= 1) {
          setErr(`Leg ${i + 1}: fair win % must be between 0 and 100.`);
          setBusy(false);
          return;
        }
        leg.fair_prob = fp;
      }
      if (l.game_tag.trim() !== "") leg.game_tag = l.game_tag.trim();
      if (l.label.trim() !== "") leg.label = l.label.trim();
      body.push(leg);
    }

    const off = parseInt(offered, 10);
    if (!Number.isFinite(off) || off === 0) {
      setErr("Offered parlay price must be a non-zero integer.");
      setBusy(false);
      return;
    }
    const st = parseFloat(stake);
    if (!Number.isFinite(st) || st <= 0) {
      setErr("Stake must be greater than 0.");
      setBusy(false);
      return;
    }

    const r = await api.parlayEv({
      legs: body,
      offered_american: off,
      stake: st,
    });
    setBusy(false);
    if (r === null) {
      setOutage(true);
      setRes(null);
      return;
    }
    setRes(r);
  }

  return (
    <Card>
      <SectionHeader>Parlay / SGP Checker</SectionHeader>
      <div
        style={{
          fontSize: "var(--fs-meta)",
          color: "var(--text-2)",
          marginTop: "calc(-1 * var(--sp-2))",
          marginBottom: "var(--sp-4)",
        }}
      >
        How big is the book&apos;s compounded hold on this parlay? Fair price is
        computed under the INDEPENDENCE assumption (product of each leg&apos;s
        vig-free prob). Verification, not a pick.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
        {legs.map((l, i) => (
          <Card key={i} variant="inset">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "var(--sp-3)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-meta)",
                  fontWeight: "var(--weight-bold)",
                  color: "var(--text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--tracking-label)",
                }}
              >
                Leg {i + 1}
              </span>
              <Button
                variant="danger"
                size="sm"
                onClick={() => removeLeg(i)}
                disabled={legs.length <= 2}
                aria-label={`Remove leg ${i + 1}`}
              >
                remove
              </Button>
            </div>
            <StatGroup min="110px">
              <TextField
                label="Label"
                value={l.label}
                onChange={(v) => updateLeg(i, { label: v })}
                placeholder="Yankees ML"
              />
              <NumberField
                label="American odds"
                value={l.american}
                onChange={(v) => updateLeg(i, { american: v })}
                step={5}
                hint="required, != 0"
              />
              <NumberField
                label="Opposite odds"
                value={l.opposite_american}
                onChange={(v) => updateLeg(i, { opposite_american: v })}
                step={5}
                hint="optional · enables devig"
              />
              <NumberField
                label="Fair win %"
                value={l.fair_prob}
                onChange={(v) => updateLeg(i, { fair_prob: v })}
                step={1}
                hint="optional · 0–100"
              />
              <TextField
                label="Same-game tag"
                value={l.game_tag}
                onChange={(v) => updateLeg(i, { game_tag: v })}
                placeholder="NYY@BOS"
                hint="match to flag correlation"
              />
            </StatGroup>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: "var(--sp-3)" }}>
        <Button variant="ghost" onClick={addLeg}>
          + Add leg
        </Button>
      </div>

      <StatGroup min="140px" style={{ marginTop: "var(--sp-4)" }}>
        <NumberField
          label="Offered parlay price"
          value={offered}
          onChange={setOffered}
          step={5}
          hint="book's American price, != 0"
        />
        <NumberField
          label="Stake (units)"
          value={stake}
          onChange={setStake}
          step={1}
          hint="> 0"
        />
      </StatGroup>

      <div style={{ marginTop: "var(--sp-4)" }}>
        <Button variant="primary" onClick={run} disabled={busy}>
          {busy ? "Checking…" : "Check parlay"}
        </Button>
      </div>

      {err && (
        <ErrorBanner
          kind="validation"
          detail={err}
          style={{ marginTop: "var(--sp-4)" }}
        />
      )}
      {outage && (
        <ErrorBanner
          kind="outage"
          detail="Backend rejected these inputs or is unreachable."
          style={{ marginTop: "var(--sp-4)" }}
        />
      )}

      {res && <ParlayResult res={res} />}
    </Card>
  );
}

type LegRow = ParlayEv["legs"][number];

function ParlayResult({ res }: { res: ParlayEv }) {
  const legColumns: Column<LegRow>[] = [
    {
      key: "leg",
      header: "Leg",
      width: "2fr",
      cell: (leg, i) => (
        <>
          <span style={{ color: "var(--text)" }}>{leg.label ?? `Leg ${i + 1}`}</span>
          {leg.game_tag ? (
            <span style={{ color: "var(--text-muted)" }}> · {leg.game_tag}</span>
          ) : null}
        </>
      ),
    },
    {
      key: "odds",
      header: "Odds",
      align: "right",
      cell: (leg) => `${leg.american > 0 ? "+" : ""}${leg.american}`,
    },
    {
      key: "fair",
      header: "Fair prob",
      align: "right",
      cell: (leg) => fmtPct(leg.fair_prob * 100, 2),
    },
    {
      key: "source",
      header: "Source",
      cell: (leg) => (
        <>
          {leg.prob_source}
          {leg.vig_loaded ? (
            <span style={{ color: "var(--hold)" }}> · vig-loaded</span>
          ) : null}
        </>
      ),
    },
    {
      key: "hold",
      header: "Leg hold",
      align: "right",
      cell: (leg) =>
        leg.leg_hold_pct !== null ? fmtPct(leg.leg_hold_pct, 2) : "—",
    },
  ];

  return (
    <div style={{ marginTop: "var(--sp-5)" }}>
      {/* Correlation honesty — surfaced FIRST and VERBATIM when present. */}
      {res.correlated && res.correlation_warning && (
        <Card
          variant="inset"
          style={{
            borderLeft: "3px solid var(--neg)",
            marginBottom: "var(--sp-4)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-display)",
              fontSize: "var(--fs-meta)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
              color: "var(--neg)",
              marginBottom: "var(--sp-2)",
            }}
          >
            Same-game correlation warning
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-body)",
              color: "var(--text)",
              lineHeight: "var(--lh-prose)",
            }}
          >
            {res.correlation_warning}
          </div>
          {res.correlated_groups.length > 0 && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-caption)",
                color: "var(--text-muted)",
                marginTop: "var(--sp-2)",
              }}
            >
              {res.correlated_groups
                .map(
                  (g) =>
                    `${g.game_tag}: ${g.leg_count} legs (${g.leg_indices
                      .map((x) => `#${x + 1}`)
                      .join(", ")})`,
                )
                .join(" · ")}
            </div>
          )}
        </Card>
      )}

      <div style={{ marginBottom: "var(--sp-1)" }}>
        <Verdict verdict={res.verdict} />
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-caption)",
          color: "var(--text-muted)",
          marginBottom: "var(--sp-3)",
        }}
      >
        Fair price basis: {res.fair_basis} (product of per-leg vig-free probs)
        {res.any_vig_loaded
          ? " · one or more legs are vig-loaded (no devig source) — fair price is conservative"
          : ""}
      </div>

      {res.verdict_caveat && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            color: "var(--text-2)",
            marginBottom: "var(--sp-3)",
            paddingLeft: "var(--sp-2)",
            borderLeft: "2px solid var(--border)",
          }}
        >
          {res.verdict_caveat}
        </div>
      )}

      {/* Headline: the compounded hold. */}
      <StatGroup min="150px" style={{ marginBottom: "var(--sp-2)" }}>
        <StatCell
          label="Compounded parlay hold"
          value={fmtPct(res.parlay_hold_pct, 2)}
          color="var(--hold)"
        />
        <StatCell
          label="EV %"
          value={
            <SemanticValue
              value={res.ev_pct}
              display={fmtSignedPct(res.ev_pct, 2)}
            />
          }
        />
      </StatGroup>

      <StatGroup min="120px">
        <StatCell label="Fair decimal" value={fmtDec(res.fair_parlay_decimal)} emphasis="data" />
        <StatCell label="Offered decimal" value={fmtDec(res.offered_decimal)} emphasis="data" />
        <StatCell
          label="Fair parlay prob"
          value={fmtPct(res.fair_parlay_prob * 100, 2)}
          emphasis="data"
        />
        <StatCell
          label="Offered implied prob"
          value={fmtPct(res.offered_implied_parlay_prob * 100, 2)}
          emphasis="data"
        />
        {res.book_compounded_hold_pct !== null && (
          <StatCell
            label="Structural book hold"
            value={fmtPct(res.book_compounded_hold_pct, 2)}
            color="var(--hold)"
            emphasis="data"
          />
        )}
        {res.single_leg_hold_avg_pct !== null && (
          <StatCell
            label="Avg single-leg hold"
            value={fmtPct(res.single_leg_hold_avg_pct, 2)}
            emphasis="data"
          />
        )}
        <StatCell
          label="EV (units)"
          value={
            <SemanticValue
              value={res.ev_units}
              display={fmtSignedPct(res.ev_units * 100, 2).replace("%", "")}
            />
          }
          emphasis="data"
        />
        <StatCell
          label="Edge vs break-even"
          value={
            <SemanticValue
              value={res.edge_vs_breakeven}
              display={fmtSignedPct(res.edge_vs_breakeven * 100, 2)}
            />
          }
          emphasis="data"
        />
      </StatGroup>

      {/* Per-leg breakdown */}
      <div style={{ marginTop: "var(--sp-4)" }}>
        <DataTable
          columns={legColumns}
          rows={res.legs}
          rowKey={(_, i) => i}
          caption="Per-leg parlay breakdown"
        />
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  return (
    <div>
      <div
        style={{
          marginBottom: "var(--sp-5)",
          paddingBottom: "var(--sp-4)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-display)",
            fontSize: "var(--fs-headline)",
            letterSpacing: "var(--tracking-num)",
            margin: 0,
            textTransform: "uppercase",
          }}
        >
          Tools
        </h1>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            color: "var(--text-2)",
            marginTop: "var(--sp-1)",
          }}
        >
          Stateless price-verification calculators · these expose the book&apos;s
          vig — they are not picks
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "var(--sp-5)",
        }}
      >
        <BoostCard />
        <ParlayCard />
      </div>
    </div>
  );
}
