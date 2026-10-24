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
  Vector4,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import { heroInput, heroRig, type Finding, type Pose } from "./heroInput";

/*
 * A transplanted rice paddy in the morning: rice hills in rows, water between them, mud dikes between paddies.
 * Every blade bends in the vertex shader (wind + a pointer gust), so the CPU only updates a few uniforms.
 * The mascot patrols the field with its camera light. It stops over three spots (BLB, healthy, Brown Spot):
 * the light pool brightens the blades and a semantic mask paints every affected blade in the pool, the way
 * the real models colour each diseased pixel. The DOM mascot, light cone and card are driven from here.
 */

const FIELD_W = 26;
const FIELD_D = 30;
const FIELD_Z0 = 4; // nearest edge
const CELL_X = 8.5; // paddy size between dikes
const CELL_Z = 9;
const DIKE = 0.42;
const SCAN_FROM = -FIELD_D + FIELD_Z0;

type Target = { x: number; z: number; finding: Finding; kind: number };
/** Spots the mascot inspects; on desktop they keep to the right, away from the headline. */
const TARGETS_WIDE: Target[] = [
  { x: 3.3, z: -2.2, finding: "blb", kind: 1 },
  { x: 6.4, z: -7.4, finding: "healthy", kind: 0 },
  { x: 1.9, z: -5.4, finding: "brownspot", kind: 2 },
];
const TARGETS_NARROW: Target[] = [
  { x: 0.7, z: -1.2, finding: "blb", kind: 1 },
  { x: -0.9, z: -6.2, finding: "healthy", kind: 0 },
  { x: 1.1, z: -4.0, finding: "brownspot", kind: 2 },
];
const SPOT_R = 1.7;
const ALTITUDE = 2.2;

/** Pose changes and card steps after the mascot arrives over a spot (seconds). */
type Plan = Array<[number, Pose, number]>;
const DISEASE_PLAN: Plan = [
  [0, "stop", 0], [0.85, "think", 1], [2.0, "clipboard", 1], [2.4, "clipboard", 2], [3.1, "notes", 2], [3.5, "notes", 3],
  [4.2, "examine", 3], [4.6, "examine", 4], [5.3, "confirmed", 4], [5.45, "confirmed", 5], [6.9, "confirmed", 0],
];
const HEALTHY_PLAN: Plan = [
  [0, "stop", 0], [0.85, "think", 1], [2.0, "clipboard", 1], [2.4, "clipboard", 2], [3.3, "notes", 3], [4.2, "notes", 4],
  [4.5, "confirmed", 4], [4.65, "confirmed", 5], [6.1, "confirmed", 0],
];
const planEnd = (plan: Plan) => plan[plan.length - 1][0] + 0.15;

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

function useFieldGeometry(density: number, targets: Target[]) {
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
        for (const p of targets) {
          if (!p.kind) continue;
          const r = SPOT_R * 1.15;
          const d = Math.hypot(hx - p.x, hz - p.z);
          if (d < r && rand() < 0.75 * (1 - d / r) + 0.3) { disease = 1 - (d / r) * 0.45; kind = p.kind; }
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
  }, [density, targets]);
}

const SHARED_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uGrow;
  uniform float uScan;
  uniform vec3 uFog;
  uniform vec3 uPointer;
  uniform float uGust;
  uniform vec4 uSpot;     // light pool: x, z, radius, strength
  uniform float uReveal;  // 0..1 progress of the semantic mask across the pool
  uniform float uMask;    // mask visibility
  uniform float uKind;    // 0 healthy, 1 BLB, 2 Brown Spot
  float poolLight(vec2 xz) { return smoothstep(uSpot.z, uSpot.z * 0.3, distance(xz, uSpot.xy)) * uSpot.w; }
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
      uFog: { value: new Color("#e6cf9e") },
      uPointer: { value: new Vector3(0, 0, -100) },
      uGust: { value: 0 },
      uSpot: { value: new Vector4(0, 0, 1, 0) },
      uReveal: { value: 0 },
      uMask: { value: 0 },
      uKind: { value: 0 },
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
      varying vec2 vXZ;
      varying float vPhase;
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
        vXZ = aOffset.xz;
        vPhase = aExtra.y;
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
      varying vec2 vXZ;
      varying float vPhase;
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
        // The mascot's light pool.
        float pool = poolLight(vXZ);
        col = mix(col, col * 1.4 + vec3(0.12, 0.1, 0.05), pool);
        // Semantic mask: a ring sweeps out from the pool centre and colours every affected blade inside it.
        float d = distance(vXZ, uSpot.xy);
        float front = uReveal * uSpot.z * 1.08;
        float revealed = smoothstep(front + 0.12, front - 0.12, d) * uMask;
        float sameKind = 1.0 - step(0.5, abs(floor(vKind + 0.5) - uKind));
        float blbLesion = step(1.0 - vDisease * 0.9, vH);
        float speck = step(0.74, fract(sin(floor(vH * 17.0) * 12.9898 + vPhase * 78.233) * 43758.5453)) * step(0.12, vH);
        float lesion = uKind < 1.5 ? blbLesion : speck;
        float marked = lesion * step(0.2, vDisease) * sameKind * revealed * step(0.5, uKind);
        vec3 maskCol = uKind < 1.5 ? vec3(1.0, 0.83, 0.0) : vec3(0.9, 0.15, 0.17);
        col = mix(col, maskCol, marked * 0.94);
        col = mix(col, vec3(0.6, 0.98, 0.62), revealed * (1.0 - step(0.5, uKind)) * 0.16 * step(0.3, vH));
        float ring = smoothstep(0.14, 0.0, abs(d - front)) * uMask * (1.0 - step(0.999, uReveal));
        col += vec3(0.78, 0.98, 0.52) * ring * 0.6;
        // Distance haze toward the morning horizon.
        col = mix(col, uFog, smoothstep(7.0, 27.0, vDepth));
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
      uFog: { value: new Color("#e6cf9e") },
      uPointer: { value: new Vector3(0, 0, -100) },
      uGust: { value: 0 },
      uSpot: { value: new Vector4(0, 0, 1, 0) },
      uReveal: { value: 0 },
      uMask: { value: 0 },
      uKind: { value: 0 },
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
        col += vec3(0.55, 0.48, 0.3) * poolLight(vWorld.xz) * 0.55;
        col = mix(col, uFog, smoothstep(7.0, 27.0, vDepth));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

/** The patrol: fly a curved path to the next spot, stop, inspect, report, move on. */
function useChoreography(targets: Target[], narrow: boolean) {
  return useRef({
    index: 0,
    phase: "enter" as "enter" | "travel" | "inspect",
    t: 0,
    duration: 3.2,
    from: new Vector3(), ctrl: new Vector3(), to: new Vector3(), pos: new Vector3(),
    screen: { x: 0, y: 0, vx: 0, ax: 0, ready: false },
    facing: 1, tilt: 0, squash: 0, squashV: 0, pose: "search-right" as Pose,
    spot: new Vector4(0, 0, 1.1, 0), reveal: 0, mask: 0, kind: 1,
    targets, narrow,
  });
}

function Field({ density, narrow }: { density: number; narrow: boolean }) {
  const targets = narrow ? TARGETS_NARROW : TARGETS_WIDE;
  const geometry = useFieldGeometry(density, targets);
  const blades = useMemo(() => bladeMaterial(), []);
  const ground = useMemo(() => groundMaterial(), []);
  const groundGeo = useMemo(() => new PlaneGeometry(FIELD_W + 120, FIELD_D + 80).rotateX(-Math.PI / 2), []);
  const { camera, size } = useThree();
  const start = useRef<number | null>(null);
  const smooth = useRef({ x: 0, y: 0, gust: 0 });
  const tmp = useMemo(() => new Vector3(), []);
  const pointer = useMemo(() => new Vector3(), []);
  const goal = useMemo(() => new Vector3(), []);
  const ch = useChoreography(targets, narrow);

  useEffect(() => () => { geometry.dispose(); blades.dispose(); ground.dispose(); groundGeo.dispose(); }, [geometry, blades, ground, groundGeo]);

  const project = (v: Vector3) => {
    tmp.copy(v).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * size.width, y: (-tmp.y * 0.5 + 0.5) * size.height };
  };

  useFrame(({ clock }, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 20);
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
    camera.updateMatrixWorld();

    // Pointer ray onto the ground plane (y = 0.35, mid-blade) for the gust.
    tmp.set(heroInput.x, -heroInput.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const dist = (0.35 - camera.position.y) / (tmp.y || -1e-3);
    if (dist > 0) pointer.copy(camera.position).addScaledVector(tmp, dist);
    const active = performance.now() - heroInput.moved < 900;
    s.gust = MathUtils.lerp(s.gust, active ? 1 : 0, 1 - Math.exp(-delta * 3));

    // ---- Patrol state machine ----
    const c = ch.current;
    const target = c.targets[c.index];
    const plan = target.kind ? DISEASE_PLAN : HEALTHY_PLAN;
    const goTo = (next: Target, from: Vector3, duration: number) => {
      c.from.copy(from);
      c.to.set(next.x, ALTITUDE, next.z);
      // Arc up and slightly sideways so the path reads as flight, not a slide.
      c.ctrl.copy(c.from).add(c.to).multiplyScalar(0.5);
      c.ctrl.y += 0.9;
      c.ctrl.x += (c.to.z - c.from.z) * 0.18;
      c.duration = duration;
      c.t = 0;
    };
    if (c.phase === "enter" && c.t === 0) goTo(target, tmp.set(target.x + 7, ALTITUDE + 2.2, target.z + 3), 3.4);
    c.t += delta;
    let step = 0;
    let wantPose: Pose = c.pose;
    let light = 0.55, radius = 1.15;
    const spotGoal = goal;
    if (c.phase === "enter" || c.phase === "travel") {
      const u = Math.min(1, c.t / c.duration);
      const e = easeInOut(u);
      const a = (1 - e) * (1 - e), b = 2 * (1 - e) * e, d2 = e * e;
      c.pos.set(
        a * c.from.x + b * c.ctrl.x + d2 * c.to.x,
        a * c.from.y + b * c.ctrl.y + d2 * c.to.y,
        a * c.from.z + b * c.ctrl.z + d2 * c.to.z,
      );
      // Searching: the light sweeps ahead of the mascot over the canopy.
      spotGoal.set(c.pos.x + Math.sin(t * 2.2) * 0.55, 0, c.pos.z + Math.cos(t * 1.6) * 0.4);
      if (u > 0.8) wantPose = "search-hover";
      else if (c.screen.vx > 30) { c.facing = 1; wantPose = "search-right"; }
      else if (c.screen.vx < -30) { c.facing = -1; wantPose = "search-left"; }
      else wantPose = c.facing > 0 ? "search-right" : "search-left";
      if (u >= 1) { c.phase = "inspect"; c.t = 0; c.kind = target.kind; c.reveal = 0; }
    } else {
      // Hovering over the spot with a small living drift.
      c.pos.set(c.to.x + Math.sin(t * 1.3) * 0.06, c.to.y + Math.sin(t * 2.1) * 0.05, c.to.z + Math.cos(t * 1.1) * 0.05);
      spotGoal.set(target.x, 0, target.z);
      light = 1; radius = SPOT_R;
      for (const [at, pose, cardStep] of plan) if (c.t >= at) { wantPose = pose; step = cardStep; }
      if (c.t > 0.7) c.reveal = Math.min(1, c.reveal + delta / 1.4);
      if (c.t >= planEnd(plan)) {
        c.phase = "travel";
        c.index = (c.index + 1) % c.targets.length;
        const next = c.targets[c.index];
        goTo(next, c.pos, 2.6 + Math.hypot(next.x - c.pos.x, next.z - c.pos.z) * 0.16);
      }
    }
    const inspecting = c.phase === "inspect";
    const cardOpen = inspecting && step > 0;
    c.mask = MathUtils.lerp(c.mask, cardOpen || (inspecting && c.t > 0.7 && c.t < planEnd(plan) - 0.2) ? 1 : 0, 1 - Math.exp(-delta * 4));
    const ks = 1 - Math.exp(-delta * 3.2);
    c.spot.x = MathUtils.lerp(c.spot.x, spotGoal.x, ks);
    c.spot.y = MathUtils.lerp(c.spot.y, spotGoal.z, ks);
    c.spot.z = MathUtils.lerp(c.spot.z, radius, ks);
    c.spot.w = MathUtils.lerp(c.spot.w, since > 1.2 ? light : 0, ks);

    for (const m of [blades, ground]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uGrow.value = grow;
      m.uniforms.uPointer.value.copy(pointer);
      m.uniforms.uGust.value = s.gust;
      m.uniforms.uSpot.value.copy(c.spot);
      m.uniforms.uReveal.value = c.reveal;
      m.uniforms.uMask.value = c.mask;
      m.uniforms.uKind.value = c.kind;
    }

    // ---- Drive the DOM mascot, cone and card ----
    const rig = heroRig.current;
    if (!rig) return;
    const lens = project(c.pos);
    if (!c.screen.ready) { c.screen.x = lens.x; c.screen.y = lens.y; c.screen.ready = true; }
    const vx = (lens.x - c.screen.x) / Math.max(delta, 1e-3);
    c.screen.ax = MathUtils.lerp(c.screen.ax, (vx - c.screen.vx) / Math.max(delta, 1e-3), 1 - Math.exp(-delta * 6));
    c.screen.vx = MathUtils.lerp(c.screen.vx, vx, 1 - Math.exp(-delta * 8));
    c.screen.x = lens.x; c.screen.y = lens.y;

    // Bank into the motion, lean back while braking; critically damped so it never snaps.
    const tiltGoal = MathUtils.clamp(c.screen.vx * 0.012 - c.screen.ax * 0.0035, -9, 9);
    c.tilt += (tiltGoal - c.tilt) * (1 - Math.exp(-delta * 5));
    // A pose change gives the body a small squash-and-settle, like it is shifting its weight.
    if (wantPose !== c.pose) { c.pose = wantPose; c.squashV += 0.55; rig.pose(wantPose); }
    c.squashV += (-170 * c.squash - 15 * c.squashV) * delta;
    c.squash += c.squashV * delta;

    const depth = camera.position.distanceTo(c.pos);
    const body = (narrow ? 132 : 196) * MathUtils.clamp(10.5 / depth, 0.62, 1.25);
    const fade = 1 - MathUtils.smoothstep(p, 0.3, 0.62);
    const appear = MathUtils.smoothstep(since, 0.9, 1.8);
    rig.place(lens.x, lens.y, body, c.tilt, c.squash, fade * appear);

    // Light pool on the ground, as an ellipse in screen space.
    const center = project(tmp.set(c.spot.x, 0.25, c.spot.y));
    const east = project(tmp.set(c.spot.x + c.spot.z, 0.25, c.spot.y));
    const near = project(tmp.set(c.spot.x, 0.25, c.spot.y + c.spot.z));
    const rx = Math.abs(east.x - center.x), ry = Math.max(6, Math.abs(near.y - center.y));
    rig.beam(lens.x, lens.y + body * 0.05, center.x, center.y, rx, ry, c.spot.w * fade * appear);
    rig.card(lens.x, lens.y, body, center.x, center.y);
    rig.step(target.finding, cardOpen ? step : 0);
  });

  return (
    <group>
      <mesh geometry={groundGeo} material={ground} position={[0, 0, (SCAN_FROM + FIELD_Z0) / 2]} />
      <mesh geometry={geometry} material={blades} frustumCulled={false} />
    </group>
  );
}

export default function RiceField3D({ paused = false, density = 1, narrow = false }: { paused?: boolean; density?: number; narrow?: boolean }) {
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
        <Field density={density} narrow={narrow} />
      </Canvas>
    </div>
  );
}
