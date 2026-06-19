"use client";

import { useState } from "react";
import {
  api,
  type BoostEv,
  type ParlayEv,
  type ParlayLegBody,
  type BankrollRisk,
  type BankrollRiskBody,
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
            borderColor: "var(--neg)",
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

// ── Bankroll & Risk (Kelly stake / risk-of-ruin) ────────────────────────────

const fmtUsd = (x: number) =>
  x.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtUnits = (x: number) => x.toFixed(4);
const fmtGrowth = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(4)}%`;
const fmtFrac = (x: number) => `${(x * 100).toFixed(2)}%`;
const fmtProb = (x: number) => `${(x * 100).toFixed(2)}%`;

const KELLY_QUICK: { label: string; value: number }[] = [
  { label: "Quarter", value: 0.25 },
  { label: "Half", value: 0.5 },
  { label: "Full", value: 1.0 },
];

/** Bankroll verdict maps onto the same +EV / marginal / -EV color scale. */
function bankrollVerdictTone(no_bet: boolean): "+EV" | "marginal" | "-EV" {
  return no_bet ? "-EV" : "+EV";
}

type SensRow = BankrollRisk["edge_sensitivity"][number];

function BankrollCard() {
  const [bankroll, setBankroll] = useState("1000");
  const [odds, setOdds] = useState("-110");
  const [fairProb, setFairProb] = useState("53");
  const [kMult, setKMult] = useState("0.5");
  const [res, setRes] = useState<BankrollRisk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [outage, setOutage] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setErr(null);
    setOutage(false);
    setBusy(true);

    const bk = parseFloat(bankroll);
    const o = parseInt(odds, 10);
    const p = parseFloat(fairProb) / 100;
    const m = parseFloat(kMult);

    if (!Number.isFinite(bk) || bk <= 0) {
      setErr("Bankroll must be greater than 0.");
      setBusy(false);
      return;
    }
    if (!Number.isFinite(o) || o === 0) {
      setErr("American odds must be a non-zero integer.");
      setBusy(false);
      return;
    }
    if (!Number.isFinite(p) || p <= 0 || p >= 1) {
      setErr("Fair win % must be between 0 and 100 (exclusive).");
      setBusy(false);
      return;
    }
    if (!Number.isFinite(m) || m <= 0 || m > 1) {
      setErr("Kelly multiplier must be greater than 0 and at most 1.");
      setBusy(false);
      return;
    }

    const body: BankrollRiskBody = {
      bankroll: bk,
      american_odds: o,
      fair_prob: p,
      kelly_multiplier: m,
    };
    const r = await api.bankroll(body);
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
      <SectionHeader>Bankroll &amp; Risk</SectionHeader>
      <div
        style={{
          fontSize: "var(--fs-meta)",
          color: "var(--text-2)",
          marginTop: "calc(-1 * var(--sp-2))",
          marginBottom: "var(--sp-4)",
        }}
      >
        Kelly stake sizing + an honest risk-of-drawdown estimate. The edge here is
        ESTIMATED, not known — seed the fair win % from the model&apos;s shrunk
        prob and read the edge-sensitivity rows. Verification, not a pick.
      </div>

      <StatGroup min="120px" style={{ marginBottom: "var(--sp-3)" }}>
        <NumberField
          label="Bankroll ($)"
          value={bankroll}
          onChange={setBankroll}
          step={50}
          hint="total roll, > 0"
        />
        <NumberField
          label="American odds"
          value={odds}
          onChange={setOdds}
          step={5}
          hint="the line you'd bet, != 0"
        />
        <NumberField
          label="Fair win %"
          value={fairProb}
          onChange={setFairProb}
          step={1}
          hint="vig-free prob 0–100"
        />
        <NumberField
          label="Kelly multiplier"
          value={kMult}
          onChange={setKMult}
          step={0.25}
          hint="fraction of full Kelly, (0,1]"
        />
      </StatGroup>

      <div
        style={{
          display: "flex",
          gap: "var(--sp-2)",
          flexWrap: "wrap",
          marginBottom: "var(--sp-4)",
        }}
      >
        {KELLY_QUICK.map((q) => (
          <Button
            key={q.label}
            variant={parseFloat(kMult) === q.value ? "primary" : "ghost"}
            size="sm"
            onClick={() => setKMult(String(q.value))}
          >
            {q.label} ({q.value}×)
          </Button>
        ))}
      </div>

      <Button variant="primary" onClick={run} disabled={busy}>
        {busy ? "Computing…" : "Size the bet"}
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

      {res && <BankrollResult res={res} />}
    </Card>
  );
}

function BankrollResult({ res }: { res: BankrollRisk }) {
  const sensColumns: Column<SensRow>[] = [
    {
      key: "scenario",
      header: "Scenario",
      cell: (r) =>
        r.delta === 0 ? "p (as entered)" : `p − ${(r.delta * 100).toFixed(0)}%`,
    },
    {
      key: "true_prob",
      header: "True prob",
      align: "right",
      cell: (r) => fmtProb(r.true_prob),
    },
    {
      key: "full_kelly",
      header: "Full Kelly f*",
      align: "right",
      cell: (r) => (
        <SemanticValue
          value={r.full_kelly_at_true_p}
          display={fmtFrac(r.full_kelly_at_true_p)}
        />
      ),
    },
    {
      key: "ev",
      header: "EV / $",
      align: "right",
      cell: (r) => (
        <SemanticValue value={r.ev_per_dollar} display={fmtSignedPct(r.ev_per_dollar * 100, 2)} />
      ),
    },
    {
      key: "growth",
      header: "Log-growth",
      align: "right",
      cell: (r) => (
        <SemanticValue value={r.growth_rate} display={fmtGrowth(r.growth_rate)} />
      ),
    },
    {
      key: "over",
      header: "Over-betting?",
      align: "right",
      cell: (r) =>
        r.exceeds_full_kelly ? (
          <span style={{ color: "var(--neg)" }}>over full Kelly</span>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>within</span>
        ),
    },
  ];

  return (
    <div style={{ marginTop: "var(--sp-5)" }}>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <Verdict verdict={bankrollVerdictTone(res.no_bet)} />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            color: res.no_bet ? "var(--neg)" : "var(--text-2)",
            marginTop: "var(--sp-1)",
          }}
        >
          {res.verdict}
        </div>
      </div>

      {/* Headline stake + sizing. */}
      <StatGroup min="130px" style={{ marginBottom: "var(--sp-2)" }}>
        <StatCell
          label="Recommended stake"
          value={fmtUsd(res.stake_currency)}
          color={res.no_bet ? "var(--text-muted)" : "var(--pos)"}
        />
        <StatCell
          label="Stake (units)"
          value={fmtUnits(res.stake_units)}
          emphasis="data"
        />
        <StatCell
          label="Full Kelly f*"
          value={
            <SemanticValue value={res.kelly_full} display={fmtFrac(res.kelly_full)} />
          }
          emphasis="data"
        />
        <StatCell
          label={`Used fraction (${res.kelly_multiplier}×)`}
          value={fmtFrac(res.kelly_used_fraction)}
          emphasis="data"
        />
      </StatGroup>

      <StatGroup min="130px">
        <StatCell
          label="EV / $"
          value={
            <SemanticValue value={res.ev_per_dollar} display={fmtSignedPct(res.ev_per_dollar * 100, 2)} />
          }
          emphasis="data"
        />
        <StatCell
          label="EV on stake"
          value={
            <SemanticValue value={res.ev_on_stake} display={fmtUsd(res.ev_on_stake)} />
          }
          emphasis="data"
        />
        <StatCell
          label="Expected log-growth"
          value={
            <SemanticValue value={res.growth_rate} display={fmtGrowth(res.growth_rate)} />
          }
          emphasis="data"
        />
        <StatCell
          label="Bets to double"
          value={res.doubling_bets !== null ? Math.round(res.doubling_bets).toString() : "—"}
          sub={res.doubling_bets === null ? "non-positive growth" : "at this fraction"}
          emphasis="data"
        />
        <StatCell label="Decimal odds" value={fmtDec(res.decimal_odds)} emphasis="data" />
        <StatCell label="Unit size" value={fmtUsd(res.unit_size)} emphasis="data" />
      </StatGroup>

      {/* Fractional-Kelly multiplier table. */}
      {res.multiplier_table.length > 0 && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--fs-meta)",
              fontWeight: "var(--weight-display)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
              color: "var(--text-2)",
              marginBottom: "var(--sp-2)",
            }}
          >
            Fractional-Kelly choices
          </div>
          <DataTable
            columns={[
              {
                key: "label",
                header: "Strategy",
                cell: (r: BankrollRisk["multiplier_table"][number]) =>
                  `${r.label} (${r.multiplier}×)`,
              },
              {
                key: "fraction",
                header: "Fraction",
                align: "right" as const,
                cell: (r: BankrollRisk["multiplier_table"][number]) => fmtFrac(r.fraction),
              },
              {
                key: "stake",
                header: "Stake",
                align: "right" as const,
                cell: (r: BankrollRisk["multiplier_table"][number]) => fmtUsd(r.stake_currency),
              },
              {
                key: "units",
                header: "Units",
                align: "right" as const,
                cell: (r: BankrollRisk["multiplier_table"][number]) => fmtUnits(r.stake_units),
              },
              {
                key: "growth",
                header: "Log-growth",
                align: "right" as const,
                cell: (r: BankrollRisk["multiplier_table"][number]) => (
                  <SemanticValue value={r.growth_rate} display={fmtGrowth(r.growth_rate)} />
                ),
              },
              {
                key: "double",
                header: "Bets to 2×",
                align: "right" as const,
                cell: (r: BankrollRisk["multiplier_table"][number]) =>
                  r.doubling_bets !== null ? Math.round(r.doubling_bets).toString() : "—",
              },
            ]}
            rows={res.multiplier_table}
            rowKey={(_, i) => i}
            caption="Stake + growth at quarter / half / full Kelly"
          />
        </div>
      )}

      {/* Risk of drawdown. */}
      {res.drawdown.length > 0 && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--fs-meta)",
              fontWeight: "var(--weight-display)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
              color: "var(--text-2)",
              marginBottom: "var(--sp-2)",
            }}
          >
            Risk of drawdown (approximate — never zero)
          </div>
          <StatGroup min="130px">
            {res.drawdown.map((d) => (
              <StatCell
                key={d.floor}
                label={`Touch ${fmtFrac(d.floor)} of roll`}
                value={fmtProb(d.prob)}
                color="var(--hold)"
                emphasis="data"
              />
            ))}
          </StatGroup>
        </div>
      )}

      {/* Edge sensitivity. */}
      {res.edge_sensitivity.length > 0 && (
        <div style={{ marginTop: "var(--sp-4)" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--fs-meta)",
              fontWeight: "var(--weight-display)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
              color: "var(--text-2)",
              marginBottom: "var(--sp-2)",
            }}
          >
            Edge sensitivity — what if the true edge is lower?
          </div>
          <DataTable
            columns={sensColumns}
            rows={res.edge_sensitivity}
            rowKey={(_, i) => i}
            caption="Stake + growth if the true edge is over-estimated"
          />
        </div>
      )}

      {/* Honesty caveats — verbatim from the backend, surfaced prominently.
          Advisory framing: full --warn border + --amber-tint wash (NOT the
          reserved --hold orange, which is vig/hold% only). */}
      {res.caveats.length > 0 && (
        <Card
          style={{
            borderColor: "var(--warn)",
            background: "var(--amber-tint)",
            marginTop: "var(--sp-4)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-display)",
              fontSize: "var(--fs-meta)",
              textTransform: "uppercase",
              letterSpacing: "var(--tracking-label)",
              color: "var(--warn)",
              marginBottom: "var(--sp-2)",
            }}
          >
            Read this before sizing
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: "var(--sp-4)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              color: "var(--text)",
              lineHeight: "var(--lh-prose)",
            }}
          >
            {res.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  return (
    <div>
      <div
        className="infield-divider"
        style={{
          marginBottom: "var(--sp-5)",
          paddingBottom: "var(--sp-4)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display-serif)",
            fontWeight: "var(--weight-display)",
            fontSize: "var(--fs-headline)",
            letterSpacing: "0",
            margin: 0,
            textTransform: "uppercase",
            color: "var(--text)",
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
        <BankrollCard />
      </div>
    </div>
  );
}
