"use client";

import { useEffect, useRef, useState } from "react";
import { api, todayET } from "@/lib/api";

type Role = "user" | "ace" | "system";

type Message = {
  id: string;
  role: Role;
  text: string;
  intent?: string;
  sources?: number;
  ts: number;
};

const SUGGESTIONS = [
  "What are today's picks?",
  "Which bullpens are most vulnerable today?",
  "What's our record this month?",
  "Why did the model lean on a team today?",
  "Show me recent Yankees picks",
];

function renderText(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
    return (
      <span key={i} style={{ display: "block", marginBottom: line.trim() ? "2px" : "6px" }}>
        {parts}
      </span>
    );
  });
}

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div style={{
        textAlign: "center",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        color: "var(--text-3)",
        padding: "4px 0",
        letterSpacing: "0.06em",
      }}>
        {msg.text}
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: isUser ? "row-reverse" : "row",
      alignItems: "flex-start",
      gap: "10px",
      marginBottom: "16px",
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: "4px",
          background: "var(--surface-2)", border: "1px solid #58A6FF44",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          fontFamily: "var(--font-mono)", fontSize: "9px", fontWeight: 700,
          color: "var(--blue)", letterSpacing: "0.04em",
        }}>
          A
        </div>
      )}

      <div style={{
        maxWidth: "78%",
        background: isUser ? "var(--surface-2)" : "var(--surface)",
        border: `1px solid ${isUser ? "var(--border-2)" : "#58A6FF22"}`,
        borderRadius: isUser ? "8px 2px 8px 8px" : "2px 8px 8px 8px",
        padding: "10px 14px",
      }}>
        {!isUser && (
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "9px", fontWeight: 700,
            color: "var(--blue)", letterSpacing: "0.08em",
            marginBottom: "6px",
          }}>
            ACE
            {msg.intent && msg.intent !== "out_of_scope" && (
              <span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>
                · {msg.intent.replace(/_/g, " ")}
              </span>
            )}
          </div>
        )}
        <div style={{
          fontFamily: isUser ? "var(--font-ui)" : "var(--font-body)",
          fontSize: "13px", lineHeight: 1.6, color: "var(--text)",
        }}>
          {renderText(msg.text)}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "16px" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "4px",
        background: "var(--surface-2)", border: "1px solid #58A6FF44",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        fontFamily: "var(--font-mono)", fontSize: "9px", fontWeight: 700,
        color: "var(--blue)",
      }}>A</div>
      <div style={{
        background: "var(--surface)", border: "1px solid #58A6FF22",
        borderRadius: "2px 8px 8px 8px", padding: "12px 16px",
        display: "flex", alignItems: "center", gap: "5px",
      }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 5, height: 5, borderRadius: "50%",
            background: "var(--blue)", opacity: 0.6,
            display: "inline-block",
            animation: `acePulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const today = todayET();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "ace",
      text: `ACE online. Analytics & Confidence Engine.\nSlate date: ${today}\n\nAsk me about today's picks, bullpen vulnerability, model reasoning, or your betting record.`,
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: msg, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const res = await api.chat(msg, today);

    setLoading(false);
    if (res) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "ace",
          text: res.answer,
          intent: res.intent,
          sources: res.sources_count,
          ts: Date.now(),
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "ace",
          text: "Couldn't reach the backend. Make sure the API server is running.",
          ts: Date.now(),
        },
      ]);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 100px)", maxWidth: "780px", margin: "0 auto" }}>

      {/* Header */}
      <div style={{
        padding: "16px 0 12px",
        borderBottom: "1px solid var(--border)",
        marginBottom: "4px",
        display: "flex",
        alignItems: "baseline",
        gap: "10px",
      }}>
        <span style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800, fontSize: "18px",
          letterSpacing: "-0.01em", textTransform: "uppercase", color: "var(--text)",
        }}>ACE</span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "10px",
          color: "var(--blue)", letterSpacing: "0.06em",
        }}>Analytics &amp; Confidence Engine</span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: "10px",
          color: "var(--text-3)", marginLeft: "auto", letterSpacing: "0.04em",
        }}>{today}</span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 0",
        display: "flex", flexDirection: "column",
      }}>
        {messages.map((m) => <Bubble key={m.id} msg={m} />)}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions — only on fresh load */}
      {messages.length <= 1 && !loading && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "6px",
          padding: "8px 0", borderTop: "1px solid var(--border)",
        }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              style={{
                background: "var(--surface)", border: "1px solid var(--border-2)",
                borderRadius: "4px", padding: "5px 10px",
                fontFamily: "var(--font-mono)", fontSize: "11px",
                color: "var(--text-2)", cursor: "pointer",
                transition: "border-color 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLButtonElement).style.borderColor = "#58A6FF66";
                (e.target as HTMLButtonElement).style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLButtonElement).style.borderColor = "var(--border-2)";
                (e.target as HTMLButtonElement).style.color = "var(--text-2)";
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{
        borderTop: "1px solid var(--border)", paddingTop: "12px",
        display: "flex", gap: "8px", alignItems: "flex-end",
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask ACE anything about today's slate, picks, or model…"
          rows={2}
          style={{
            flex: 1, background: "var(--surface)",
            border: "1px solid var(--border-2)", borderRadius: "6px",
            padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: "13px",
            color: "var(--text)", resize: "none", outline: "none", lineHeight: 1.5,
            transition: "border-color 0.12s",
          }}
          onFocus={(e) => { e.target.style.borderColor = "#58A6FF66"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-2)"; }}
          disabled={loading}
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            background: loading || !input.trim() ? "var(--surface)" : "var(--blue)",
            border: "1px solid var(--border-2)", borderRadius: "6px",
            padding: "10px 16px", fontFamily: "var(--font-mono)",
            fontSize: "12px", fontWeight: 600,
            color: loading || !input.trim() ? "var(--text-3)" : "#0d1117",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            transition: "background 0.12s, color 0.12s",
            height: "52px",
          }}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
