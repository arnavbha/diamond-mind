// ── Plain-English read layer for the Morning Brief ───────────────────────────
// Deterministically translates the analyzer's headline key_factor string into
// (1) a baseball-reality sentence and (2) a why-it-matters line, per the Brief
// rule: baseball first, market second. Pattern table over the exact f-string
// templates in app/betting/game_analyzer.py — no LLM, no invented numbers.
// The raw factor stays visible in Research (game detail Key Factors); this is
// only the Brief's headline voice. Unknown patterns fall back to a generic
// lean-based sentence so a new analyzer factor can never break the page.
//
// The why-line is drawn from a small per-category pool, rotated by the read's
// rank (`variant`), so two adjacent reads never repeat the same sentence —
// the deterministic layer shouldn't sound like a template even when it is one.

import type { GameAnalysis } from "@/lib/api";

export type TranslatedRead = { reality: string; why: string };

type Category = "pitching" | "bullpen" | "offense" | "regression" | "generic";
type Ctx = { home: string; away: string };

const WHY: Record<Category, string[]> = {
  pitching: [
    "The market hasn't fully priced the pitching gap.",
    "The line still treats the mound matchup as closer than it is.",
    "The price hasn't caught up to the gap on the mound.",
  ],
  bullpen: [
    "The market hasn't priced how thin that bullpen is tonight.",
    "The line doesn't reflect a pen running on empty.",
  ],
  offense: [
    "The market moves slower on recent form than the model does.",
    "The line is still pricing last month's version of this team.",
    "The price hasn't adjusted to how these teams are actually playing.",
  ],
  regression: [
    "The market is pricing the results, not the underlying skill.",
    "The line is buying the ERA, not the pitching.",
  ],
  generic: [
    "The model sees a bigger gap than the market is pricing.",
    "The price and the model disagree by more than usual.",
  ],
};

// Each rule: match the analyzer's template, produce a plain sentence + the
// category its why-line draws from. `side` resolves HOME/AWAY → team abbrs.
const RULES: {
  re: RegExp;
  make: (m: RegExpMatchArray, side: (s: string) => string, ctx: Ctx) => { reality: string; cat: Category };
}[] = [
  {
    re: /^(HOME|AWAY) SP edge: (.+?) FIP [\d.]+ vs (.+?) FIP [\d.]+/,
    make: (m, side) => ({
      reality: `${side(m[1])} has the stronger starting pitcher tonight — ${m[2]} against ${m[3]}.`,
      cat: "pitching",
    }),
  },
  {
    re: /^(.+?) \((HOME|AWAY)\) FIP [\d.]+ — (.+?) lacks SP sample/,
    make: (m) => ({
      reality: `${m[1]} is the only starter tonight with an established track record.`,
      cat: "pitching",
    }),
  },
  {
    re: /^(HOME|AWAY) SP K\/9 edge: (.+?) [\d.]+ K\/9/,
    make: (m, side) => ({
      reality: `${m[2]} misses a lot of bats — a real strikeout edge for ${side(m[1])}.`,
      cat: "pitching",
    }),
  },
  {
    re: /^(HOME|AWAY) K matchup: /,
    make: (m, side) => ({
      reality: `${side(m[1])}'s starter brings swing-and-miss stuff against a lineup that strikes out a lot.`,
      cat: "pitching",
    }),
  },
  {
    re: /^(HOME|AWAY) bullpen exposed: .*for (HOME|AWAY)/,
    make: (m, side) => ({
      reality: `${side(m[1])}'s bullpen is running on fumes tonight — an edge for ${side(m[2])}.`,
      cat: "bullpen",
    }),
  },
  {
    re: /^(HOME|AWAY) offense edge: /,
    make: (m, side) => ({
      reality: `${side(m[1])} has been the clearly better offense lately.`,
      cat: "offense",
    }),
  },
  {
    re: /^(HOME|AWAY) form edge: /,
    make: (m, side) => ({
      reality: `${side(m[1])} comes in playing the better baseball of the two.`,
      cat: "offense",
    }),
  },
  {
    re: /^HOME elite at home: (\d+)-(\d+)/,
    make: (m, _side, ctx) => ({
      reality: `${ctx.home} has been excellent at home this season (${m[1]}-${m[2]}).`,
      cat: "offense",
    }),
  },
  {
    re: /^AWAY poor on road: (\d+)-(\d+)/,
    make: (m, _side, ctx) => ({
      reality: `${ctx.away} has struggled on the road this season (${m[1]}-${m[2]}).`,
      cat: "offense",
    }),
  },
  {
    re: /^(HOME|AWAY) dominates season series: (\d+)-(\d+)/,
    make: (m, side) => ({
      reality: `${side(m[1])} has owned this matchup this year (${m[2]}-${m[3]} head-to-head).`,
      cat: "offense",
    }),
  },
  {
    re: /^(HOME|AWAY) lineup patient: /,
    make: (m, side) => ({
      reality: `${side(m[1])}'s lineup works deep counts and keeps getting on base.`,
      cat: "offense",
    }),
  },
  {
    re: /^(HOME|AWAY) SP BABIP .*positive regression/,
    make: (m, side) => ({
      reality: `${side(m[1])}'s starter has been genuinely unlucky — his numbers look worse than he's pitched.`,
      cat: "regression",
    }),
  },
  {
    re: /^(HOME|AWAY) SP ERA \([\d.]+\) above FIP/,
    make: (m, side) => ({
      reality: `${side(m[1])}'s starter has pitched better than his ERA shows.`,
      cat: "regression",
    }),
  },
  {
    re: /^(HOME|AWAY) speed game: /,
    make: (m, side) => ({
      reality: `${side(m[1])} brings real base-stealing speed into this one.`,
      cat: "offense",
    }),
  },
];

function leanAbbrOf(a: GameAnalysis): string | null {
  if (a.ml_lean === "HOME") return a.home_team_abbr;
  if (a.ml_lean === "AWAY") return a.away_team_abbr;
  return a.ml_lean && a.ml_lean !== "PASS" ? a.ml_lean : null;
}

export function translateRead(a: GameAnalysis, variant = 0): TranslatedRead {
  const ctx: Ctx = { home: a.home_team_abbr, away: a.away_team_abbr };
  const side = (s: string) => (s === "HOME" ? ctx.home : ctx.away);
  const factor = a.key_factors[0];

  if (factor) {
    for (const rule of RULES) {
      const m = factor.match(rule.re);
      if (m) {
        const { reality, cat } = rule.make(m, side, ctx);
        return { reality, why: WHY[cat][variant % WHY[cat].length] };
      }
    }
  }

  // Unknown factor shape (or none): fall back to the lean, never to jargon.
  const lean = leanAbbrOf(a);
  return {
    reality: lean
      ? `The model likes ${lean} more than tonight's price suggests.`
      : "The model and the market read this game differently.",
    why: WHY.generic[variant % WHY.generic.length],
  };
}
