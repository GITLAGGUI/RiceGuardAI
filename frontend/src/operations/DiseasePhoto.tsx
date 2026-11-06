import "./operations.css";
import "./bulletin.css";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Disease } from "./domain";

export const DISEASE_COLORS: Record<Disease, string> = { BLB: "#FFD400", "Brown Spot": "#00E676" };
export const DISEASE_NAMES: Record<Disease, string> = { BLB: "Bacterial Leaf Blight", "Brown Spot": "Brown Spot" };

type Props = {
  original?: string;
  layers?: Partial<Record<Disease, string>>;
  /** Single pre-rendered image for older posts without layers. */
  fallback: string;
  alt: string;
  width?: number;
  height?: number;
  compact?: boolean;
  onOpen?: () => void;
};

type Hit = { width: number; height: number; alpha: Uint8ClampedArray };

/**
 * Original photo with one transparent layer per disease (BLB yellow, Brown Spot red).
 * The eye button hides the marks to show the untouched photo. Hovering a legend item or a
 * marked region dims everything else so that disease stands out.
 */
export function DiseasePhoto({ original, layers = {}, fallback, alt, width, height, compact, onOpen }: Props) {
  const diseases = (Object.keys(layers) as Disease[]).filter((d) => layers[d]);
  const layered = Boolean(original && diseases.length);
  const [showMarks, setShowMarks] = useState(true);
  const [focus, setFocus] = useState<Disease | null>(null);
  const hits = useRef<Partial<Record<Disease, Hit>>>({});

  // Read layer alpha once so hovering a region can tell which disease is under the pointer.
  // Cross-origin images without CORS stay hover-by-legend only.
  const layerKey = diseases.map((d) => layers[d]).join("|");
  useEffect(() => {
    hits.current = {};
    if (!layered) return;
    let cancelled = false;
    for (const disease of diseases) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        if (cancelled) return;
        try {
          const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
          for (let i = 0; i < alpha.length; i += 1) alpha[i] = pixels[i * 4 + 3];
          hits.current[disease] = { width: canvas.width, height: canvas.height, alpha };
        } catch {
          // Tainted canvas: no region hover for this layer.
        }
      };
      image.src = layers[disease]!;
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKey, layered]);

  const regionAt = (event: React.PointerEvent<HTMLDivElement>): Disease | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
    for (const disease of diseases) {
      const hit = hits.current[disease];
      if (!hit) continue;
      // Search a small neighbourhood: lesions are thin and fingers are not.
      const cx = Math.round(x * (hit.width - 1)), cy = Math.round(y * (hit.height - 1));
      for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
        const px = cx + dx, py = cy + dy;
        if (px >= 0 && py >= 0 && px < hit.width && py < hit.height && hit.alpha[py * hit.width + px] > 0) return disease;
      }
    }
    return null;
  };

  if (!layered) {
    return (
      <figure className={`rg-disease-photo ${compact ? "is-compact" : ""}`}>
        <div className="rg-disease-stage" style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
          <img src={fallback} alt={alt} loading="lazy" decoding="async" onClick={onOpen} />
        </div>
      </figure>
    );
  }

  return (
    <figure className={`rg-disease-photo ${compact ? "is-compact" : ""} ${focus ? "has-focus" : ""}`}>
      <div className="rg-disease-stage" style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
        onPointerMove={(event) => { if (showMarks && event.pointerType === "mouse") setFocus(regionAt(event)); }}
        onPointerLeave={() => setFocus(null)}>
        <img className="rg-disease-base" src={original} alt={alt} loading="lazy" decoding="async" onClick={onOpen} />
        {diseases.map((disease) => (
          <img key={disease} className={`rg-disease-layer ${focus === disease ? "is-focus" : focus ? "is-muted" : ""}`}
            src={layers[disease]} alt="" aria-hidden loading="lazy" decoding="async"
            style={{ opacity: showMarks ? undefined : 0, ["--rg-glow" as string]: DISEASE_COLORS[disease] }} />
        ))}
        <button type="button" className="rg-eye-toggle" aria-pressed={!showMarks}
          aria-label={showMarks ? "Ipakita ang orihinal na larawan" : "Ipakita ang mga nakitang sakit"}
          title={showMarks ? "Orihinal na larawan" : "Ipakita ang sakit"}
          onClick={(event) => { event.stopPropagation(); setShowMarks((value) => !value); setFocus(null); }}>
          {showMarks ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      <figcaption className="rg-disease-legend" aria-label="Legend">
        {diseases.map((disease) => (
          <button type="button" key={disease} className={focus === disease ? "is-active" : ""} disabled={!showMarks}
            onPointerEnter={() => setFocus(disease)} onPointerLeave={() => setFocus(null)}
            onFocus={() => setFocus(disease)} onBlur={() => setFocus(null)}
            onClick={() => setFocus((current) => current === disease ? null : disease)}>
            <i style={{ background: DISEASE_COLORS[disease] }} aria-hidden />{compact ? disease : DISEASE_NAMES[disease]}
          </button>
        ))}
      </figcaption>
    </figure>
  );
}
