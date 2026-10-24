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
  const beamPath = useRef<SVGPathElement>(null);
  const beamGrad = useRef<SVGLinearGradientElement>(null);
  const pool = useRef<SVGEllipseElement>(null);
  const link = useRef<SVGLineElement>(null);
  const dot = useRef<SVGCircleElement>(null);
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
        const path = beamPath.current, grad = beamGrad.current, ellipse = pool.current;
        if (!path || !grad || !ellipse) return;
        // Cone: narrow at the lens, meeting the pool at its widest horizontal points.
        path.setAttribute("d", `M${(lx - 5).toFixed(1)} ${ly.toFixed(1)} L${(px - rx).toFixed(1)} ${py.toFixed(1)} A${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 0 ${(px + rx).toFixed(1)} ${py.toFixed(1)} L${(lx + 5).toFixed(1)} ${ly.toFixed(1)} Z`);
        grad.setAttribute("x1", lx.toFixed(1)); grad.setAttribute("y1", ly.toFixed(1));
        grad.setAttribute("x2", px.toFixed(1)); grad.setAttribute("y2", (py + ry).toFixed(1));
        path.style.opacity = strength.toFixed(3);
        ellipse.setAttribute("cx", px.toFixed(1)); ellipse.setAttribute("cy", py.toFixed(1));
        ellipse.setAttribute("rx", rx.toFixed(1)); ellipse.setAttribute("ry", ry.toFixed(1));
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
        el.style.transform = `translate3d(${cardPos.x.toFixed(1)}px, ${cardPos.y.toFixed(1)}px, 0)`;
        if (el.dataset.side !== side) el.dataset.side = side;
        const sx = side === "below" ? cardPos.x + w / 2 : side === "left" ? cardPos.x + w : cardPos.x;
        const sy = side === "below" ? cardPos.y : cardPos.y + h * 0.5;
        line.setAttribute("x1", sx.toFixed(1)); line.setAttribute("y1", sy.toFixed(1));
        line.setAttribute("x2", pointX.toFixed(1)); line.setAttribute("y2", pointY.toFixed(1));
        end.setAttribute("cx", pointX.toFixed(1)); end.setAttribute("cy", pointY.toFixed(1));
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
      <svg className="lp-rig-light">
        <defs>
          <linearGradient id="lp-beam-grad" ref={beamGrad} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff6d8" stopOpacity=".72" />
            <stop offset=".55" stopColor="#ffeeb8" stopOpacity=".26" />
            <stop offset="1" stopColor="#ffe9a8" stopOpacity=".1" />
          </linearGradient>
          <radialGradient id="lp-pool-grad">
            <stop offset="0" stopColor="#fff4cf" stopOpacity=".5" />
            <stop offset=".7" stopColor="#ffe9a8" stopOpacity=".16" />
            <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path ref={beamPath} className="lp-beam" fill="url(#lp-beam-grad)" />
        <ellipse ref={pool} className="lp-pool" fill="url(#lp-pool-grad)" />
        <line ref={link} className={`lp-link ${open ? "is-on" : ""}`} />
        <circle ref={dot} className={`lp-link-dot is-${card.finding} ${open ? "is-on" : ""}`} r="5" />
      </svg>
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
