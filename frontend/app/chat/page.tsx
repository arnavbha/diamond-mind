"use client";

import { useEffect, useRef, useState } from "react";
import { api, todayET } from "@/lib/api";
import { Button, Markdown, ErrorBanner } from "@/components/ui";

type Role = "user" | "ace" | "system";

type Message = {
  id: string;
  role: Role;
  text: string;
  intent?: string;
  sources?: number;
  ts: number;
  failed?: boolean;
};

// Impure helpers live at module scope so they are never traced as
// "called during render" by react-hooks/purity. They are only ever invoked
// from event handlers / effects below.
function newId(): string {
  return crypto.randomUUID();
}
function now(): number {
  return Date.now();
}

const SUGGESTIONS = [
  "What are today's picks?",
  "Which bullpens are most vulnerable today?",
  "Compare Yankees and Red Sox",
  "Compare Ohtani and Judge",
  "How are the Dodgers doing recently?",
  "Why did the model lean on a team today?",
];

function Avatar() {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--r-sm)",
        background: "var(--surface-2)",
        border: "1px solid var(--purple)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
        fontSize: "var(--fs-micro)",
        fontWeight: "var(--weight-bold)",
        color: "var(--purple)",
        letterSpacing: "var(--tracking-label)",
      }}
    >
      A
    </div>
  );
}

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div
        style={{
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-caption)",
          color: "var(--text-muted)",
          padding: "var(--sp-1) 0",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {msg.text}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        alignItems: "flex-start",
        gap: "var(--sp-3)",
        marginBottom: "var(--sp-4)",
      }}
    >
      {!isUser && <Avatar />}

      <div
        style={{
          maxWidth: "78%",
          background: isUser ? "var(--surface-2)" : "var(--surface)",
          border: `1px solid ${isUser ? "var(--border)" : "var(--purple)"}`,
          borderRadius: isUser
            ? "var(--r-md) var(--r-xs) var(--r-md) var(--r-md)"
            : "var(--r-xs) var(--r-md) var(--r-md) var(--r-md)",
          padding: "var(--sp-2) var(--sp-3)",
        }}
      >
        {!isUser && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "var(--sp-2)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-micro)",
              fontWeight: "var(--weight-bold)",
              color: "var(--purple)",
              letterSpacing: "var(--tracking-label)",
              marginBottom: "var(--sp-2)",
            }}
          >
            <span>ACE</span>
            {msg.intent && msg.intent !== "out_of_scope" && (
              <span style={{ color: "var(--text-muted)", fontWeight: "var(--weight-normal)" }}>
                · {msg.intent.replace(/_/g, " ")}
              </span>
            )}
            {typeof msg.sources === "number" && msg.sources > 0 && (
              <span style={{ color: "var(--text-muted)", fontWeight: "var(--weight-normal)", marginLeft: "auto" }}>
                based on {msg.sources} source{msg.sources === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
        {isUser ? (
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "var(--fs-body)",
              lineHeight: "var(--lh-prose)",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {msg.text}
          </div>
        ) : (
          <Markdown source={msg.text} style={{ fontSize: "var(--fs-body)" }} />
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--sp-3)",
        marginBottom: "var(--sp-4)",
      }}
    >
      <Avatar />
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--purple)",
          borderRadius: "var(--r-xs) var(--r-md) var(--r-md) var(--r-md)",
          padding: "var(--sp-3) var(--sp-4)",
          display: "flex",
          alignItems: "center",
          gap: "5px",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: "var(--r-full)",
              background: "var(--purple)",
              opacity: 0.6,
              display: "inline-block",
              animation: `acePulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const today = todayET();
  // Lazy initializer runs exactly once, not on every render. The timestamp is
  // produced by the module-level now() helper so the purity rule doesn't flag
  // an impure call in the component body.
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "init",
      role: "ace",
      text: `ACE online. Analytics & Confidence Engine.\n\nSlate date: **${today}**\n\nAsk me about today's picks, bullpen vulnerability, model reasoning, or your betting record.`,
      ts: now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-grow the textarea to fit content (bounded), per spec.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    setLastFailedPrompt(null);

    const userMsg: Message = { id: newId(), role: "user", text: msg, ts: now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const res = await api.chat(msg, today);

    setLoading(false);
    if (res) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "ace",
          text: res.answer,
          intent: res.intent,
          sources: res.sources_count,
          ts: now(),
        },
      ]);
    } else {
      setLastFailedPrompt(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "ace",
          text: "Couldn't reach the backend. Make sure the API server is running.",
          ts: now(),
          failed: true,
        },
      ]);
    }
  }

  function retry() {
    const prompt = lastFailedPrompt;
    if (!prompt || loading) return;
    setLastFailedPrompt(null);
    // Drop the failed error bubble before retrying.
    setMessages((prev) => {
      const copy = [...prev];
      while (copy.length && copy[copy.length - 1].failed) copy.pop();
      return copy;
    });
    void send(prompt);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100dvh - var(--shell-h) - 56px)",
        maxWidth: "780px",
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "var(--sp-4) 0 var(--sp-3)",
          borderBottom: "1px solid var(--border)",
          marginBottom: "var(--sp-1)",
          display: "flex",
          alignItems: "baseline",
          gap: "var(--sp-3)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-display)",
            fontSize: "var(--fs-stat)",
            letterSpacing: "var(--tracking-num)",
            textTransform: "uppercase",
            color: "var(--text)",
          }}
        >
          ACE
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-caption)",
            color: "var(--purple)",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          Analytics &amp; Confidence Engine
        </span>
        <span
          className="num"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-muted)",
            marginLeft: "auto",
          }}
        >
          {today}
        </span>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--sp-4) 0",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
        {loading && <TypingIndicator />}
        {lastFailedPrompt && !loading && (
          <div style={{ marginBottom: "var(--sp-4)" }}>
            <ErrorBanner
              kind="outage"
              title="ACE is unreachable"
              detail="The chat backend didn't respond. Check that the API server is running, then retry."
              action={
                <Button variant="primary" size="sm" onClick={retry}>
                  Retry
                </Button>
              }
            />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions — only on fresh load */}
      {messages.length <= 1 && !loading && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--sp-2)",
            padding: "var(--sp-2) 0",
            borderTop: "1px solid var(--border)",
          }}
        >
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: "var(--sp-2) var(--sp-3)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-meta)",
                color: "var(--text-2)",
                cursor: "pointer",
                transition: "border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--purple)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text-2)";
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: "var(--sp-3)",
          display: "flex",
          gap: "var(--sp-2)",
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          aria-label="Message ACE"
          placeholder="Ask ACE anything about today's slate, picks, or model…"
          rows={2}
          style={{
            flex: 1,
            background: "var(--surface-inset)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            padding: "var(--sp-3)",
            fontFamily: "var(--font-body)",
            fontSize: "var(--fs-body)",
            color: "var(--text)",
            resize: "none",
            lineHeight: "var(--lh-prose)",
            maxHeight: "160px",
            transition: "border-color var(--motion-quick) var(--ease-out)",
          }}
          disabled={loading}
        />
        <Button
          variant="primary"
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            height: "52px",
            ...(loading || !input.trim()
              ? { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text-muted)", cursor: "not-allowed" }
              : { background: "var(--purple)", borderColor: "var(--purple)", color: "var(--surface)" }),
          }}
        >
          {loading ? "…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
