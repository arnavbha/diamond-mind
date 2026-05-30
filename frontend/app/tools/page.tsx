"use client";

import { useState } from "react";
import {
  api,
  type BoostEv,
  type ParlayEv,
  type ParlayLegBody,
} from "@/lib/api";

// ── shared atoms ────────────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  step = 1,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: number;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "8px 10px",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: "14px",
          fontWeight: 600,
          outline: "none",
          width: "100%",
        }}
      />
      {hint && (
        <span style={{ fontSize: "9px", color: "var(--text-3)" }}>{hint}</span>
      )}
    </label>
  );
}

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
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "4px",
          padding: "8px 10px",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          fontWeight: 600,
          outline: "none",
          width: "100%",
        }}
      />
      {hint && (
        <span style={{ fontSize: "9px", color: "var(--text-3)" }}>{hint}</span>
      )}
    </label>
  );
}

function verdictColor(v: "+EV" | "marginal" | "-EV"): string {
  return v === "+EV"
    ? "var(--green)"
    : v === "-EV"
      ? "var(--red)"
      : "var(--text-2)";
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "18px",
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: "16px",
          letterSpacing: "-0.01em",
          margin: 0,
          textTransform: "uppercase",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-3)",
          marginTop: "4px",
          marginBottom: "16px",
        }}
      >
        {subtitle}
      </div>
      {children}
    </div>
  );
}

function StatBlock({
  k,
  v,
  color,
  big,
}: {
  k: string;
  v: string;
  color?: string;
  big?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--surface-2, var(--surface))",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: "9px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-3)",
        }}
      >
        {k}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: big ? "22px" : "15px",
          color: color ?? "var(--text)",
          marginTop: "4px",
        }}
      >
        {v}
      </div>
    </div>
  );
}

const fmtPct = (x: number, d = 1) => `${x.toFixed(d)}%`;
const fmtSignedPct = (x: number, d = 2) =>
  `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
const fmtDec = (x: number) => x.toFixed(4);

// ── Profit-Boost EV calculator ──────────────────────────────────────────────

function BoostCard() {
  const [odds, setOdds] = useState("-110");
  const [boostPct, setBoostPct] = useState("33");
  const [fairProb, setFairProb] = useState("52");
  const [res, setRes] = useState<BoostEv | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setErr(null);
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
      setErr("Backend rejected these inputs or is unreachable.");
      setRes(null);
      return;
    }
    setRes(r);
  }

  return (
    <Card
      title="Profit-Boost EV"
      subtitle="Is a profit boost actually +EV? Boost lifts NET PROFIT only — never the stake. Verification, not a pick."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        <NumField
          label="American odds"
          value={odds}
          onChange={setOdds}
          step={5}
          hint="the line you'd bet"
        />
        <NumField
          label="Boost %"
          value={boostPct}
          onChange={setBoostPct}
          step={5}
          hint="e.g. 33 for a 33% boost"
        />
        <NumField
          label="Fair win %"
          value={fairProb}
          onChange={setFairProb}
          step={1}
          hint="your no-vig prob 0–100"
        />
      </div>

      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          background: "var(--blue)",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          padding: "9px 18px",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: "13px",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Checking…" : "Check boost"}
      </button>

      {err && (
        <div
          style={{
            marginTop: "14px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--red)",
            border: "1px solid var(--red)",
            borderRadius: "4px",
            padding: "10px 12px",
          }}
        >
          {err}
        </div>
      )}

      {res && (
        <div style={{ marginTop: "16px" }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "26px",
              fontWeight: 800,
              textTransform: "uppercase",
              color: verdictColor(res.verdict),
              lineHeight: 1,
              marginBottom: "12px",
            }}
          >
            {res.verdict}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: "8px",
            }}
          >
            <StatBlock
              k="EV %"
              v={fmtSignedPct(res.ev_pct, 2)}
              color={res.ev_pct >= 0 ? "var(--green)" : "var(--red)"}
              big
            />
            <StatBlock
              k="Boosted line"
              v={
                res.boosted_american !== null
                  ? (res.boosted_american > 0 ? "+" : "") +
                    res.boosted_american
                  : fmtDec(res.boosted_decimal)
              }
            />
            <StatBlock
              k="Break-even prob"
              v={fmtPct(res.breakeven_prob * 100, 2)}
            />
            <StatBlock
              k="Edge vs break-even"
              v={fmtSignedPct(res.edge_vs_breakeven * 100, 2)}
              color={
                res.edge_vs_breakeven >= 0 ? "var(--green)" : "var(--red)"
              }
            />
          </div>
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
      setErr("Backend rejected these inputs or is unreachable.");
      setRes(null);
      return;
    }
    setRes(r);
  }

  return (
    <Card
      title="Parlay / SGP Checker"
      subtitle="How big is the book's compounded hold on this parlay? Fair price is computed under the INDEPENDENCE assumption (product of each leg's vig-free prob). Verification, not a pick."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {legs.map((l, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "var(--text-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Leg {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeLeg(i)}
                disabled={legs.length <= 2}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color:
                    legs.length <= 2 ? "var(--text-3)" : "var(--red)",
                  borderRadius: "4px",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  padding: "3px 8px",
                  cursor: legs.length <= 2 ? "default" : "pointer",
                  opacity: legs.length <= 2 ? 0.5 : 1,
                }}
              >
                remove
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(110px, 1fr))",
                gap: "10px",
              }}
            >
              <TextField
                label="Label"
                value={l.label}
                onChange={(v) => updateLeg(i, { label: v })}
                placeholder="Yankees ML"
              />
              <NumField
                label="American odds"
                value={l.american}
                onChange={(v) => updateLeg(i, { american: v })}
                step={5}
                hint="required, != 0"
              />
              <NumField
                label="Opposite odds"
                value={l.opposite_american}
                onChange={(v) => updateLeg(i, { opposite_american: v })}
                step={5}
                hint="optional · enables devig"
              />
              <NumField
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
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "12px" }}>
        <button
          type="button"
          onClick={addLeg}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            color: "var(--text-2)",
            borderRadius: "6px",
            padding: "7px 14px",
            fontFamily: "var(--font-ui)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Add leg
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "12px",
          marginTop: "16px",
        }}
      >
        <NumField
          label="Offered parlay price"
          value={offered}
          onChange={setOffered}
          step={5}
          hint="book's American price, != 0"
        />
        <NumField
          label="Stake (units)"
          value={stake}
          onChange={setStake}
          step={1}
          hint="> 0"
        />
      </div>

      <div style={{ marginTop: "14px" }}>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          style={{
            background: "var(--blue)",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            padding: "9px 18px",
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: "13px",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Checking…" : "Check parlay"}
        </button>
      </div>

      {err && (
        <div
          style={{
            marginTop: "14px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--red)",
            border: "1px solid var(--red)",
            borderRadius: "4px",
            padding: "10px 12px",
          }}
        >
          {err}
        </div>
      )}

      {res && <ParlayResult res={res} />}
    </Card>
  );
}

function ParlayResult({ res }: { res: ParlayEv }) {
  return (
    <div style={{ marginTop: "18px" }}>
      {/* Correlation honesty — surfaced FIRST and prominently when present. */}
      {res.correlated && res.correlation_warning && (
        <div
          style={{
            border: "1px solid var(--red)",
            borderRadius: "6px",
            padding: "12px 14px",
            marginBottom: "16px",
            background: "color-mix(in srgb, var(--red) 8%, transparent)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--red)",
              marginBottom: "6px",
            }}
          >
            Same-game correlation warning
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text)",
              lineHeight: 1.5,
            }}
          >
            {res.correlation_warning}
          </div>
          {res.correlated_groups.length > 0 && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--text-3)",
                marginTop: "8px",
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
        </div>
      )}

      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "26px",
          fontWeight: 800,
          textTransform: "uppercase",
          color: verdictColor(res.verdict),
          lineHeight: 1,
          marginBottom: "4px",
        }}
      >
        {res.verdict}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-3)",
          marginBottom: "14px",
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
            fontSize: "11px",
            color: "var(--text-2)",
            marginBottom: "14px",
            paddingLeft: "8px",
            borderLeft: "2px solid var(--border)",
          }}
        >
          {res.verdict_caveat}
        </div>
      )}

      {/* Headline: the compounded hold. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <StatBlock
          k="Compounded parlay hold"
          v={fmtPct(res.parlay_hold_pct, 2)}
          color="var(--red)"
          big
        />
        <StatBlock
          k="EV %"
          v={fmtSignedPct(res.ev_pct, 2)}
          color={res.ev_pct >= 0 ? "var(--green)" : "var(--red)"}
          big
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: "8px",
        }}
      >
        <StatBlock k="Fair decimal" v={fmtDec(res.fair_parlay_decimal)} />
        <StatBlock k="Offered decimal" v={fmtDec(res.offered_decimal)} />
        <StatBlock
          k="Fair parlay prob"
          v={fmtPct(res.fair_parlay_prob * 100, 2)}
        />
        <StatBlock
          k="Offered implied prob"
          v={fmtPct(res.offered_implied_parlay_prob * 100, 2)}
        />
        {res.book_compounded_hold_pct !== null && (
          <StatBlock
            k="Structural book hold"
            v={fmtPct(res.book_compounded_hold_pct, 2)}
            color="var(--red)"
          />
        )}
        {res.single_leg_hold_avg_pct !== null && (
          <StatBlock
            k="Avg single-leg hold"
            v={fmtPct(res.single_leg_hold_avg_pct, 2)}
          />
        )}
        <StatBlock
          k="EV (units)"
          v={fmtSignedPct(res.ev_units * 100, 2).replace("%", "")}
          color={res.ev_units >= 0 ? "var(--green)" : "var(--red)"}
        />
        <StatBlock
          k="Edge vs break-even"
          v={fmtSignedPct(res.edge_vs_breakeven * 100, 2)}
          color={res.edge_vs_breakeven >= 0 ? "var(--green)" : "var(--red)"}
        />
      </div>

      {/* Per-leg breakdown */}
      <div style={{ marginTop: "16px", overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
          }}
        >
          <thead>
            <tr style={{ color: "var(--text-3)", textAlign: "left" }}>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Leg</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Odds</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Fair prob</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Source</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Leg hold</th>
            </tr>
          </thead>
          <tbody>
            {res.legs.map((leg, i) => (
              <tr
                key={i}
                style={{ borderTop: "1px solid var(--border)", color: "var(--text-2)" }}
              >
                <td style={{ padding: "6px 8px", color: "var(--text)" }}>
                  {leg.label ?? `Leg ${i + 1}`}
                  {leg.game_tag ? (
                    <span style={{ color: "var(--text-3)" }}> · {leg.game_tag}</span>
                  ) : null}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {leg.american > 0 ? "+" : ""}
                  {leg.american}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {fmtPct(leg.fair_prob * 100, 2)}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {leg.prob_source}
                  {leg.vig_loaded ? (
                    <span style={{ color: "var(--red)" }}> · vig-loaded</span>
                  ) : null}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {leg.leg_hold_pct !== null
                    ? fmtPct(leg.leg_hold_pct, 2)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          marginBottom: "22px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: "22px",
            letterSpacing: "-0.02em",
            margin: 0,
            textTransform: "uppercase",
          }}
        >
          Tools
        </h1>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-3)",
            marginTop: "4px",
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
          gap: "20px",
        }}
      >
        <BoostCard />
        <ParlayCard />
      </div>
    </div>
  );
}
