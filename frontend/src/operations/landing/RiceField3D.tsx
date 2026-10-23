import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MathUtils,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import { heroInput } from "./heroInput";

/*
 * A transplanted rice paddy at dusk: rice hills in rows, water between them, mud dikes between paddies.
 * Every blade bends in the vertex shader (wind + a pointer gust), so the CPU only updates a few uniforms.
 * A scan band sweeps from the horizon to the camera; diseased patches light up as it passes, and the
 * DOM brackets above them are positioned from the same patch coordinates.
 */

const FIELD_W = 26;
const FIELD_D = 30;
const FIELD_Z0 = 4; // nearest edge
const CELL_X = 8.5; // paddy size between dikes
const CELL_Z = 9;
const DIKE = 0.42;
const SCAN_FROM = -FIELD_D + FIELD_Z0;
const SCAN_TO = FIELD_Z0 + 2;
const SCAN_PERIOD = 7;
const SCAN_SWEEP = 5;

export const PATCHES = [
  { x: -4.2, z: -3.2, r: 1.15, kind: 1, label: "BLB candidate" },
  { x: 4.6, z: -7.8, r: 1.25, kind: 2, label: "Brown Spot candidate" },
  { x: -0.6, z: -14.5, r: 1.5, kind: 1, label: "BLB candidate" },
] as const;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bladeGeometry() {
  // A tapered blade: 4 segments, normalised height 1, base width 1 (scaled per instance).
  const segs = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const h = i / segs;
    const w = 0.5 * (1 - Math.pow(h, 1.6));
    pos.push(-w, h, 0, w, h, 0);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function useFieldGeometry(density: number) {
  return useMemo(() => {
    const rand = mulberry32(20261022);
    const base = bladeGeometry();
    const offsets: number[] = [];
    const params: number[] = []; // height, width, yaw, lean
    const extra: number[] = []; // disease, phase, patchKind
    const spacing = 0.44 / Math.sqrt(density);
    for (let z = SCAN_FROM; z < FIELD_Z0; z += spacing) {
      for (let x = -FIELD_W / 2; x < FIELD_W / 2; x += spacing) {
        const cx = (((x + CELL_X / 2) % CELL_X) + CELL_X) % CELL_X;
        const cz = ((z % CELL_Z) + CELL_Z) % CELL_Z;
        if (cx < DIKE || cz < DIKE) continue; // dikes stay bare
        const hx = x + (rand() - 0.5) * 0.06;
        const hz = z + (rand() - 0.5) * 0.06;
        let disease = 0;
        let kind = 0;
        for (const p of PATCHES) {
          const d = Math.hypot(hx - p.x, hz - p.z);
          if (d < p.r && rand() < 0.85 * (1 - d / p.r) + 0.25) { disease = 1 - (d / p.r) * 0.5; kind = p.kind; }
        }
        const blades = 4 + Math.floor(rand() * 3);
        const hue = (rand() - 0.5) * 0.5;
        for (let b = 0; b < blades; b++) {
          offsets.push(hx + (rand() - 0.5) * 0.08, 0, hz + (rand() - 0.5) * 0.08);
          params.push(0.62 + rand() * 0.38, 0.05 + rand() * 0.025, rand() * Math.PI * 2, (rand() - 0.5) * 0.9);
          extra.push(disease * (0.6 + rand() * 0.4), rand() * Math.PI * 2, kind + hue * 0.2);
        }
      }
    }
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("aOffset", new InstancedBufferAttribute(new Float32Array(offsets), 3));
    geo.setAttribute("aParams", new InstancedBufferAttribute(new Float32Array(params), 4));
    geo.setAttribute("aExtra", new InstancedBufferAttribute(new Float32Array(extra), 3));
    geo.instanceCount = offsets.length / 3;
    return geo;
  }, [density]);
}

const SHARED_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uGrow;
  uniform float uScan;
  uniform vec3 uFog;
  uniform vec3 uPointer;
  uniform float uGust;
  float scanBand(float z) { return smoothstep(1.4, 0.0, abs(z - uScan)); }
  float scanned(float z) { return step(z, uScan + 0.0) * step(${SCAN_FROM.toFixed(1)}, uScan); }
`;

function bladeMaterial() {
  return new ShaderMaterial({
    side: DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uGrow: { value: 0 },
      uScan: { value: SCAN_FROM - 4 },
      uFog: { value: new Color("#cdb47c") },
      uPointer: { value: new Vector3(0, 0, -100) },
      uGust: { value: 0 },
    },
    vertexShader: /* glsl */ `
      ${SHARED_GLSL}
      attribute vec3 aOffset;
      attribute vec4 aParams;
      attribute vec3 aExtra;
      varying float vH;
      varying float vDisease;
      varying float vKind;
      varying float vScan;
      varying float vDepth;
      varying float vSeen;
      void main() {
        float h = position.y;
        // Grow in from the camera towards the horizon.
        float grow = smoothstep(0.0, 1.0, uGrow * 1.6 - (${FIELD_Z0.toFixed(1)} - aOffset.z) / ${FIELD_D.toFixed(1)} * 0.6);
        float height = aParams.x * (0.55 + 0.45 * grow) * grow;
        vec3 p = vec3(position.x * aParams.y, h * height, 0.0);
        float c = cos(aParams.z), s = sin(aParams.z);
        p = vec3(p.x * c, p.y, p.x * s);
        // Wind: a slow travelling wave plus flutter; bend grows with height squared.
        float wave = sin(uTime * 1.1 + aOffset.x * 0.35 + aOffset.z * 0.22) * 0.5 + sin(uTime * 2.3 + aOffset.z * 0.9 + aExtra.y) * 0.18;
        vec2 bend = vec2(0.28 + wave * 0.32 + aParams.w * 0.25, 0.12 + aParams.w * 0.3) * h * h * height;
        // Pointer gust pushes blades away from the cursor's spot on the field.
        vec2 away = aOffset.xz - uPointer.xz;
        float near = smoothstep(2.6, 0.0, length(away)) * uGust;
        bend += normalize(away + 1e-4) * near * 0.9 * h * h * height;
        p.xz += bend;
        p.y -= length(bend) * 0.35 * h;
        vec4 world = vec4(p + aOffset, 1.0);
        vec4 mv = viewMatrix * world;
        gl_Position = projectionMatrix * mv;
        vH = h;
        vDisease = aExtra.x;
        vKind = aExtra.z;
        vScan = scanBand(aOffset.z);
        vSeen = scanned(aOffset.z);
        vDepth = -mv.z;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHARED_GLSL}
      varying float vH;
      varying float vDisease;
      varying float vKind;
      varying float vScan;
      varying float vDepth;
      varying float vSeen;
      void main() {
        vec3 base = mix(vec3(0.07, 0.2, 0.11), vec3(0.42, 0.66, 0.26), smoothstep(0.0, 1.0, vH));
        vec3 tip = vec3(0.72, 0.84, 0.42);
        base = mix(base, tip, smoothstep(0.75, 1.0, vH) * 0.45);
        // Disease: BLB yellows from the tip down; Brown Spot browns the whole blade.
        vec3 blb = mix(base, vec3(0.86, 0.78, 0.42), smoothstep(0.35, 0.95, vH));
        vec3 brown = mix(base, vec3(0.55, 0.36, 0.16), 0.75);
        float hue = fract(vKind + 0.5) - 0.5;
        base *= 1.0 + hue * 0.5;
        vec3 sick = floor(vKind + 0.5) > 1.5 ? brown : blb;
        vec3 col = mix(base, sick, vDisease);
        // Scan band: lime wash, stronger on diseased blades; diseased blades keep a glow once scanned.
        vec3 lime = vec3(0.66, 0.83, 0.36);
        col += lime * vScan * (0.35 + vDisease * 0.9);
        vec3 alert = floor(vKind + 0.5) > 1.5 ? vec3(0.94, 0.72, 0.35) : lime;
        col += alert * vDisease * vSeen * 0.35 * (0.6 + 0.4 * sin(uTime * 4.0));
        // Distance haze toward the dusk horizon.
        col = mix(col, uFog, smoothstep(8.0, 33.0, vDepth));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function groundMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGrow: { value: 0 },
      uScan: { value: SCAN_FROM - 4 },
      uFog: { value: new Color("#cdb47c") },
      uPointer: { value: new Vector3(0, 0, -100) },
      uGust: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHARED_GLSL}
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        float cx = mod(vWorld.x + ${(CELL_X / 2).toFixed(2)}, ${CELL_X.toFixed(1)});
        float cz = mod(vWorld.z, ${CELL_Z.toFixed(1)});
        float dike = 1.0 - step(${DIKE.toFixed(2)}, min(cx, cz));
        // Water reflects the dusk sky, rippling slightly; dikes are packed mud.
        float ripple = sin(vWorld.x * 3.1 + uTime * 0.8) * sin(vWorld.z * 2.7 - uTime * 0.6) * 0.5 + 0.5;
        float facing = smoothstep(4.0, 26.0, vDepth);
        vec3 water = mix(vec3(0.05, 0.13, 0.11), vec3(0.62, 0.55, 0.38), facing * 0.75) + ripple * 0.03;
        vec3 mud = vec3(0.24, 0.2, 0.14);
        vec3 col = mix(water, mud, dike);
        col += vec3(0.66, 0.83, 0.36) * scanBand(vWorld.z) * 0.22;
        col = mix(col, uFog, smoothstep(8.0, 33.0, vDepth));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

type Bracket = HTMLDivElement | null;

function Field({ density, brackets }: { density: number; brackets: React.MutableRefObject<Bracket[]> }) {
  const geometry = useFieldGeometry(density);
  const blades = useMemo(() => bladeMaterial(), []);
  const ground = useMemo(() => groundMaterial(), []);
  const groundGeo = useMemo(() => new PlaneGeometry(FIELD_W + 120, FIELD_D + 80).rotateX(-Math.PI / 2), []);
  const { camera, size } = useThree();
  const start = useRef<number | null>(null);
  const smooth = useRef({ x: 0, y: 0, gust: 0 });
  const tmp = useMemo(() => new Vector3(), []);
  const pointer = useMemo(() => new Vector3(), []);

  useEffect(() => () => { geometry.dispose(); blades.dispose(); ground.dispose(); groundGeo.dispose(); }, [geometry, blades, ground, groundGeo]);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (start.current === null) start.current = t;
    const since = t - start.current;
    const grow = Math.min(1, since / 2.8);
    const s = smooth.current;
    const k = 1 - Math.exp(-delta * 2.5);
    s.x = MathUtils.lerp(s.x, heroInput.x, k);
    s.y = MathUtils.lerp(s.y, heroInput.y, k);
    const p = heroInput.scroll;

    // Camera: dolly in during the grow, gentle parallax, rise into a fly-over on scroll.
    const intro = 1 - Math.pow(1 - grow, 3);
    camera.position.set(s.x * 0.7, MathUtils.lerp(1.4, 2.6, intro) + p * 6 - s.y * 0.25, MathUtils.lerp(14, 9.5, intro) - p * 4);
    camera.lookAt(s.x * 0.3, 3.9 - p * 9, -8 - p * 2);

    // Pointer ray onto the ground plane (y = 0.35, mid-blade) for the gust.
    tmp.set(heroInput.x, -heroInput.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const dist = (0.35 - camera.position.y) / (tmp.y || -1e-3);
    if (dist > 0) pointer.copy(camera.position).addScaledVector(tmp, dist);
    const active = performance.now() - heroInput.moved < 900;
    s.gust = MathUtils.lerp(s.gust, active ? 1 : 0, 1 - Math.exp(-delta * 3));

    const cycle = since > 2.4 ? (since - 2.4) % SCAN_PERIOD : -1;
    const scan = cycle < 0 || cycle > SCAN_SWEEP ? SCAN_FROM - 4 : MathUtils.lerp(SCAN_FROM, SCAN_TO, cycle / SCAN_SWEEP);
    for (const m of [blades, ground]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uGrow.value = grow;
      m.uniforms.uScan.value = scan;
      m.uniforms.uPointer.value.copy(pointer);
      m.uniforms.uGust.value = s.gust;
    }

    // Brackets follow their patches on screen and switch on once the scan has passed them.
    PATCHES.forEach((patch, i) => {
      const el = brackets.current[i];
      if (!el) return;
      tmp.set(patch.x, 0.7, patch.z).project(camera);
      const x = (tmp.x * 0.5 + 0.5) * size.width;
      const y = (-tmp.y * 0.5 + 0.5) * size.height;
      const depth = camera.position.distanceTo(tmp.set(patch.x, 0.7, patch.z));
      const scale = MathUtils.clamp(9 / depth, 0.78, 1.25);
      const on = scan >= patch.z && cycle >= 0 && cycle <= SCAN_SWEEP + 1.6;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      el.classList.toggle("is-on", on && p < 0.5);
    });
  });

  return (
    <group>
      <mesh geometry={groundGeo} material={ground} position={[0, 0, (SCAN_FROM + FIELD_Z0) / 2]} />
      <mesh geometry={geometry} material={blades} frustumCulled={false} />
    </group>
  );
}

export default function RiceField3D({ paused = false, density = 1 }: { paused?: boolean; density?: number }) {
  const brackets = useRef<Bracket[]>([]);
  return (
    <div className="lp-field3d">
      <Canvas
        className="lp-hero-canvas"
        frameloop={paused ? "never" : "always"}
        camera={{ position: [0, 1.2, 13], fov: 42, near: 0.1, far: 80 }}
        dpr={[1, 1.4]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance", stencil: false }}
        aria-hidden="true"
      >
        <Field density={density} brackets={brackets} />
      </Canvas>
      {PATCHES.map((patch, i) => (
        <div key={i} ref={(el) => { brackets.current[i] = el; }} className="lp-anchor" aria-hidden="true">
          <div className={`lp-detect ${patch.kind === 2 ? "is-bs" : "is-blb"}`}>
            <i /><i /><i /><i />
            <b>{patch.label}</b>
          </div>
        </div>
      ))}
    </div>
  );
}
