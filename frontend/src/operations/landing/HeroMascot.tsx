import { useEffect, useRef, useState } from "react";
import { heroInput } from "./heroInput";

type Mode = "fly" | "inspect" | "wave";
const SRC: Record<Mode, string> = {
  fly: "/images/mascot/mascot-fly.webp",
  inspect: "/images/mascot/mascot-inspect.webp",
  wave: "/images/mascot/mascot-wave.webp",
};
const FLY_SECONDS = 5.2;
const INSPECT_SECONDS = 2.4;

/**
 * The mascot patrols the paddy: a slow figure-eight over the field, smaller when it is
 * farther away, banking into each turn, then stopping to scan a spot with its magnifier.
 * One rAF loop writes transforms only; it stops when the hero is off screen.
 */
export function HeroMascot({ paused, narrow }: { paused: boolean; narrow: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("fly");
  const modeRef = useRef<Mode>("fly");
  const waveUntil = useRef(0);

  useEffect(() => {
    // Preload the other poses so a swap never flashes.
    Object.values(SRC).forEach((src) => { const image = new Image(); image.src = src; });
  }, []);

  useEffect(() => {
    if (paused) return;
    let frame = 0;
    let last = performance.now();
    let s = 0.4;            // position along the path
    let phaseTime = 0;      // seconds in the current fly/inspect phase
    let inspecting = false;
    let bank = 0, prevX: number | null = null;
    const set = (next: Mode) => { if (modeRef.current !== next) { modeRef.current = next; setMode(next); } };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const el = root.current, b = body.current, sh = shadow.current;
      const box = el?.parentElement?.getBoundingClientRect();
      if (el && b && sh && box) {
        phaseTime += dt;
        if (!inspecting && phaseTime > FLY_SECONDS) { inspecting = true; phaseTime = 0; }
        else if (inspecting && phaseTime > INSPECT_SECONDS) { inspecting = false; phaseTime = 0; }
        // Ease the speed down into an inspection and back up out of it.
        const speed = inspecting ? Math.max(0, 0.42 * (1 - phaseTime / 0.5)) : 0.42 * Math.min(1, phaseTime / 0.8);
        s += dt * speed;
        const waving = now < waveUntil.current;
        set(waving ? "wave" : inspecting ? "inspect" : "fly");

        // Figure-eight over the field; on desktop it keeps to the side opposite the headline.
        const cx = narrow ? 0.5 : 0.66, ax = narrow ? 0.34 : 0.24;
        const cy = narrow ? 0.72 : 0.66, ay = narrow ? 0.09 : 0.13;
        const nx = cx + ax * Math.sin(s);
        const ny = cy + ay * Math.sin(2 * s + 0.6);
        const depth = (ny - (cy - ay)) / (2 * ay);                // 0 far .. 1 near
        const scale = (narrow ? 0.62 : 0.72) + depth * (narrow ? 0.32 : 0.42);
        const scroll = heroInput.scroll;
        const x = nx * box.width;
        const hover = inspecting ? Math.sin(now / 260) * 3 + 10 : Math.sin(now / 420) * 6;
        const y = ny * box.height + hover - scroll * box.height * 0.35;

        // Bank into the turn from horizontal velocity, critically damped.
        const vx = prevX === null ? 0 : (x - prevX) / Math.max(dt, 1e-3);
        prevX = x;
        const targetBank = Math.max(-14, Math.min(14, vx * 0.09));
        bank += (targetBank - bank) * (1 - Math.exp(-dt * 6));

        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        b.style.transform = `translate(-50%, -100%) rotate(${bank.toFixed(2)}deg) scale(${(scale * (1 + scroll * 0.4)).toFixed(3)})`;
        sh.style.transform = `translate(-50%, ${(26 - hover).toFixed(1)}px) scale(${(scale * (inspecting ? 1.15 : 0.9)).toFixed(3)}, ${(scale * 0.5).toFixed(3)})`;
        sh.style.opacity = String((0.18 + depth * 0.16).toFixed(3));
        el.classList.toggle("is-inspecting", inspecting && !waving);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused, narrow]);

  return (
    <div className="lp-mascot" ref={root} aria-hidden="true">
      <div className="lp-mascot-shadow" ref={shadow} />
      <div className="lp-mascot-scan"><i /><b>Sinusuri ang dahon…</b></div>
      <div className="lp-mascot-body" ref={body}>
        <button type="button" tabIndex={-1} onClick={() => { waveUntil.current = performance.now() + 1600; }}>
          <img src={SRC[mode]} alt="" width={210} height={196} draggable={false} />
        </button>
      </div>
    </div>
  );
}
