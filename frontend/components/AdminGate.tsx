"use client";

/**
 * AdminGate — a small lock/unlock widget.
 *
 * Usage:
 *   <AdminGate onUnlocked={() => setUnlocked(true)} />
 *
 * Shows a lock button. Clicking it opens a password prompt; on success it
 * stores the token in localStorage via api.setAdminToken() and calls
 * onUnlocked(). While locked, mutating UI should be hidden or disabled.
 */

import { useState, useId } from "react";
import { getAdminToken, setAdminToken } from "@/lib/api";
import { Button, Dialog } from "@/components/ui";

interface Props {
  onUnlocked?: () => void;
}

export default function AdminGate({ onUnlocked }: Props) {
  const [unlocked, setUnlocked] = useState(() => Boolean(getAdminToken()));
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const inputId = useId();

  function handleUnlock() {
    if (!input.trim()) {
      setError("Enter the admin token.");
      return;
    }
    setAdminToken(input.trim());
    setUnlocked(true);
    setOpen(false);
    setInput("");
    setError("");
    onUnlocked?.();
  }

  function handleLock() {
    setAdminToken("");
    setUnlocked(false);
  }

  function closeDialog() {
    setOpen(false);
    setInput("");
    setError("");
  }

  return (
    <>
      <Button
        variant={unlocked ? "track" : "ghost"}
        active={unlocked}
        size="sm"
        onClick={unlocked ? handleLock : () => setOpen(true)}
        title={unlocked ? "Lock admin actions" : "Unlock admin actions"}
      >
        {unlocked ? "🔓 admin" : "🔒 locked"}
      </Button>

      <Dialog
        open={open}
        onClose={closeDialog}
        title="Admin unlock"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={closeDialog}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleUnlock}>
              Unlock
            </Button>
          </>
        }
      >
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "var(--fs-body)",
            color: "var(--text-2)",
            lineHeight: "var(--lh-prose)",
            margin: "0 0 var(--sp-3)",
          }}
        >
          Enter the admin token to enable settle / delete actions.
        </p>
        <label
          htmlFor={inputId}
          style={{
            display: "block",
            fontSize: "var(--fs-caption)",
            letterSpacing: "var(--tracking-label)",
            textTransform: "uppercase",
            color: "var(--text-2)",
            marginBottom: "var(--sp-1)",
          }}
        >
          Token
        </label>
        <input
          id={inputId}
          type="password"
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
          placeholder="Token"
          style={{
            width: "100%",
            minHeight: "44px",
            background: "var(--surface-inset)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)",
            padding: "0 var(--sp-3)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-body)",
            color: "var(--text)",
          }}
        />
        {error && (
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-meta)",
              color: "var(--neg)",
              margin: "var(--sp-2) 0 0",
            }}
          >
            {error}
          </p>
        )}
      </Dialog>
    </>
  );
}
