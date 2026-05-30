"use client";

import React from "react";

/**
 * Markdown — a SAFE, dependency-free subset renderer for the report page
 * (replaces raw <pre>) and chat (replaces the hand-rolled **bold** parser).
 * Supports: headings (#..######), bold/italic/inline-code, links, unordered &
 * ordered lists, blockquotes, fenced code blocks, simple pipe tables, and
 * horizontal rules. Reduced-motion-aware (no animation here).
 *
 * Safety: we never use dangerouslySetInnerHTML. All text becomes React nodes;
 * links are restricted to http(s)/mailto and rendered with rel="noopener".
 */
export function Markdown({ source, style }: { source: string; style?: React.CSSProperties }) {
  const blocks = parseBlocks(source ?? "");
  return (
    <div
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "var(--fs-body)",
        lineHeight: "var(--lh-prose)",
        color: "var(--text)",
        ...style,
      }}
    >
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

/* ── Block model ─────────────────────────────────────────────────────────── */
type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "para"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }

    // blank
    if (line.trim() === "") {
      i++;
      continue;
    }

    // hr
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    // table: header row + separator row of |---|
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: buf.join(" ") });
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // paragraph (gather until blank / block boundary)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "para", text: buf.join(" ") });
  }

  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/* ── Block renderers ─────────────────────────────────────────────────────── */
function Block({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${Math.min(block.level + 1, 6)}` as React.ElementType);
      const size =
        block.level === 1 ? "var(--fs-headline)" : block.level === 2 ? "var(--fs-stat)" : "var(--fs-data)";
      return (
        <Tag
          style={{
            margin: "var(--sp-4) 0 var(--sp-2)",
            fontFamily: "var(--font-display)",
            fontSize: size,
            fontWeight: "var(--weight-bold)",
            color: "var(--text)",
            lineHeight: "var(--lh-tight)",
          }}
        >
          <Inline text={block.text} />
        </Tag>
      );
    }
    case "para":
      return (
        <p style={{ margin: "0 0 var(--sp-3)" }}>
          <Inline text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul style={{ margin: "0 0 var(--sp-3)", paddingLeft: "var(--sp-5)" }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ marginBottom: "var(--sp-1)" }}>
              <Inline text={it} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol style={{ margin: "0 0 var(--sp-3)", paddingLeft: "var(--sp-5)" }}>
          {block.items.map((it, i) => (
            <li key={i} style={{ marginBottom: "var(--sp-1)" }}>
              <Inline text={it} />
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote
          style={{
            margin: "0 0 var(--sp-3)",
            padding: "var(--sp-2) var(--sp-3)",
            borderLeft: "2px solid var(--clay)",
            color: "var(--text-2)",
          }}
        >
          <Inline text={block.text} />
        </blockquote>
      );
    case "code":
      return (
        <pre
          style={{
            margin: "0 0 var(--sp-3)",
            padding: "var(--sp-3)",
            background: "var(--surface-inset)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--r-sm)",
            overflowX: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-meta)",
            color: "var(--text-2)",
            lineHeight: "var(--lh-data)",
          }}
        >
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div style={{ overflowX: "auto", margin: "0 0 var(--sp-3)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>
            <thead>
              <tr>
                {block.header.map((h, i) => (
                  <th key={i} style={cellStyle(true)}>
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} style={cellStyle(false)}>
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "var(--sp-4) 0" }} />;
  }
}

function cellStyle(head: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "var(--sp-1) var(--sp-3)",
    borderBottom: "1px solid var(--border)",
    color: head ? "var(--text-2)" : "var(--text)",
    fontWeight: head ? ("var(--weight-semibold)" as unknown as number) : undefined,
    whiteSpace: "nowrap",
  };
}

/* ── Inline renderer (bold / italic / code / links) ──────────────────────── */
function Inline({ text }: { text: string }): React.ReactElement {
  return <>{parseInline(text)}</>;
}

const INLINE_RE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function parseInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  INLINE_RE.lastIndex = 0;

  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key++} style={{ fontWeight: "var(--weight-bold)", color: "var(--text)" }}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={key++}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.92em",
            background: "var(--surface-inset)",
            padding: "0 var(--sp-1)",
            borderRadius: "var(--r-xs)",
            color: "var(--text)",
          }}
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm && isSafeHref(lm[2])) {
        out.push(
          <a key={key++} href={lm[2]} target="_blank" rel="noopener noreferrer" style={{ color: "var(--lean)" }}>
            {lm[1]}
          </a>
        );
      } else if (lm) {
        out.push(lm[1]);
      } else {
        out.push(tok);
      }
    } else {
      // *italic* / _italic_
      out.push(<em key={key++} style={{ fontStyle: "italic" }}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}
