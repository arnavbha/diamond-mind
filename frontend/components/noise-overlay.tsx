"use client";

// Adapted from reactbits.dev/animations/noise
// Full-page canvas grain — renders once, refreshes on a throttled interval.

import { useRef, useEffect } from "react";

interface NoiseOverlayProps {
  /** 0-255 alpha of each grain pixel. 12 = barely visible, very premium */
  patternAlpha?: number;
  /** Refresh every N animation frames (higher = cheaper, less "alive") */
  patternRefreshInterval?: number;
}

export default function NoiseOverlay({
  patternAlpha = 12,
  patternRefreshInterval = 3,
}: NoiseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const SIZE = 512; // smaller = cheaper, still looks fine at 2x
    canvas.width = SIZE;
    canvas.height = SIZE;

    function drawGrain() {
      const imageData = ctx!.createImageData(SIZE, SIZE);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.random() * 255;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = patternAlpha;
      }
      ctx!.putImageData(imageData, 0, 0);
    }

    // Respect reduced-motion: render a single static grain frame, no rAF loop.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    drawGrain();
    if (reduceMotion) return;

    // Animated path. Regenerate grain on a throttled wall-clock interval rather
    // than allocating a 512x512 ImageData every 3rd frame — far less CPU/GC.
    // ~16.67ms per frame * patternRefreshInterval ≈ minimum ms between redraws.
    const minIntervalMs = Math.max(1, patternRefreshInterval) * 16.67;
    let lastDraw = 0;
    let raf = 0;
    let running = true;

    function loop(ts: number) {
      if (!running) return;
      if (ts - lastDraw >= minIntervalMs) {
        drawGrain();
        lastDraw = ts;
      }
      raf = requestAnimationFrame(loop);
    }

    function start() {
      if (running) return;
      running = true;
      lastDraw = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    }

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [patternAlpha, patternRefreshInterval]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        // inset:0 + dynamic viewport units: avoids the 100vw scrollbar overflow
        // and the mobile Safari/Chrome dynamic-chrome gap that 100vh/100vw cause.
        inset: 0,
        width: "100dvw",
        height: "100dvh",
        pointerEvents: "none",
        // Below modals/sidebars/nav (nav is z-index:100); the grain is decoration.
        zIndex: 50,
        opacity: 1,
        imageRendering: "pixelated",
        mixBlendMode: "overlay",
      }}
    />
  );
}
