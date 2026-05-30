"use client";

/**
 * DecryptedText — scrambled chars → real text reveal animation.
 * Ported from ReactBits (DavidHDev/react-bits) to TypeScript.
 * Uses motion/react for the wrapper span.
 */

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { motion } from "motion/react";

// Per-session guard so a given text only runs its reveal once per browser
// session (keyed by the text content). The nav wordmark used to re-scramble on
// every remount — page navigations in the App Router that remount the layout
// subtree, IntersectionObserver re-fires, etc. Once revealed, stay revealed.
const animatedThisSession =
  typeof window !== "undefined"
    ? ((window as Window & { __dmDecrypted?: Set<string> }).__dmDecrypted ??= new Set<string>())
    : new Set<string>();

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1, height: 1,
  padding: 0, margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  border: 0,
};

export interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: "start" | "end" | "center";
  useOriginalCharsOnly?: boolean;
  characters?: string;
  /** Class applied to each revealed character */
  className?: string;
  /** Class applied to each still-encrypted character */
  encryptedClassName?: string;
  /** Class on the outer wrapper span */
  parentClassName?: string;
  animateOn?: "hover" | "view" | "click" | "auto";
  clickMode?: "once" | "toggle";
}

export default function DecryptedText({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = "start",
  useOriginalCharsOnly = false,
  characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()",
  className = "",
  parentClassName = "",
  encryptedClassName = "",
  animateOn = "hover",
  clickMode = "once",
}: DecryptedTextProps) {
  // If this text already revealed earlier in the session, treat it as done so a
  // remount (e.g. layout subtree re-rendering on navigation) doesn't re-scramble.
  const alreadyRevealed =
    (animateOn === "view" || animateOn === "auto") && animatedThisSession.has(text);

  const [displayText, setDisplayText]     = useState(text);
  const [isAnimating, setIsAnimating]     = useState(false);
  const [revealedIndices, setRevealedIndices] = useState(new Set<number>());
  const [hasAnimated, setHasAnimated]     = useState(alreadyRevealed);
  const [isDecrypted, setIsDecrypted]     = useState(animateOn !== "click");
  const [direction, setDirection]         = useState<"forward" | "reverse">("forward");

  const containerRef = useRef<HTMLSpanElement>(null);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const availableChars = useMemo(() =>
    useOriginalCharsOnly
      ? Array.from(new Set(text.split(""))).filter(c => c !== " ")
      : characters.split(""),
    [useOriginalCharsOnly, text, characters],
  );

  const shuffleText = useCallback((orig: string, revealed: Set<number>) =>
    orig.split("").map((char, i) => {
      if (char === " ") return " ";
      if (revealed.has(i)) return orig[i];
      return availableChars[Math.floor(Math.random() * availableChars.length)];
    }).join(""),
    [availableChars],
  );

  const fillAll = useCallback(() => {
    const s = new Set<number>();
    for (let i = 0; i < text.length; i++) s.add(i);
    return s;
  }, [text]);

  const getNextIndex = useCallback((revealed: Set<number>) => {
    const len = text.length;
    if (revealDirection === "start") return revealed.size;
    if (revealDirection === "end")   return len - 1 - revealed.size;
    const mid = Math.floor(len / 2);
    const offset = Math.floor(revealed.size / 2);
    const idx = revealed.size % 2 === 0 ? mid + offset : mid - offset - 1;
    if (idx >= 0 && idx < len && !revealed.has(idx)) return idx;
    for (let i = 0; i < len; i++) if (!revealed.has(i)) return i;
    return 0;
  }, [text, revealDirection]);

  const triggerDecrypt = useCallback(() => {
    setRevealedIndices(new Set());
    setDirection("forward");
    setIsAnimating(true);
  }, []);

  const encryptInstantly = useCallback(() => {
    const empty = new Set<number>();
    setRevealedIndices(empty);
    setDisplayText(shuffleText(text, empty));
    setIsDecrypted(false);
  }, [text, shuffleText]);

  // Main animation loop
  useEffect(() => {
    if (!isAnimating) return;
    let iter = 0;

    intervalRef.current = setInterval(() => {
      setRevealedIndices(prev => {
        if (direction === "forward") {
          if (sequential) {
            if (prev.size < text.length) {
              const next = new Set(prev);
              next.add(getNextIndex(prev));
              setDisplayText(shuffleText(text, next));
              return next;
            } else {
              clearInterval(intervalRef.current!);
              setIsAnimating(false);
              setIsDecrypted(true);
              return prev;
            }
          } else {
            setDisplayText(shuffleText(text, prev));
            iter++;
            if (iter >= maxIterations) {
              clearInterval(intervalRef.current!);
              setIsAnimating(false);
              setDisplayText(text);
              setIsDecrypted(true);
            }
            return prev;
          }
        }
        return prev;
      });
    }, speed);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isAnimating, text, speed, maxIterations, sequential, direction, shuffleText, getNextIndex]);

  // View observer. Skips entirely once the text has revealed this session.
  useEffect(() => {
    if (animateOn !== "view") return;
    if (hasAnimated) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !hasAnimated) {
          triggerDecrypt();
          setHasAnimated(true);
          animatedThisSession.add(text);
        }
      });
    }, { threshold: 0.1 });
    const el = containerRef.current;
    if (el) obs.observe(el);
    return () => { if (el) obs.unobserve(el); };
  }, [animateOn, hasAnimated, triggerDecrypt, text]);

  // Auto mode
  useEffect(() => {
    if (animateOn === "auto" && !alreadyRevealed) {
      triggerDecrypt();
      animatedThisSession.add(text);
    } else if (animateOn === "click") {
      encryptInstantly();
    } else {
      setDisplayText(text);
      setIsDecrypted(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoverProps = animateOn === "hover" ? {
    onMouseEnter: () => {
      if (isAnimating) return;
      setRevealedIndices(new Set());
      setIsDecrypted(false);
      setDirection("forward");
      setIsAnimating(true);
    },
    onMouseLeave: () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsAnimating(false);
      setRevealedIndices(new Set());
      setDisplayText(text);
      setIsDecrypted(true);
    },
  } : {};

  const clickProps = animateOn === "click" ? {
    onClick: () => {
      if (isDecrypted) return;
      triggerDecrypt();
    },
  } : {};

  return (
    <motion.span
      ref={containerRef}
      className={parentClassName}
      style={{ display: "inline-block", whiteSpace: "pre-wrap" }}
      {...hoverProps}
      {...clickProps}
    >
      <span style={srOnly}>{text}</span>
      <span aria-hidden="true">
        {displayText.split("").map((char, i) => {
          const revealed = revealedIndices.has(i) || (!isAnimating && isDecrypted);
          return (
            <span key={i} className={revealed ? className : encryptedClassName}>
              {char}
            </span>
          );
        })}
      </span>
    </motion.span>
  );
}
