import { useEffect, useMemo, useRef } from "react";
import { heroInput } from "./heroInput";

/*
 * Morning over the Cagayan Valley: a warm sky, the sun breaking over the Sierra Madre, slow god rays,
 * clouds drifting, a tree line of coconut palms and a bahay kubo where the paddies meet the hills.
 * Every layer only moves with transforms; one rAF loop eases them toward the pointer and stops offscreen.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ridge line across a 1600 x 400 box: summed sines with a seeded jitter. */
function ridge(seed: number, base: number, amp: number, waves: number[]) {
  const rand = mulberry32(seed);
  const phase = waves.map(() => rand() * Math.PI * 2);
  let d = `M0 400 L0 ${base}`;
  for (let x = 0; x <= 1600; x += 20) {
    let y = base;
    waves.forEach((w, i) => { y -= Math.sin((x / 1600) * Math.PI * 2 * w + phase[i]) * amp / (i + 1); });
    y -= (rand() - 0.5) * amp * 0.06;
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return `${d} L1600 400 Z`;
}

function palm(x: number, y: number, h: number, lean: number) {
  const top = { x: x + lean, y: y - h };
  const trunk = `M${x - 1.6} ${y} Q${x + lean * 0.3} ${y - h * 0.55} ${top.x - 0.8} ${top.y} L${top.x + 0.8} ${top.y} Q${x + lean * 0.3 + 2.4} ${y - h * 0.55} ${x + 1.6} ${y} Z`;
  const fronds = [-150, -115, -70, -30, 10, 45].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const len = h * (0.42 + (i % 2) * 0.08);
    const ex = top.x + Math.cos(a) * len, ey = top.y + Math.sin(a) * len * 0.5 + len * 0.28;
    const cx = top.x + Math.cos(a) * len * 0.55, cy = top.y + Math.sin(a) * len * 0.5 - len * 0.12;
    return `M${top.x} ${top.y} Q${cx} ${cy} ${ex} ${ey} Q${cx} ${cy + 4} ${top.x} ${top.y + 2} Z`;
  });
  return [trunk, ...fronds].join(" ");
}

const circle = (cx: number, cy: number, r: number) => `M${(cx - r).toFixed(1)} ${cy.toFixed(1)} a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(r * 2).toFixed(1)} 0 a${r.toFixed(1)} ${r.toFixed(1)} 0 1 0 ${(-r * 2).toFixed(1)} 0`;

/** Broadleaf trees as clusters of overlapping crowns, with coconut palms rising above them. */
function treeLine(seed: number, ground: number, scale: number, palms: number) {
  const rand = mulberry32(seed);
  const parts: string[] = [`M0 ${ground} H1600 V400 H0 Z`];
  let x = -30;
  while (x < 1640) {
    const r = (9 + rand() * 15) * scale;
    const top = ground - r * (1.1 + rand() * 0.8);
    for (let k = 0; k < 4; k += 1) parts.push(circle(x + (rand() - 0.5) * r * 1.6, top + rand() * r * 0.9, r * (0.55 + rand() * 0.5)));
    parts.push(`M${x - r} ${ground} L${x - r * 0.7} ${top + r * 0.6} L${x + r * 0.7} ${top + r * 0.6} L${x + r} ${ground} Z`);
    x += r * (1.2 + rand() * 1.4) + (rand() < 0.12 ? 40 * scale : 0);
  }
  for (let i = 0; i < palms; i += 1) {
    const px = 40 + (i / palms) * 1560 + (rand() - 0.5) * 90;
    parts.push(palm(px, ground + 2, (48 + rand() * 38) * scale, (rand() - 0.5) * 26 * scale));
  }
  return parts.join(" ");
}

/** A bahay kubo on stilts: thatched roof, raised floor, ladder. */
function kubo(x: number, y: number, s: number) {
  const w = 34 * s, h = 16 * s, roof = 20 * s, stilt = 9 * s;
  return [
    `M${x - w / 2 - 6 * s} ${y - stilt - h} L${x} ${y - stilt - h - roof} L${x + w / 2 + 6 * s} ${y - stilt - h} Z`,
    `M${x - w / 2} ${y - stilt - h} h${w} v${h} h${-w} Z`,
    ...[-0.42, -0.14, 0.14, 0.42].map((k) => `M${x + w * k - 1} ${y - stilt} h2 v${stilt} h-2 Z`),
  ].join(" ");
}

export function HeroSky({ paused }: { paused: boolean }) {
  const layers = useRef<Array<HTMLElement | SVGSVGElement | null>>([]);
  const paths = useMemo(() => ({
    far: ridge(11, 300, 70, [1.3, 3.1, 6.2]),
    mid: ridge(23, 330, 46, [1.9, 4.3, 9.1]),
    near: ridge(37, 352, 26, [2.6, 6.8, 13.4]),
    treesBack: treeLine(7, 368, 0.7, 6),
    trees: treeLine(2026, 378, 1, 9),
    huts: `${kubo(1130, 376, 1)} ${kubo(1196, 378, 0.72)} ${kubo(360, 377, 0.8)}`,
  }), []);

  useEffect(() => {
    if (paused) return;
    const depth = [0, 0.15, 0.25, 0.45, 0.7, 1, 1.2];
    let frame = 0;
    const s = { x: 0, y: 0 };
    let written = "";
    const tick = () => {
      s.x += (heroInput.x - s.x) * 0.05;
      s.y += (heroInput.y - s.y) * 0.05;
      const lift = heroInput.scroll;
      // Skip the style writes while nothing moves (always the case on touch screens at rest).
      const key = `${s.x.toFixed(3)}|${s.y.toFixed(3)}|${lift.toFixed(4)}`;
      if (key === written) { frame = requestAnimationFrame(tick); return; }
      written = key;
      layers.current.forEach((el, i) => {
        if (!el) return;
        const k = depth[i] ?? 1;
        (el as HTMLElement).style.transform = `translate3d(${(s.x * -14 * k).toFixed(2)}px, ${(s.y * -5 * k + lift * 120 * (1.2 - k * 0.6)).toFixed(2)}px, 0)`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused]);

  const set = (i: number) => (el: HTMLElement | SVGSVGElement | null) => { layers.current[i] = el; };
  return (
    <div className="lp-sky" aria-hidden="true">
      <div className="lp-sky-grad" ref={set(0)} />
      <div className="lp-sky-sun" ref={set(1)}><i className="lp-sky-rays" /><b /></div>
      <div className="lp-sky-clouds" ref={set(2)}><i className="c1" /><i className="c2" /><i className="c3" /><i className="c4" /></div>
      <svg className="lp-sky-birds" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice">
        <g className="flock">
          {[[0, 0, 1], [26, 10, 0.8], [48, -6, 0.9], [70, 14, 0.7], [92, 4, 0.75]].map(([x, y, k], i) => (
            <path key={i} className="bird" style={{ animationDelay: `${i * 0.13}s` }}
              d={`M${x} ${y} q${5 * k} ${-5 * k} ${10 * k} 0 q${5 * k} ${-5 * k} ${10 * k} 0`} />
          ))}
        </g>
      </svg>
      <svg className="lp-sky-hills" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" ref={set(3)}>
        <defs>
          <linearGradient id="lp-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fb0a6" /><stop offset="1" stopColor="#d9c99a" /></linearGradient>
          <linearGradient id="lp-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6f948a" /><stop offset="1" stopColor="#cdbd8d" /></linearGradient>
        </defs>
        <path d={paths.far} fill="url(#lp-far)" opacity=".78" />
      </svg>
      <svg className="lp-sky-hills" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" ref={set(4)}>
        <path d={paths.mid} fill="url(#lp-mid)" opacity=".9" />
      </svg>
      <svg className="lp-sky-hills" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice" ref={set(5)}>
        <path d={paths.near} fill="#5d7f6b" opacity=".92" />
        <path d={paths.treesBack} fill="#55735f" opacity=".9" />
        <path d={paths.trees} fill="#33503f" />
        <path d={paths.huts} fill="#2b4535" />
      </svg>
      <div className="lp-sky-haze" ref={set(6)} />
    </div>
  );
}
