import "./bulletin.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Minus, Plus, RotateCcw, X } from "lucide-react";
import type { Disease, PublicPhoto } from "./domain";
import { DISEASE_COLORS, DISEASE_NAMES } from "./DiseasePhoto";

const MIN = 1, MAX = 8;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Full-screen photo viewer. Wheel, pinch, double-tap and the +/- buttons zoom around the pointer;
 * dragging pans once zoomed. Disease layers stay registered to the photo at every zoom level.
 */
export function PhotoLightbox({ photos, index, onIndex, onClose }: {
  photos: PublicPhoto[]; index: number; onIndex: (next: number) => void; onClose: () => void;
}) {
  const photo = photos[index];
  const layers = photo.layers || {};
  const diseases = (Object.keys(layers) as Disease[]).filter((d) => layers[d]);
  const layered = Boolean(photo.original_url && diseases.length);
  const [showMarks, setShowMarks] = useState(true);
  const [percent, setPercent] = useState(100);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    photo.width && photo.height ? { w: photo.width, h: photo.height } : null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const view = useRef({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  const moved = useRef(false);

  const apply = useCallback((animate: boolean) => {
    const el = canvas.current, box = stage.current;
    if (!el || !box) return;
    const v = view.current;
    v.s = clamp(v.s, MIN, MAX);
    // Keep the photo covering the stage once it is larger than it; centre it otherwise.
    const spanX = Math.max(0, (fit.w * v.s - box.clientWidth) / 2);
    const spanY = Math.max(0, (fit.h * v.s - box.clientHeight) / 2);
    v.x = clamp(v.x, -spanX, spanX);
    v.y = clamp(v.y, -spanY, spanY);
    el.style.transition = animate ? "transform 240ms cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`;
    setPercent(Math.round(v.s * 100));
  }, [fit.w, fit.h]);

  const zoomAt = useCallback((next: number, cx = 0, cy = 0, animate = true) => {
    const v = view.current;
    const target = clamp(next, MIN, MAX);
    const k = target / v.s;
    v.x = cx - (cx - v.x) * k;
    v.y = cy - (cy - v.y) * k;
    v.s = target;
    apply(animate);
  }, [apply]);

  const reset = useCallback(() => { view.current = { s: 1, x: 0, y: 0 }; apply(true); }, [apply]);

  // Fit the photo inside the stage (contain), recomputed on resize.
  useLayoutEffect(() => {
    const box = stage.current;
    if (!box || !natural) return;
    const measure = () => {
      const k = Math.min(box.clientWidth / natural.w, box.clientHeight / natural.h);
      setFit({ w: natural.w * k, h: natural.h * k });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [natural]);

  useEffect(() => { apply(false); }, [apply]);

  useEffect(() => {
    view.current = { s: 1, x: 0, y: 0 };
    if (canvas.current) { canvas.current.style.transition = "none"; canvas.current.style.transform = "none"; }
    setPercent(100);
    setNatural(photo.width && photo.height ? { w: photo.width, h: photo.height } : null);
  }, [photo.url, photo.width, photo.height]);

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "+" || event.key === "=") zoomAt(view.current.s * 1.5);
      else if (event.key === "-") zoomAt(view.current.s / 1.5);
      else if (event.key === "0") reset();
      else if (event.key === "ArrowRight" && photos.length > 1) onIndex((index + 1) % photos.length);
      else if (event.key === "ArrowLeft" && photos.length > 1) onIndex((index - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); };
  }, [index, onClose, onIndex, photos.length, reset, zoomAt]);

  // Wheel needs a non-passive listener to stop the page from scrolling behind the viewer.
  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(view.current.s * Math.exp(-event.deltaY * 0.0016),
        event.clientX - r.left - r.width / 2, event.clientY - r.top - r.height / 2, false);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const local = (event: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.current.s };
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;
    const dx = event.clientX - last.x, dy = event.clientY - last.y;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const mid = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      zoomAt(pinch.current.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d, mid.x, mid.y, false);
    } else if (pointers.current.size === 1 && view.current.s > 1) {
      view.current.x += dx;
      view.current.y += dy;
      apply(false);
    }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onDoubleClick = (event: React.MouseEvent) => {
    const p = local(event);
    if (view.current.s > 1.05) reset(); else zoomAt(2.5, p.x, p.y);
  };

  const src = layered ? photo.original_url! : photo.url;
  return createPortal(
    <div className="rg-lightbox" role="dialog" aria-modal="true" aria-label={photo.alt}>
      <div className="rg-lightbox-bar">
        <span className="rg-lightbox-count">{photos.length > 1 ? `${index + 1} / ${photos.length}` : ""}</span>
        <div className="rg-lightbox-tools">
          <button type="button" onClick={() => zoomAt(view.current.s / 1.5)} aria-label="Zoom out" disabled={percent <= 100}><Minus size={18} /></button>
          <output aria-live="polite">{percent}%</output>
          <button type="button" onClick={() => zoomAt(view.current.s * 1.5)} aria-label="Zoom in" disabled={percent >= MAX * 100}><Plus size={18} /></button>
          <button type="button" onClick={reset} aria-label="I-reset ang zoom"><RotateCcw size={17} /></button>
          {layered ? (
            <button type="button" onClick={() => setShowMarks((value) => !value)} aria-pressed={!showMarks}
              aria-label={showMarks ? "Ipakita ang orihinal na larawan" : "Ipakita ang mga nakitang sakit"}>
              {showMarks ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          ) : null}
          <button type="button" className="rg-lightbox-close" onClick={onClose} aria-label="Isara"><X size={20} /></button>
        </div>
      </div>
      <div ref={stage} className={`rg-lightbox-stage ${percent > 100 ? "is-zoomed" : ""}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onClick={(event) => { if (event.target === event.currentTarget && !moved.current && view.current.s <= 1) onClose(); }}>
        <div ref={canvas} className="rg-lightbox-canvas" style={fit.w ? { width: fit.w, height: fit.h } : undefined}>
          <img src={src} alt={photo.alt} draggable={false} decoding="async"
            onLoad={(event) => { if (!natural) setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight }); }} />
          {layered ? diseases.map((disease) => (
            <img key={disease} className="rg-lightbox-layer" src={layers[disease]} alt="" aria-hidden draggable={false}
              style={{ opacity: showMarks ? 1 : 0 }} />
          )) : null}
        </div>
        {photos.length > 1 ? (
          <>
            <button type="button" className="rg-lightbox-nav is-prev" aria-label="Nakaraang larawan"
              onClick={() => onIndex((index - 1 + photos.length) % photos.length)}><ChevronLeft size={24} /></button>
            <button type="button" className="rg-lightbox-nav is-next" aria-label="Susunod na larawan"
              onClick={() => onIndex((index + 1) % photos.length)}><ChevronRight size={24} /></button>
          </>
        ) : null}
      </div>
      {layered ? (
        <div className="rg-lightbox-legend">
          {diseases.map((disease) => <span key={disease}><i style={{ background: DISEASE_COLORS[disease] }} />{DISEASE_NAMES[disease]}</span>)}
          <small>Scroll o pinch para mag-zoom · i-drag para gumalaw</small>
        </div>
      ) : <div className="rg-lightbox-legend"><small>Scroll o pinch para mag-zoom · i-drag para gumalaw</small></div>}
    </div>,
    document.body,
  );
}
