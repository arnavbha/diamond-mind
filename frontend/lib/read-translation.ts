// ── Plain-English read layer for the Morning Brief ───────────────────────────
// Deterministically translates the analyzer's headline key_factor string into
// (1) a baseball-reality sentence and (2) a why-it-matters line, per the Brief
// rule: baseball first, market second. Pattern table over the exact f-string
// templates in app/betting/game_analyzer.py — no LLM, no invented numbers.
// The raw factor stays visible in Research (game detail Key Factors); this is
// only the Brief's headline voice. Unknown patterns fall back to a generic
// lean-based sentence so a new analyzer factor can never break the page.

import type { GameAnalysis } from "@/lib/api";

export type TranslatedRead = { reality: string; why: string };

type Ctx = { home: string; away: string };

const WHY = {
  pitching: "The market hasn't fully priced the pitching gap.",
  bullpen: "The market hasn't priced how thin that bullpen is tonight.",
  offense: "The market moves slower on recent form than the model does.",
  regression: "The market is pricing the results, not the underlying skill.",
  generic: "The model sees a bigger gap than the market is pricing.",
} as const;

// Each rule: match the analyzer's template, produce a plain sentence. `side`
// resolution: HOME/AWAY tokens → team abbrs from the game context.
const RULES: {
  re: RegExp;
  make: (m: RegExpMatchArray, side: (s: string) => string, ctx: Ctx) => TranslatedRead;
}[] = [
  {
    re: /^(HOME|AWAY) SP edge: (.+?) FIP [\d.]+ vs (.+?) FIP [\d.]+/,
    make: (m, side) => ({
      reality: `${side(m[1])} has the stronger starting pitcher tonight — ${m[2]} against ${m[3]}.`,
      why: WHY.pitching,
    }),
  },
  {
    re: /^(.+?) \((HOME|AWAY)\) FIP [\d.]+ — (.+?) lacks SP sample/,
    make: (m, side) => ({
      reality: `${m[1]} is the only starter tonight with an established track record.`,
      why: WHY.pitching,
    }),
  },
  {
    re: /^(HOME|AWAY) SP K\/9 edge: (.+?) [\d.]+ K\/9/,
    make: (m, side) => ({
      reality: `${m[2]} misses a lot of bats — a real strikeout edge for ${side(m[1])}.`,
      why: WHY.pitching,
    }),
  },
  {
    re: /^(HOME|AWAY) K matchup: /,
    make: (m, side) => ({
      reality: `${side(m[1])}'s starter brings swing-and-miss stuff against a lineup that strikes out a lot.`,
      why: WHY.pitching,
    }),
  },
  {
    re: /^(HOME|AWAY) bullpen exposed: .*for (HOME|AWAY)/,
    make: (m, side) => ({
      reality: `${side(m[1])}'s bullpen is running on fumes tonight — an edge for ${side(m[2])}.`,
      why: WHY.bullpen,
    }),
  },
  {
    re: /^(HOME|AWAY) offense edge: /,
    make: (m, side) => ({
      reality: `${side(m[1])} has been the clearly better offense lately.`,
      why: WHY.offense,
    }),
  },
  {
    re: /^(HOME|AWAY) form edge: /,
    make: (m, side) => ({
      reality: `${side(m[1])} comes in playing the better baseball of the two.`,
      why: WHY.offense,
    }),
  },
  {
    re: /^HOME elite at home: (\d+)-(\d+)/,
    make: (m, _side, ctx) => ({
      reality: `${ctx.home} has been excellent at home this season (${m[1]}-${m[2]}).`,
      why: WHY.offense,
    }),
  },
  {
    re: /^AWAY poor on road: (\d+)-(\d+)/,
    make: (m, _side, ctx) => ({
      reality: `${ctx.away} has struggled on the road this season (${m[1]}-${m[2]}).`,
      why: WHY.offense,
    }),
  },
  {
    re: /^(HOME|AWAY) dominates season series: (\d+)-(\d+)/,
    make: (m, side) => ({
      reality: `${side(m[1])} has owned this matchup this year (${m[2]}-${m[3]} head-to-head).`,
      why: WHY.offense,
    }),
  },
  {
    re: /^(HOME|AWAY) lineup patient: /,
    make: (m, side) => ({
      reality: `${side(m[1])}'s lineup works deep counts and keeps getting on base.`,
      why: WHY.offense,
    }),
  },
  {
    re: /^(HOME|AWAY) SP BABIP .*positive regression/,
    make: (m, side) => ({
      reality: `${side(m[1])}'s starter has been genuinely unlucky — his numbers look worse than he's pitched.`,
      why: WHY.regression,
    }),
  },
  {
    re: /^(HOME|AWAY) SP ERA \([\d.]+\) above FIP/,
    make: (m, side) => ({
      reality: `${side(m[1])}'s starter has pitched better than his ERA shows.`,
      why: WHY.regression,
    }),
  },
  {
    re: /^(HOME|AWAY) speed game: /,
    make: (m, side) => ({
      reality: `${side(m[1])} brings real base-stealing speed into this one.`,
      why: WHY.offense,
    }),
  },
];

function leanAbbrOf(a: GameAnalysis): string | null {
  if (a.ml_lean === "HOME") return a.home_team_abbr;
  if (a.ml_lean === "AWAY") return a.away_team_abbr;
  return a.ml_lean && a.ml_lean !== "PASS" ? a.ml_lean : null;
}

export function translateRead(a: GameAnalysis): TranslatedRead {
  const ctx: Ctx = { home: a.home_team_abbr, away: a.away_team_abbr };
  const side = (s: string) => (s === "HOME" ? ctx.home : ctx.away);
  const factor = a.key_factors[0];

  if (factor) {
    for (const rule of RULES) {
      const m = factor.match(rule.re);
      if (m) return rule.make(m, side, ctx);
    }
  }

  // Unknown factor shape (or none): fall back to the lean, never to jargon.
  const lean = leanAbbrOf(a);
  return {
    reality: lean
      ? `The model likes ${lean} more than tonight's price suggests.`
      : "The model and the market read this game differently.",
    why: WHY.generic,
  };
}
