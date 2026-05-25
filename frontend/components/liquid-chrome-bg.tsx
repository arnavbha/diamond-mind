"use client";

/**
 * LiquidChromeBg — OGL-based metallic fluid background.
 * Used behind the tracker summary stat block.
 *
 * Renders to a canvas via the `ogl` library (no Three.js dependency).
 * Wraps children in a relative container so the chrome sits behind them.
 */

import { useRef, useEffect } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";

// ── Shaders ──────────────────────────────────────────────────────────────────

const vert = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const frag = `
precision highp float;
uniform float uTime;
uniform vec3  uResolution;
uniform vec3  uBaseColor;
uniform float uAmplitude;
uniform float uFrequencyX;
uniform float uFrequencyY;
uniform vec2  uMouse;
varying vec2 vUv;

vec4 renderImage(vec2 uvCoord) {
  vec2 fragCoord = uvCoord * uResolution.xy;
  vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);

  for (float i = 1.0; i < 10.0; i++) {
    uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
    uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
  }

  vec2 diff  = uvCoord - uMouse;
  float dist = length(diff);
  float falloff = exp(-dist * 20.0);
  float ripple  = sin(10.0 * dist - uTime * 2.0) * 0.03;
  uv += (diff / (dist + 0.0001)) * ripple * falloff;

  vec3 color = uBaseColor / abs(sin(uTime - uv.y - uv.x));
  return vec4(color, 1.0);
}

void main() {
  vec4 col = vec4(0.0);
  int samples = 0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 offset = vec2(float(i), float(j)) / min(uResolution.x, uResolution.y);
      col += renderImage(vUv + offset);
      samples++;
    }
  }
  gl_FragColor = col / float(samples);
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export interface LiquidChromeBgProps {
  /** Content floated above the chrome */
  children: React.ReactNode;
  /** Base reflective color [r,g,b] 0-1. Default: very dark blue-grey */
  baseColor?: [number, number, number];
  speed?: number;
  amplitude?: number;
  frequencyX?: number;
  frequencyY?: number;
  interactive?: boolean;
  /** Border radius for the container */
  borderRadius?: number | string;
  /** Extra padding around children */
  padding?: number | string;
}

export function LiquidChromeBg({
  children,
  baseColor = [0.04, 0.06, 0.10],
  speed = 0.15,
  amplitude = 0.25,
  frequencyX = 2.5,
  frequencyY = 2.5,
  interactive = true,
  borderRadius = 8,
  padding = "16px",
}: LiquidChromeBgProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({ antialias: true, alpha: true });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: vert,
      fragment: frag,
      uniforms: {
        uTime:       { value: 0 },
        uResolution: { value: new Float32Array([gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height]) },
        uBaseColor:  { value: new Float32Array(baseColor) },
        uAmplitude:  { value: amplitude },
        uFrequencyX: { value: frequencyX },
        uFrequencyY: { value: frequencyY },
        uMouse:      { value: new Float32Array([0.5, 0.5]) },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    // Position canvas behind children
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border-radius:inherit;";
    container.insertBefore(canvas, container.firstChild);

    function resize() {
      renderer.setSize(container!.offsetWidth, container!.offsetHeight);
      const r = program.uniforms.uResolution.value as Float32Array;
      r[0] = gl.canvas.width; r[1] = gl.canvas.height;
      r[2] = gl.canvas.width / gl.canvas.height;
    }
    window.addEventListener("resize", resize);
    resize();

    function onMove(clientX: number, clientY: number) {
      const rect = container!.getBoundingClientRect();
      const m = program.uniforms.uMouse.value as Float32Array;
      m[0] = (clientX - rect.left) / rect.width;
      m[1] = 1 - (clientY - rect.top) / rect.height;
    }

    const handleMouse = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const handleTouch = (e: TouchEvent) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
    };

    if (interactive) {
      container.addEventListener("mousemove", handleMouse);
      container.addEventListener("touchmove", handleTouch);
    }

    let raf: number;
    function tick(t: number) {
      raf = requestAnimationFrame(tick);
      (program.uniforms.uTime as { value: number }).value = t * 0.001 * speed;
      renderer.render({ scene: mesh });
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      if (interactive) {
        container?.removeEventListener("mousemove", handleMouse);
        container?.removeEventListener("touchmove", handleTouch);
      }
      canvas.parentElement?.removeChild(canvas);
      (gl.getExtension("WEBGL_lose_context") as { loseContext: () => void } | null)?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        borderRadius,
        overflow: "hidden",
        padding,
        // Thin chrome border that catches the light
        border: "1px solid rgba(120,140,180,0.18)",
      }}
    >
      {/* Canvas injected as first child by useEffect */}
      {/* Children sit above canvas via z-index */}
      <div style={{ position: "relative", zIndex: 1 }}>
        {children}
      </div>
    </div>
  );
}
