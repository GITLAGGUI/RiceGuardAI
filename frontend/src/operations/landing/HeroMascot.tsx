import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { heroRig, type Finding, type MascotRig, type Pose } from "./heroInput";

const POSES: Pose[] = ["search-right", "search-left", "search-hover", "stop", "think", "clipboard", "notes", "examine", "confirmed"];
const src = (pose: Pose) => `/images/mascot/hero/${pose}.webp`;
/** The pose images share one frame: the camera lens sits at 50% x, 74% y. */
const LENS_Y = 0.74;
const BODY_PX = 200;

const FINDINGS: Record<Finding, { name: string; risk: string; measure: string; image: string; checks: string[] }> = {
  blb: {
    name: "Bacterial Leaf Blight", risk: "Low risk", measure: "6.2% of leaf area · IRRI SES 3",
    image: "/images/hero/leaf-blb", checks: ["Streaks from the leaf tip", "Leaf area affected", "IRRI SES grade"],
  },
  healthy: {
    name: "Healthy leaves", risk: "No disease", measure: "0% of leaf area marked",
    image: "/images/hero/leaf-healthy", checks: ["Even green colour", "No lesions on the blades", "Nothing to report"],
  },
  brownspot: {
    name: "Brown Spot", risk: "Moderate risk", measure: "8.7% of leaf area · IRRI SES 5",
    image: "/images/hero/leaf-brownspot", checks: ["Oval brown specks", "Leaf area affected", "IRRI SES grade"],
  },
};

/**
 * The hero mascot. RiceField3D owns the choreography (where it flies, when it stops, what it found)
 * and writes positions through the rig every frame; React only renders when the card's step changes.
 */
export function HeroMascot({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const layerA = useRef<HTMLImageElement>(null);
  const layerB = useRef<HTMLImageElement>(null);
  const beamEl = useRef<HTMLDivElement>(null);
  const pool = useRef<HTMLDivElement>(null);
  const link = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ finding: Finding; step: number }>({ finding: "blb", step: active ? 0 : 5 });

  useEffect(() => {
    // Decode every pose up front so a swap never shows an empty frame.
    POSES.forEach((pose) => { const image = new Image(); image.src = src(pose); void image.decode?.().catch(() => undefined); });
    Object.values(FINDINGS).forEach((f) => { [f.image, `${f.image}-mask`].forEach((p) => { const image = new Image(); image.src = `${p}.webp`; }); });
  }, []);

  useEffect(() => {
    if (!active) return;
    let front = layerA.current!, back = layerB.current!;
    let current: Pose = "search-right";
    let stepKey = "";
    const cardPos = { x: 0, y: 0, ready: false, w: 280, h: 150, W: 1200, H: 800, frames: 0 };
    const rig: MascotRig = {
      place(x, y, size, tilt, squash, opacity) {
        const r = root.current, b = body.current;
        if (!r || !b) return;
        const k = size / BODY_PX;
        r.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        r.style.opacity = opacity.toFixed(3);
        b.style.transform = `translate(-50%, -${LENS_Y * 100}%) rotate(${tilt.toFixed(2)}deg) scale(${(k * (1 - squash * 0.6)).toFixed(4)}, ${(k * (1 + squash)).toFixed(4)})`;
      },
      beam(lx, ly, px, py, rx, ry, strength) {
        const cone = beamEl.current, ellipse = pool.current;
        if (!cone || !ellipse) return;
        // Both are fixed-size layers moved with transforms only, so the GPU composites them without repainting.
        // Cone: a small 100 x 400 trapezoid hung from the lens, stretched to the pool and turned toward it.
        const dx = px - lx, dy = py - ly, len = Math.max(1, Math.hypot(dx, dy));
        const angle = (-Math.atan2(dx, dy) * 180) / Math.PI;
        cone.style.transform = `translate3d(${(lx - 50).toFixed(1)}px, ${ly.toFixed(1)}px, 0) rotate(${angle.toFixed(2)}deg) scale(${((rx * 2) / 100).toFixed(3)}, ${(len / 400).toFixed(4)})`;
        cone.style.opacity = strength.toFixed(3);
        ellipse.style.transform = `translate3d(${(px - 50).toFixed(1)}px, ${(py - 50).toFixed(1)}px, 0) scale(${(rx / 50).toFixed(3)}, ${(ry / 50).toFixed(3)})`;
        ellipse.style.opacity = (strength * 0.9).toFixed(3);
      },
      card(lensX, lensY, bodySize, pointX, pointY) {
        const el = cardEl.current, line = link.current, end = dot.current, box = root.current?.parentElement;
        if (!el || !line || !end || !box) return;
        // Measure rarely: sizes only change with the card's content or a resize.
        if (cardPos.frames++ % 30 === 0) { cardPos.w = el.offsetWidth; cardPos.h = el.offsetHeight; cardPos.W = box.clientWidth; cardPos.H = box.clientHeight; }
        const { w, h, W, H } = cardPos;
        let x: number, y: number, side: "left" | "right" | "below";
        if (W < 760) {
          side = "below"; x = (W - w) / 2; y = H - h - 74;
        } else {
          const gap = bodySize * 0.42 + 18;
          side = lensX + gap + w < W - 20 ? "right" : "left";
          x = side === "right" ? lensX + gap : lensX - gap - w;
          y = Math.min(Math.max(lensY - bodySize * 0.7, 86), H - h - 96);
        }
        // The card trails its anchor a little so the mascot's bob never shakes the text.
        if (!cardPos.ready) { cardPos.x = x; cardPos.y = y; cardPos.ready = true; }
        cardPos.x += (x - cardPos.x) * 0.1;
        cardPos.y += (y - cardPos.y) * 0.1;
        const cardTransform = `translate3d(${cardPos.x.toFixed(1)}px, ${cardPos.y.toFixed(1)}px, 0)`;
        if (el.style.transform !== cardTransform) el.style.transform = cardTransform;
        if (el.dataset.side !== side) el.dataset.side = side;
        const sx = side === "below" ? cardPos.x + w / 2 : side === "left" ? cardPos.x + w : cardPos.x;
        const sy = side === "below" ? cardPos.y : cardPos.y + h * 0.5;
        const ldx = pointX - sx, ldy = pointY - sy;
        line.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) rotate(${((Math.atan2(ldy, ldx) * 180) / Math.PI).toFixed(2)}deg) scaleX(${(Math.hypot(ldx, ldy) / 1000).toFixed(4)})`;
        end.style.transform = `translate3d(${pointX.toFixed(1)}px, ${pointY.toFixed(1)}px, 0)`;
      },
      pose(next) {
        if (next === current) return;
        current = next;
        back.src = src(next);
        back.classList.add("is-on");
        front.classList.remove("is-on");
        [front, back] = [back, front];
      },
      step(finding, step) {
        const key = `${finding}:${step}`;
        if (key === stepKey) return;
        stepKey = key;
        if (step === 0) cardPos.ready = false;
        cardPos.frames = 0;
        setCard({ finding, step });
      },
    };
    heroRig.current = rig;
    return () => { if (heroRig.current === rig) heroRig.current = null; };
  }, [active]);

  const f = FINDINGS[card.finding];
  const open = card.step > 0;
  return (
    <div className={`lp-rig ${active ? "" : "is-static"}`} aria-hidden="true">
      <div className="lp-rig-light">
        <div ref={beamEl} className="lp-beam" />
        <div ref={pool} className="lp-pool" />
        <div ref={link} className={`lp-link ${open ? "is-on" : ""}`} />
        <div ref={dot} className={`lp-link-dot is-${card.finding} ${open ? "is-on" : ""}`} />
      </div>
      <div className="lp-mascot" ref={root}>
        <div className="lp-mascot-body" ref={body}>
          <img ref={layerA} className="is-on" src={src(active ? "search-right" : "confirmed")} alt="" width={BODY_PX} height={BODY_PX} draggable={false} />
          <img ref={layerB} src={src("search-left")} alt="" width={BODY_PX} height={BODY_PX} draggable={false} />
        </div>
      </div>
      <div ref={cardEl} className={`lp-find is-${card.finding} step-${card.step} ${open ? "is-open" : ""}`}>
        <figure>
          <img src={`${f.image}.webp`} alt="" width={112} height={112} />
          <img className="lp-find-mask" src={`${f.image}-mask.webp`} alt="" width={112} height={112} />
          <i className="lp-find-scan" />
        </figure>
        <div className="lp-find-text">
          <small>{card.step >= 5 ? "Checked by RiceGuardAI" : "Checking the leaves…"}</small>
          <h3>{f.name}</h3>
          <span className="lp-find-pill">{card.step >= 5 ? f.risk : <><i />Scanning</>}</span>
          {card.step >= 5 ? <p>{f.measure}</p> : (
            <ul>
              {f.checks.map((check, i) => (
                <li key={check} className={card.step >= i + 2 ? "is-done" : ""}><span><Check size={11} strokeWidth={3.2} /></span>{check}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
