"""LLM synthesis layer — Groq (Llama 3.3 70B).

Takes retrieved context docs + the user's question and returns a
grounded prose answer with citations. Never invents stats.
"""

from __future__ import annotations

import json
import os
from datetime import date
from typing import Any, Optional

GROQ_MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = """You are ARIA, the Diamond Mind baseball intelligence assistant.

Diamond Mind is a quant MLB betting model. You answer questions using ONLY the structured data retrieved from the Diamond Mind database — never from general baseball knowledge.

Rules:
- Answer only from the CONTEXT provided. If context is empty or insufficient, say "I don't have enough data to answer that."
- Cite the source of each key fact: pick date, tier, team, market.
- Never invent odds, probabilities, player names, or stats.
- Never say "lock", "guaranteed", "hammer", "free money", or "must bet".
- Signal tiers: Strong Lean / Lean / Pass / Avoid / Need More Info.
- For any pick recommendation, append: "⚠ All signals are probabilistic. Bet within your bankroll."
- Be direct and concise. Lead with the answer, then the supporting data.
- If data is from a past date, clearly note it.
- Format numbers cleanly: odds as +120 / -145, percentages as 62%, units as +1.4u.

Tone: sharp, data-first, no filler, no hype. Terminal intelligence, not sports talk radio.
"""


def _format_context(intent: str, docs: list[dict]) -> str:
    """Convert retrieved docs to a readable context block for the prompt."""
    if not docs:
        return "No data found."

    lines: list[str] = []

    if intent in ("pick_today", "pick_date", "pick_team"):
        lines.append("PICKS DATA:")
        for d in docs:
            away = d.get("away_abbr", "?")
            home = d.get("home_abbr", "?")
            result_str = f" → {d['result']}" if d.get("result") else " (pending)"
            units_str = f" ({d['units_returned']:+.2f}u)" if d.get("units_returned") is not None else ""
            lines.append(
                f"  [{d.get('game_date')}] {away}@{home} | {d.get('market','?').upper()} "
                f"| {d.get('tier','?')} | Pick: {d.get('selection','?')} "
                f"({d.get('american_odds','')}){result_str}{units_str}"
            )
            if d.get("total_line"):
                lines.append(f"    Total line: {d['total_line']} | Projected: {d.get('projected_total', '?')}")

    elif intent == "tracker_record":
        for block in docs:
            if block["type"] == "overall":
                lines.append(f"OVERALL RECORD (last {block['window_days']} days):")
                for r in block["rows"]:
                    lines.append(f"  {r['result']}: {r['count']} bets | {r['total_units']:+.2f}u")
            elif block["type"] == "by_tier":
                lines.append("BY TIER:")
                for r in block["rows"]:
                    lines.append(f"  {r['tier']} | {r['result']}: {r['count']} | {r['total_units']:+.2f}u")
            elif block["type"] == "pending":
                lines.append(f"Pending (unsettled): {block['count']} bets")

    elif intent == "bullpen_today":
        lines.append("BULLPEN VULNERABILITY (highest → lowest):")
        for d in docs[:10]:
            vuln = d.get("vulnerability_score")
            fatigue = d.get("fatigue_score")
            vuln_str = f"{vuln:.0f}" if vuln is not None else "N/A"
            fatigue_str = f"{fatigue:.1f}" if fatigue is not None else "N/A"
            lines.append(
                f"  {d.get('abbr','?'):4s} vuln={vuln_str}/100  fatigue={fatigue_str}  "
                f"as_of={d.get('as_of_date','?')}"
            )

    elif intent == "model_explain":
        lines.append("MODEL EVALUATION DATA:")
        for d in docs:
            away = d.get("away_abbr", "?")
            home = d.get("home_abbr", "?")
            lines.append(
                f"  {away}@{home} | {d.get('market','?')} | Pick: {d.get('selection','?')} "
                f"| Rec: {d.get('recommendation','?')} | Edge: {d.get('edge', 0):.1%} "
                f"| Confidence: {d.get('confidence_score', 0):.0%}"
            )
            if d.get("supporting_factors"):
                try:
                    factors = json.loads(d["supporting_factors"])
                    lines.append(f"    Supporting: {'; '.join(str(f) for f in factors[:3])}")
                except Exception:
                    lines.append(f"    Supporting: {d['supporting_factors'][:200]}")
            if d.get("opposing_factors"):
                try:
                    factors = json.loads(d["opposing_factors"])
                    lines.append(f"    Opposing: {'; '.join(str(f) for f in factors[:2])}")
                except Exception:
                    pass
            if d.get("what_would_change_the_answer"):
                lines.append(f"    Flip trigger: {d['what_would_change_the_answer'][:150]}")

    return "\n".join(lines) if lines else "No data found."


OUT_OF_SCOPE_RESPONSE = """Diamond Mind covers moneyline and totals only — I don't have data to answer that.

Here's what I can help with:
• **Today's picks** — "What are today's leans?"
• **Past picks** — "What were the picks on 2026-05-20?"
• **Team history** — "Show me recent Yankees picks"
• **Bullpen vulnerability** — "Which bullpens are most vulnerable today?"
• **Model reasoning** — "Why did the model like the Phillies?"
• **Track record** — "What's our record this month?" """


def synthesize(
    intent: str,
    question: str,
    context_docs: list[dict],
    today: date,
    groq_api_key: str,
) -> str:
    """Call Groq and return a grounded answer string."""
    if intent == "out_of_scope":
        return OUT_OF_SCOPE_RESPONSE

    if not context_docs:
        return "I don't have enough data to answer that. The database may not have records for the requested date or team."

    context_text = _format_context(intent, context_docs)

    user_message = f"""Today's date: {today}

CONTEXT:
{context_text}

USER QUESTION: {question}

Answer using only the context above."""

    try:
        from groq import Groq
        client = Groq(api_key=groq_api_key)
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.2,
            max_tokens=600,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        return f"Error reaching language model: {e}. Retrieved data: {context_text[:400]}"
