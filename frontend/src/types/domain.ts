import type { Disease, Severity } from "./database";

export const DISEASE_LABEL: Record<Disease, { tl: string; en: string }> = {
  rice_blast: { tl: "Sakit na Blast", en: "Rice Blast" },
  bacterial_leaf_blight: { tl: "Bacterial Leaf Blight", en: "Bacterial Leaf Blight" },
  tungro: { tl: "Tungro", en: "Tungro Virus" },
};

export const SEVERITY_LABEL: Record<Severity, { tl: string; en: string; color: string }> = {
  low: { tl: "Mababa", en: "Low", color: "#22c55e" },
  medium: { tl: "Katamtaman", en: "Medium", color: "#eab308" },
  high: { tl: "Mataas", en: "High", color: "#ef4444" },
};

export const REGION_II = {
  provinces: ["Isabela", "Cagayan"],
} as const;
