"use client";

import { useEffect, useRef } from "react";

interface DotGridProps {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  returnSpeed?: number;
}

interface Dot {
  x: number;
  y: number;
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const full = c.length === 3
    ? c.split("").map(x => x + x).join("")
    : c;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export default function DotGrid({
  dotSize = 2,
  gap = 22,
  baseColor = "#2D3748",
  activeColor = "#58A6FF",
  proximity = 120,
  speedTrigger = 0.4,
  shockRadius = 180,
  shockStrength = 10,
  maxSpeed = 8,
  resistance = 0.82,
  returnSpeed = 0.08,
}: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [br, bg, bb] = hexToRgb(baseColor);
    const [ar, ag, ab] = hexToRgb(activeColor);

    let dots: Dot[] = [];
    const mouse = { x: -9999, y: -9999 };
    const lastMouse = { x: -9999, y: -9999 };
    let mouseSpeed = 0;
    let rafId: number;
    let W = 0, H = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
      ctx!.scale(dpr, dpr);
      buildDots();
    }

    function buildDots() {
      dots = [];
      const step = dotSize + gap;
      const cols = Math.ceil(W / step) + 1;
      const rows = Math.ceil(H / step) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({
            x: c * step,
            y: r * step,
            ox: 0, oy: 0,
            vx: 0, vy: 0,
            r: br, g: bg, b: bb,
          });
        }
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H);

      const dx = mouse.x - lastMouse.x;
      const dy = mouse.y - lastMouse.y;
      mouseSpeed = Math.sqrt(dx * dx + dy * dy);
      lastMouse.x = mouse.x;
      lastMouse.y = mouse.y;

      for (const dot of dots) {
        const px = dot.x + dot.ox;
        const py = dot.y + dot.oy;
        const distX = mouse.x - dot.x;
        const distY = mouse.y - dot.y;
        const dist = Math.sqrt(distX * distX + distY * distY);

        // Proximity color blend
        const t = dist < proximity ? Math.max(0, 1 - dist / proximity) : 0;
        dot.r = br + (ar - br) * t;
        dot.g = bg + (ag - bg) * t;
        dot.b = bb + (ab - bb) * t;

        // Push when cursor moves fast and is close
        if (dist < proximity && mouseSpeed > speedTrigger) {
          const force = (1 - dist / proximity) * Math.min(mouseSpeed * 0.4, maxSpeed);
          const angle = Math.atan2(dot.y - mouse.y, dot.x - mouse.x);
          dot.vx += Math.cos(angle) * force;
          dot.vy += Math.sin(angle) * force;
        }

        // Spring return + damping
        dot.vx += -dot.ox * returnSpeed;
        dot.vy += -dot.oy * returnSpeed;
        dot.vx *= resistance;
        dot.vy *= resistance;
        dot.ox += dot.vx;
        dot.oy += dot.vy;

        ctx!.beginPath();
        ctx!.arc(px, py, dotSize / 2, 0, Math.PI * 2);
        ctx!.fillStyle = `rgb(${Math.round(dot.r)},${Math.round(dot.g)},${Math.round(dot.b)})`;
        ctx!.fill();
      }

      if (running) rafId = requestAnimationFrame(draw);
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }

    function onClick(e: MouseEvent) {
      const cx = e.clientX;
      const cy = e.clientY;
      for (const dot of dots) {
        const dx = dot.x - cx;
        const dy = dot.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < shockRadius) {
          const force = (1 - dist / shockRadius) * shockStrength;
          const angle = Math.atan2(dy, dx);
          dot.vx += Math.cos(angle) * force;
          dot.vy += Math.sin(angle) * force;
        }
      }
    }

    // Decorative-motion budget: the per-frame mouse canvas only animates when
    // the user hasn't asked for reduced motion, isn't on a Save-Data / metered
    // connection, and is on a fine pointer (mouse). On phones / reduced-motion /
    // data-saver we paint a single static frame and skip the rAF loop entirely.
    const mm = (q: string) =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(q).matches
        : false;
    const conn = (typeof navigator !== "undefined" &&
      (navigator as Navigator & { connection?: { saveData?: boolean } }).connection) || undefined;
    const saveData = conn?.saveData === true;
    const coarsePointer = mm("(pointer: coarse)");
    const reduceMotion =
      mm("(prefers-reduced-motion: reduce)") || saveData || coarsePointer;

    function drawStatic() {
      ctx!.clearRect(0, 0, W, H);
      for (const dot of dots) {
        ctx!.beginPath();
        ctx!.arc(dot.x, dot.y, dotSize / 2, 0, Math.PI * 2);
        ctx!.fillStyle = `rgb(${br},${bg},${bb})`;
        ctx!.fill();
      }
    }

    resize();

    if (reduceMotion) {
      drawStatic();
      window.addEventListener("resize", () => { resize(); drawStatic(); });
      return () => {
        window.removeEventListener("resize", resize);
      };
    }

    let running = true;
    function startLoop() {
      if (running) return;
      running = true;
      draw();
    }
    function stopLoop() {
      running = false;
      cancelAnimationFrame(rafId);
    }
    function onVisibility() {
      if (document.hidden) stopLoop();
      else startLoop();
    }

    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [dotSize, gap, baseColor, activeColor, proximity, speedTrigger, shockRadius, shockStrength, maxSpeed, resistance, returnSpeed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        display: "block",
      }}
    />
  );
}
