// Short farmer-facing texts for the automated pipeline (SMS bodies and the no-LLM fallback).
import type { Disease, SeverityDetail } from "./autoSeverity.ts";
import type { AdvisoryResult } from "./ollamaAdvisory.ts";

const LEVEL: Record<string, string> = { low: "Mababa", moderate: "Katamtaman", high: "Mataas" };

/** Keep SMS in the GSM-7 alphabet: curly quotes and dashes would force 70-char Unicode parts. */
export function gsmSafe(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/…/g, "...").replace(/\s*\[S\d+\]/g, "").replace(/[^\x0A\x0D\x20-\x7E¡-ÿ]/g, "");
}

const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;

function findings(diseases: Disease[], severity: SeverityDetail) {
  return diseases.map((d) => {
    const s = severity.diseases[d];
    return s ? `${d} (${LEVEL[s.category]}, ${s.percent}%)` : d;
  }).join(" at ");
}

export function autoSmsText(diseases: Disease[], severity: SeverityDetail, place: string, actions: string[], link: string) {
  const steps = actions.slice(0, 2).map((a, i) => `${i + 1}) ${clip(gsmSafe(a), 120)}`).join(" ");
  return gsmSafe(`RiceGuardAI ALERTO: Posibleng ${findings(diseases, severity)} sa ${place}.\nGawin: ${steps}\n` +
    `Buong payo: ${link}\nReply STOP para huminto.`);
}

export function correctionSmsText(diseases: Disease[], severity: SeverityDetail, place: string, link: string) {
  return gsmSafe(`RiceGuardAI PAGTUTUWID: Sinuri ng specialist ang alerto sa ${place}. ` +
    `Ang kumpirmado: ${findings(diseases, severity)}. Basahin ang inayos na payo: ${link}\nReply STOP para huminto.`);
}

export function retractionSmsText(place: string) {
  return gsmSafe(`RiceGuardAI PAGTUTUWID: Sinuri ng specialist ang naunang alerto sa ${place} at walang nakitang ` +
    `BLB o Brown Spot. Pasensya sa abala; hindi na kailangang kumilos.\nReply STOP para huminto.`);
}

/** Used only when Ollama is unreachable after retries: approved DA-PhilRice guidance, plainly stated. */
export function templateAdvisory(
  facts: { diseases: Disease[]; place: string; overall_severity: string; severity: Record<string, { percent: number; ses_score: number }> },
  approved: Array<{ title: string; source_reference: string; guidance: any; disease: string }>,
): AdvisoryResult {
  const parts = facts.diseases.map((d) => `${d} na tumama sa mga ${facts.severity[d]?.percent ?? 0}% ng dahon sa pinaka-apektadong larawan (SES ${facts.severity[d]?.ses_score ?? "-"})`);
  const sources = approved.slice(0, 4).map((a, i) => ({ n: i + 1, title: a.title, url: a.source_reference,
    publisher: "DA-PhilRice (approved guidance)", excerpt: "", approved: true }));
  const actions = approved.flatMap((a, i) => (Array.isArray(a.guidance?.recommended_actions) ? a.guidance.recommended_actions : [])
    .slice(0, 2).map((text: string) => `${text} [S${i + 1}]`)).slice(0, 5);
  while (actions.length < 3) actions.push(["Silipin ang mga dahon sa iba't ibang bahagi ng bukid ngayong linggo.",
    "Iwasan ang sobrang nitrogen habang may sakit.", "Kumonsulta sa Municipal Agriculturist ng inyong bayan."][actions.length]);
  return {
    title: `${facts.diseases.join(" at ")} sa ${facts.place}`,
    summary: `May nakitang ${parts.join(" at ")} sa ${facts.place}. ${LEVEL[facts.overall_severity] ?? ""} ang kabuuang tama sa ngayon, ` +
      "kaya mabuting kumilos na bago ito kumalat.",
    actions, watch_for: [], sources, observations: [], queries: [], model: "approved-guidance-template", mode: "template",
  };
}
