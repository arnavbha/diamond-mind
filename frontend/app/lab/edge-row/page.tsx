"use client";

// ── /lab/edge-row — nav-less motion-identity bench (ISOLATED) ───────────────
// Full-bleed surface PORTALED to <body> so it escapes the root layout's <main>
// stacking context and fully covers the app chrome (nav/ticker). The divergence
// gesture is judged here as an identity, not a table row. Two type treatments.
// Not wired into the app. See memory: frontend_redesign_direction.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DivergenceHero, type Treatment } from "@/components/lab/divergence-hero";
import { DivergenceEdgeRow } from "@/components/lab/divergence-edge-row";

const INK = "#0A0B0D", TEXT = "#E7ECF2", MUTED = "#727C88", FAINT = "#2A3038",
  AMBER = "#D99A34", GRAPHITE = "#7C8B9C", BORDER = "#1B2027";

export default function DivergenceLab() {
  const [mounted, setMounted] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [treatment, setTreatment] = useState<Treatment>("scoreboard");
  useEffect(() => setMounted(true), []);

  const toggle = (t: Treatment, label: string) => (
    <button onClick={() => setTreatment(t)} style={{
      background: "transparent", cursor: "pointer",
      border: `1px solid ${treatment === t ? AMBER : BORDER}`,
      color: treatment === t ? AMBER : MUTED,
      fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.1em",
      fontSize: 11, padding: "6px 12px", borderRadius: 6,
    }}>{label}</button>
  );

  const content = (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", zIndex: 2147483000, background: INK,
      color: TEXT, fontFamily: "var(--font-mono)" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 28px 80px" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <svg width="24" height="24" viewBox="0 0 26 26" aria-hidden="true">
            <path d="M11 5 L16 10 L11 15 L6 10 Z" fill={GRAPHITE} />
            <path d="M15 3 L20 8 L15 13 L10 8 Z" fill={AMBER} fillOpacity="0.9" />
          </svg>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em",
            fontSize: 14, textTransform: "uppercase" }}>Diamond Mind</span>
          <span style={{ fontSize: 11, color: FAINT, letterSpacing: "0.14em" }}>PROTOTYPE</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {toggle("scoreboard", "Scoreboard")}
            {toggle("editorial", "Editorial")}
            <button onClick={() => setPlayKey((k) => k + 1)} style={{
              background: "#14171C", border: `1px solid ${BORDER}`, color: TEXT, cursor: "pointer",
              fontFamily: "var(--font-mono)", fontSize: 12, padding: "6px 14px", borderRadius: 6, marginLeft: 4,
            }}>↻ Replay</button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 64 }}>
          <div style={{ fontSize: 12, color: MUTED, letterSpacing: "0.06em", marginBottom: 40 }}>
            PIT @ PHI · moneyline · Pittsburgh
          </div>

          <DivergenceHero playKey={playKey} treatment={treatment} away="PIT" home="PHI"
            market="moneyline · Pittsburgh" marketProb={41.2} modelProb={47.6} edge={6.4} confidence={71} />

          <div style={{ marginTop: 28, fontSize: 14, color: MUTED, fontFamily: "var(--font-body)" }}>
            The market hasn&apos;t moved off 41%. We hold 48% — and the line hasn&apos;t budged.
          </div>
        </div>

        <div style={{ marginTop: 96 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
            <span style={{ fontSize: 10, letterSpacing: "0.16em", color: FAINT }}>THE SAME READ, COMPACT</span>
            <div style={{ flex: 1, height: 1, background: BORDER }} />
          </div>
          <DivergenceEdgeRow playKey={playKey} away="SEA" home="TEX"
            market="moneyline · Seattle" marketProb={53} modelProb={57.8} edge={4.8} confidence={63} />
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}
