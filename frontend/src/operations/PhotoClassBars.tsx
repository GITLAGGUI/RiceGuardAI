import { DISEASE_COLORS } from "./DiseasePhoto";

const LABELS: Record<string, string> = { BLB: "BLB", "Brown Spot": "Brown Spot", "Soil Nitrogen": "Soil nitrogen" };
const COLORS: Record<string, string> = { ...DISEASE_COLORS, "Soil Nitrogen": "var(--rg-nitrogen, #6b8f3a)" };

/** The first-step classifier's percentages for one photo, largest first. */
export function PhotoClassBars({ classification, compact = false }: {
  classification: { probs: Record<string, number>; top: string; uncertain: boolean };
  compact?: boolean;
}) {
  const rows = Object.entries(classification.probs).sort((a, b) => b[1] - a[1]);
  return (
    <div className={`rg-class-bars${compact ? " is-compact" : ""}`} aria-label="Tantiya ng classifier">
      <p className="rg-class-verdict">
        {classification.uncertain
          ? <b className="rg-class-uncertain">Hindi sigurado</b>
          : <b>Mukhang {LABELS[classification.top] || classification.top}</b>}
      </p>
      {rows.map(([name, p]) => (
        <div key={name} className="rg-class-row">
          <span>{LABELS[name] || name}</span>
          <span className="rg-class-track"><i style={{ width: `${Math.round(p * 100)}%`, background: COLORS[name] }} /></span>
          <span className="rg-class-value">{Math.round(p * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
