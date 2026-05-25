"use client";

/**
 * DitherHeader — animated dithered wave canvas.
 *
 * Single-pass shader: Perlin noise FBM waves + Bayer 8×8 dither baked
 * into one fragment shader. No postprocessing pipeline — more reliable
 * inside positioned containers.
 *
 * Always animating (frameloop="always"), mouse-interactive.
 */

import { useRef, useEffect } from "react";

// ── Single-pass shader (waves + dither combined) ─────────────────────────────

const VERT = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2  uResolution;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uFrequency;
uniform float uAmplitude;
uniform float uColorNum;
uniform float uPixelSize;
uniform vec2  uMouse;
uniform int   uMouse_active;
in vec2 vUv;
out vec4 fragColor;

// ── Perlin noise helpers ──────────────────────────────────────────────────────
vec4 mod289v(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289v(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
vec2 fade(vec2 t){return t*t*t*(t*(t*6.-15.)+10.);}

float cnoise(vec2 P){
  vec4 Pi=floor(P.xyxy)+vec4(0,0,1,1);
  vec4 Pf=fract(P.xyxy)-vec4(0,0,1,1);
  Pi=mod289v(Pi);
  vec4 ix=Pi.xzxz,iy=Pi.yyww,fx=Pf.xzxz,fy=Pf.yyww;
  vec4 i=permute(permute(ix)+iy);
  vec4 gx=fract(i*(1./41.))*2.-1.,gy=abs(gx)-.5,tx=floor(gx+.5);
  gx-=tx;
  vec2 g00=vec2(gx.x,gy.x),g10=vec2(gx.y,gy.y),g01=vec2(gx.z,gy.z),g11=vec2(gx.w,gy.w);
  vec4 norm=taylorInvSqrt(vec4(dot(g00,g00),dot(g01,g01),dot(g10,g10),dot(g11,g11)));
  g00*=norm.x;g01*=norm.y;g10*=norm.z;g11*=norm.w;
  float n00=dot(g00,vec2(fx.x,fy.x)),n10=dot(g10,vec2(fx.y,fy.y)),
        n01=dot(g01,vec2(fx.z,fy.z)),n11=dot(g11,vec2(fx.w,fy.w));
  vec2 f=fade(Pf.xy);
  vec2 nx=mix(vec2(n00,n01),vec2(n10,n11),f.x);
  return 2.3*mix(nx.x,nx.y,f.y);
}

float fbm(vec2 p){
  float v=0.,a=1.,freq=uFrequency;
  for(int i=0;i<4;i++){v+=a*abs(cnoise(p));p*=freq;a*=uAmplitude;}
  return v;
}

float pattern(vec2 p){
  vec2 q=p-uTime*uSpeed;
  return fbm(p+fbm(q));
}

// ── Bayer 8×8 dither ─────────────────────────────────────────────────────────
const float bayer[64] = float[64](
  0./64.,48./64.,12./64.,60./64., 3./64.,51./64.,15./64.,63./64.,
 32./64.,16./64.,44./64.,28./64.,35./64.,19./64.,47./64.,31./64.,
  8./64.,56./64., 4./64.,52./64.,11./64.,59./64., 7./64.,55./64.,
 40./64.,24./64.,36./64.,20./64.,43./64.,27./64.,39./64.,23./64.,
  2./64.,50./64.,14./64.,62./64., 1./64.,49./64.,13./64.,61./64.,
 34./64.,18./64.,46./64.,30./64.,33./64.,17./64.,45./64.,29./64.,
 10./64.,58./64., 6./64.,54./64., 9./64.,57./64., 5./64.,53./64.,
 42./64.,26./64.,38./64.,22./64.,41./64.,25./64.,37./64.,21./64.
);

vec3 dither(vec2 fragCoord, vec3 color){
  vec2 sc=floor(fragCoord/uPixelSize);
  int x=int(mod(sc.x,8.)),y=int(mod(sc.y,8.));
  float thr=bayer[y*8+x]-0.25;
  float step=1./(uColorNum-1.);
  color=clamp(color+thr*step-0.1,0.,1.);
  return floor(color*(uColorNum-1.)+0.5)/(uColorNum-1.);
}

void main(){
  // Snap to pixel grid for the dither
  vec2 fragCoord=vUv*uResolution;
  vec2 snapped=floor(fragCoord/uPixelSize)*uPixelSize;
  vec2 uv=snapped/uResolution;

  uv-=0.5;
  uv.x*=uResolution.x/uResolution.y;

  float f=pattern(uv);

  // Optional mouse distortion
  if(uMouse_active==1){
    vec2 mouse=uMouse/uResolution-0.5;
    mouse.x*=uResolution.x/uResolution.y;
    float d=length(uv-mouse);
    f-=0.6*smoothstep(0.4,0.,d);
  }

  vec3 col=mix(vec3(0.),uColor,f);
  col=dither(fragCoord,col);
  fragColor=vec4(col,1.0);
}
`;

// ── Tiny OGL-less WebGL wrapper ───────────────────────────────────────────────

function createShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function createProgram(gl: WebGL2RenderingContext) {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, createShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, createShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  return prog;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface DitherHeaderProps {
  height?: number;
  color?: [number, number, number];
  speed?: number;
  frequency?: number;
  amplitude?: number;
  colorNum?: number;
  pixelSize?: number;
  mouseInteraction?: boolean;
}

export function DitherHeader({
  height = 180,
  color = [0.5, 0.9, 0.4],
  speed = 0.05,
  frequency = 3.0,
  amplitude = 0.3,
  colorNum = 4,
  pixelSize = 2,
  mouseInteraction = true,
}: DitherHeaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { antialias: false })!;
    if (!gl) return;

    const prog = createProgram(gl);
    gl.useProgram(prog);

    // Full-screen triangle (2 triangles via indices)
    const verts = new Float32Array([-1,-1, 1,-1, 1,1, -1,1]);
    const uvs   = new Float32Array([0,0, 1,0, 1,1, 0,1]);
    const idx   = new Uint16Array([0,1,2, 0,2,3]);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uvbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvbo);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    const uvLoc = gl.getAttribLocation(prog, "uv");
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    // Uniform locations
    const uTime       = gl.getUniformLocation(prog, "uTime");
    const uRes        = gl.getUniformLocation(prog, "uResolution");
    const uColor      = gl.getUniformLocation(prog, "uColor");
    const uSpeed      = gl.getUniformLocation(prog, "uSpeed");
    const uFreq       = gl.getUniformLocation(prog, "uFrequency");
    const uAmp        = gl.getUniformLocation(prog, "uAmplitude");
    const uColorNum   = gl.getUniformLocation(prog, "uColorNum");
    const uPixelSize  = gl.getUniformLocation(prog, "uPixelSize");
    const uMouse      = gl.getUniformLocation(prog, "uMouse");
    const uMouseActive = gl.getUniformLocation(prog, "uMouse_active");

    // Set static uniforms
    gl.uniform3f(uColor, ...color);
    gl.uniform1f(uSpeed, speed);
    gl.uniform1f(uFreq, frequency);
    gl.uniform1f(uAmp, amplitude);
    gl.uniform1f(uColorNum, colorNum);
    gl.uniform1f(uPixelSize, pixelSize);
    gl.uniform2f(uMouse, 0, 0);
    gl.uniform1i(uMouseActive, 0);

    // Mouse tracking
    const mouse = { x: 0, y: 0, active: false };
    function onMove(e: MouseEvent) {
      if (!mouseInteraction) return;
      const r = canvas!.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) * devicePixelRatio;
      mouse.y = canvas!.height - (e.clientY - r.top) * devicePixelRatio;
      mouse.active = true;
    }
    function onLeave() { mouse.active = false; }

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    // Resize
    function resize() {
      const w = canvas!.offsetWidth;
      const h = canvas!.offsetHeight;
      const dpr = Math.min(devicePixelRatio, 2);
      canvas!.width  = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas!.width, canvas!.height);
      gl.uniform2f(uRes, canvas!.width, canvas!.height);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    // Render loop
    let raf: number;
    let start: number | null = null;

    function tick(ts: number) {
      raf = requestAnimationFrame(tick);
      if (start === null) start = ts;
      const t = (ts - start) * 0.001;

      gl.uniform1f(uTime, t);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1i(uMouseActive, mouse.active ? 1 : 0);

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height }}
    />
  );
}
