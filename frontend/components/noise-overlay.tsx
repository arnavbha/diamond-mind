"use client";

// Adapted from reactbits.dev/animations/noise
// Full-page canvas grain — renders once, refreshes every N frames

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

    let frame = 0;
    let raf = 0;

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

    function loop() {
      if (frame % patternRefreshInterval === 0) drawGrain();
      frame++;
      raf = requestAnimationFrame(loop);
    }

    drawGrain();
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [patternAlpha, patternRefreshInterval]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9999,
        opacity: 1,
        imageRendering: "pixelated",
        mixBlendMode: "overlay",
      }}
    />
  );
}
