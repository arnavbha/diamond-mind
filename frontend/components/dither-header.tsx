"use client";

/**
 * DitherHeader — dithered wave canvas fading into the page bg.
 * Used as the picks page header accent.
 *
 * Renders via @react-three/fiber (WebGL). Dynamically imported at
 * call site to skip SSR. Canvas is position:absolute behind content,
 * mask fades bottom edge to transparent so data sits cleanly below.
 */

import { useRef, useEffect, forwardRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, wrapEffect } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import * as THREE from "three";

// ── Shaders ──────────────────────────────────────────────────────────────────

const waveVert = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const waveFrag = `
precision highp float;
uniform vec2  resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3  waveColor;

vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
vec2 fade(vec2 t){return t*t*t*(t*(t*6.-15.)+10.);}

float cnoise(vec2 P){
  vec4 Pi=floor(P.xyxy)+vec4(0,0,1,1);
  vec4 Pf=fract(P.xyxy)-vec4(0,0,1,1);
  Pi=mod289(Pi);
  vec4 ix=Pi.xzxz,iy=Pi.yyww,fx=Pf.xzxz,fy=Pf.yyww;
  vec4 i=permute(permute(ix)+iy);
  vec4 gx=fract(i*(1./41.))*2.-1.,gy=abs(gx)-.5,tx=floor(gx+.5);
  gx-=tx;
  vec2 g00=vec2(gx.x,gy.x),g10=vec2(gx.y,gy.y),g01=vec2(gx.z,gy.z),g11=vec2(gx.w,gy.w);
  vec4 norm=taylorInvSqrt(vec4(dot(g00,g00),dot(g01,g01),dot(g10,g10),dot(g11,g11)));
  g00*=norm.x;g01*=norm.y;g10*=norm.z;g11*=norm.w;
  float n00=dot(g00,vec2(fx.x,fy.x)),n10=dot(g10,vec2(fx.y,fy.y)),
        n01=dot(g01,vec2(fx.z,fy.z)),n11=dot(g11,vec2(fx.w,fy.w));
  vec2 fade_xy=fade(Pf.xy);
  vec2 n_x=mix(vec2(n00,n01),vec2(n10,n11),fade_xy.x);
  return 2.3*mix(n_x.x,n_x.y,fade_xy.y);
}

float fbm(vec2 p){
  float v=0.,a=1.;float freq=waveFrequency;
  for(int i=0;i<4;i++){v+=a*abs(cnoise(p));p*=freq;a*=waveAmplitude;}
  return v;
}

float pattern(vec2 p){
  vec2 p2=p-time*waveSpeed;
  return fbm(p+fbm(p2));
}

void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  uv-=.5;uv.x*=resolution.x/resolution.y;
  float f=pattern(uv);
  vec3 col=mix(vec3(0.),waveColor,f);
  gl_FragColor=vec4(col,1.);
}
`;

const ditherFrag = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayer[64]=float[64](
  0./64.,48./64.,12./64.,60./64., 3./64.,51./64.,15./64.,63./64.,
 32./64.,16./64.,44./64.,28./64.,35./64.,19./64.,47./64.,31./64.,
  8./64.,56./64., 4./64.,52./64.,11./64.,59./64., 7./64.,55./64.,
 40./64.,24./64.,36./64.,20./64.,43./64.,27./64.,39./64.,23./64.,
  2./64.,50./64.,14./64.,62./64., 1./64.,49./64.,13./64.,61./64.,
 34./64.,18./64.,46./64.,30./64.,33./64.,17./64.,45./64.,29./64.,
 10./64.,58./64., 6./64.,54./64., 9./64.,57./64., 5./64.,53./64.,
 42./64.,26./64.,38./64.,22./64.,41./64.,25./64.,37./64.,21./64.
);
vec3 dither(vec2 uv,vec3 color){
  vec2 sc=floor(uv*resolution/pixelSize);
  int x=int(mod(sc.x,8.)),y=int(mod(sc.y,8.));
  float thr=bayer[y*8+x]-.25;
  float step=1./(colorNum-1.);
  color+=thr*step;
  color=clamp(color-.2,0.,1.);
  return floor(color*(colorNum-1.)+.5)/(colorNum-1.);
}
void mainImage(in vec4 inputColor,in vec2 uv,out vec4 outputColor){
  vec2 np=pixelSize/resolution;
  vec2 uvP=np*floor(uv/np);
  vec4 color=texture2D(inputBuffer,uvP);
  color.rgb=dither(uv,color.rgb);
  outputColor=color;
}
`;

// ── Retro dither post-effect ──────────────────────────────────────────────────

class RetroEffectImpl extends Effect {
  declare uniforms: Map<string, THREE.Uniform<number>>;
  constructor() {
    const uniforms = new Map<string, THREE.Uniform<number>>([
      ["colorNum", new THREE.Uniform(4.0)],
      ["pixelSize", new THREE.Uniform(3.0)],
    ]);
    super("RetroEffect", ditherFrag, { uniforms });
    this.uniforms = uniforms;
  }
  set colorNum(v: number) { this.uniforms.get("colorNum")!.value = v; }
  get colorNum() { return this.uniforms.get("colorNum")!.value; }
  set pixelSize(v: number) { this.uniforms.get("pixelSize")!.value = v; }
  get pixelSize() { return this.uniforms.get("pixelSize")!.value; }
}

const WrappedRetro = wrapEffect(RetroEffectImpl);

const RetroEffect = forwardRef<
  RetroEffectImpl,
  { colorNum?: number; pixelSize?: number }
>(({ colorNum = 4, pixelSize = 3 }, ref) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const W = WrappedRetro as any;
  return <W ref={ref} colorNum={colorNum} pixelSize={pixelSize} />;
});
RetroEffect.displayName = "RetroEffect";

// ── Scene ─────────────────────────────────────────────────────────────────────

function DitherScene({
  color,
  speed,
  colorNum,
  pixelSize,
}: {
  color: [number, number, number];
  speed: number;
  colorNum: number;
  pixelSize: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport, size, gl } = useThree();

  const uniforms = useRef({
    time:          new THREE.Uniform(0),
    resolution:    new THREE.Uniform(new THREE.Vector2(0, 0)),
    waveSpeed:     new THREE.Uniform(speed),
    waveFrequency: new THREE.Uniform(3.0),
    waveAmplitude: new THREE.Uniform(0.3),
    waveColor:     new THREE.Uniform(new THREE.Color(...color)),
  });

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    uniforms.current.resolution.value.set(
      Math.floor(size.width * dpr),
      Math.floor(size.height * dpr),
    );
  }, [size, gl]);

  useFrame(({ clock }) => {
    uniforms.current.time.value = clock.getElapsedTime();
  });

  return (
    <>
      <mesh ref={meshRef} scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={waveVert}
          fragmentShader={waveFrag}
          uniforms={uniforms.current}
        />
      </mesh>
      <EffectComposer>
        <RetroEffect colorNum={colorNum} pixelSize={pixelSize} />
      </EffectComposer>
    </>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

export interface DitherHeaderProps {
  /** Height of the header zone in px (default 220) */
  height?: number;
  /** Wave color as [r,g,b] 0-1 (default dark green) */
  color?: [number, number, number];
  speed?: number;
  colorNum?: number;
  pixelSize?: number;
}

export function DitherHeader({
  height = 220,
  color = [0.05, 0.35, 0.15],
  speed = 0.05,
  colorNum = 5,
  pixelSize = 3,
}: DitherHeaderProps) {
  return (
    <div style={{
      position: "relative",
      width: "100%",
      height,
      overflow: "hidden",
    }}>
      <Canvas
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        camera={{ position: [0, 0, 6] }}
        dpr={1}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <DitherScene
          color={color}
          speed={speed}
          colorNum={colorNum}
          pixelSize={pixelSize}
        />
      </Canvas>
    </div>
  );
}
