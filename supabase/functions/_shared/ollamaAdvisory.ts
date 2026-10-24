// Automated advisory with Ollama Cloud (gemma4): look at the photos, plan searches, search the
// web, then write a short Taglish advisory that cites only the sources it was given.
// The latest OpenWeather reading and 24-hour forecast shape timing (drain, spray, fertilise).

import { weatherBrief } from "./weatherContext.ts";

export type Disease = "BLB" | "Brown Spot";

export interface AdvisoryFacts {
  diseases: Disease[];
  severity: Record<string, { percent: number; ses_score: number; category: string; photo_number: number; affected_photos: number }>;
  overall_severity: string;
  photos: number;
  place: string;
  crop_stage: string | null;
  field_conditions: string[];
  weather: unknown;
}

export interface Source { n: number; title: string; url: string; publisher: string; excerpt: string; approved?: boolean }

export interface AdvisoryResult {
  title: string;
  summary: string;
  actions: string[];
  watch_for: string[];
  sources: Source[];
  observations: string[];
  queries: string[];
  model: string;
  mode: "ollama" | "template";
}

const TRUSTED = [
  "irri.org", "philrice.gov.ph", "da.gov.ph", "bpi.da.gov.ph", "pcaarrd.dost.gov.ph", "fao.org",
  "cgiar.org", "apsnet.org", "ipm.ucanr.edu", "agriculture.gov.ph", "atf.da.gov.ph", ".edu.ph", ".edu",
];
const BLOCKED = ["youtube.com", "facebook.com", "tiktok.com", "pinterest.", "amazon.", "shopee", "lazada"];
const CHEMICAL = /\b(\d+(\.\d+)?\s?(ml|mL|g|kg|l|L|liters?|litro|grams?|gramo|sachets?|tbsp|kutsara)\b|fungicide|bactericide|copper|mancozeb|streptomycin|tricyclazole|propiconazole|carbendazim|hexaconazole|azoxystrobin)/i;

const DISEASE_NAMES: Record<Disease, string> = {
  BLB: "Bacterial Leaf Blight (BLB, Xanthomonas oryzae pv. oryzae)",
  "Brown Spot": "Brown Spot (Bipolaris oryzae)",
};

export function trustRank(url: string): number {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  if (!host || BLOCKED.some((item) => host.includes(item))) return -1;
  const index = TRUSTED.findIndex((item) => item.startsWith(".") ? host.endsWith(item) : host === item || host.endsWith(`.${item}`));
  return index === -1 ? 0 : 100 - index;
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

async function chat(base: string, key: string, model: string, messages: unknown[], timeoutMs: number) {
  const response = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model, stream: false, format: "json", options: { temperature: 0.2, top_p: 0.9, num_predict: 1800 }, messages }),
  });
  if (!response.ok) throw new Error(`Ollama chat ${response.status}`);
  const payload = await response.json();
  return parseJson(String(payload?.message?.content || ""));
}

async function webSearch(base: string, key: string, query: string) {
  const response = await fetch(`${base}/web_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ query, max_results: 5 }),
  });
  if (!response.ok) throw new Error(`Ollama web_search ${response.status}`);
  const payload = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return payload.results || [];
}

const strings = (value: unknown, max: number, limit: number) =>
  (Array.isArray(value) ? value : []).map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, max).map((item) => item.slice(0, limit));

/** Reject drafts that are empty, invent sources, or give chemicals/doses without a citation. */
export function validateDraft(raw: Record<string, unknown>, sourceCount: number) {
  const summary = String(raw.summary ?? "").trim();
  const actions = strings(raw.actions, 7, 320);
  const watch = strings(raw.watch_for, 3, 220);
  const title = String(raw.title ?? "").trim().slice(0, 120);
  const problems: string[] = [];
  if (summary.length < 60 || summary.length > 900) problems.push("summary must be 60-900 characters");
  if (actions.length < 3) problems.push("give 3 to 7 actions");
  const cited = new Set<number>();
  for (const text of [summary, ...actions, ...watch]) {
    for (const match of text.matchAll(/\[S(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n < 1 || n > sourceCount) problems.push(`[S${n}] is not one of the given sources`);
      cited.add(n);
    }
  }
  for (const action of actions) {
    if (CHEMICAL.test(action) && !/\[S\d+\]/.test(action)) problems.push(`cite a source for: "${action.slice(0, 60)}"`);
  }
  if (sourceCount > 0 && cited.size === 0) problems.push("cite at least one source as [S#]");
  if (/\b(unverified|hindi pa verified|AI prediction|not confirmed)\b/i.test(summary)) problems.push("do not talk about verification status; the website shows it");
  return { ok: problems.length === 0, problems, draft: { title, summary, actions, watch_for: watch, cited: [...cited] } };
}

export async function generateAdvisory(input: {
  base: string; key: string; model: string; facts: AdvisoryFacts;
  images: string[]; approved: Array<{ title: string; reference: string; guidance: unknown }>;
}): Promise<AdvisoryResult> {
  const { base, key, model, facts, images } = input;
  const diseaseList = facts.diseases.map((d) => DISEASE_NAMES[d]).join(" at ");
  const weather = weatherBrief(facts.weather);
  const point = (facts.weather as { point?: { lat: number; lng: number } } | null)?.point;
  const findings = { ...facts, weather };
  const system = "Ikaw ay rice crop-protection adviser para sa mga magsasaka sa Cagayan Valley (Region II, Philippines). " +
    "Natural at diretso ang pananalita mo sa Taglish, parang extension worker na kausap ang magsasaka. Walang paligoy-ligoy.";

  // 1. Look and plan: what does the photo show, and what must we look up to advise well?
  const plan = await chat(base, key, model, [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify({
      task: "Suriin ang mga larawan (una: orihinal, pangalawa: may kulay na marka ng AI; dilaw = BLB, pula = Brown Spot) at ang findings. " +
        "Ano ang nakikita mo sa palay (yugto ng tanim, kulay ng dahon, tubig, gaano kalawak ang marka)? " +
        "Tingnan din ang weather (ngayon at susunod na 24 oras): uulan ba, mahalumigmig, mahangin? " +
        "Pagkatapos, gumawa ng 2-4 na search query (English) para malaman ang tamang gawin para sa sakit, yugto ng tanim, kalagayan ng bukid at panahong ito. " +
        "Unahin ang IRRI, PhilRice at DA. Return JSON {observations: string[], search_queries: string[]}.",
      findings,
    }), ...(images.length ? { images } : {}) },
  ], 60_000);
  const observations = strings(plan.observations, 6, 240);
  const queries = strings(plan.search_queries, 4, 160);
  if (!queries.length) queries.push(...facts.diseases.map((d) => `${DISEASE_NAMES[d]} rice management Philippines PhilRice IRRI`));

  // 2. Research: trusted agencies first, at most six sources.
  const seen = new Set<string>();
  const found: Array<{ title: string; url: string; content: string; rank: number }> = [];
  const results = await Promise.allSettled(queries.map((query) => webSearch(base, key, query)));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const url = String(item.url || "");
      const rank = trustRank(url);
      if (!url || rank < 0 || seen.has(url) || !item.content) continue;
      seen.add(url);
      found.push({ title: String(item.title || url).slice(0, 160), url, content: String(item.content), rank });
    }
  }
  found.sort((a, b) => b.rank - a.rank);
  const sources: Source[] = found.slice(0, 5).map((item, i) => ({
    n: i + 1, title: item.title, url: item.url,
    publisher: (() => { try { return new URL(item.url).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
    excerpt: item.content.replace(/\s+/g, " ").slice(0, 1800),
  }));
  for (const approved of input.approved.slice(0, 2)) {
    sources.push({ n: sources.length + 1, title: approved.title, url: approved.reference, publisher: "DA-PhilRice (approved guidance)",
      excerpt: JSON.stringify(approved.guidance).slice(0, 1500), approved: true });
  }

  if (weather && (weather.now || weather.next_24h)) {
    sources.push({ n: sources.length + 1, title: "OpenWeather: lagay ng panahon ngayon at susunod na 24 oras",
      url: point ? `https://openweathermap.org/weathermap?basemap=map&cities=true&layer=precipitation&lat=${point.lat}&lon=${point.lng}&zoom=10`
        : "https://openweathermap.org/", publisher: "OpenWeather", excerpt: JSON.stringify(weather).slice(0, 1500) });
  }

  // 3. Write, validate, and retry once with the validator's complaints.
  const ask = {
    task: `Isulat ang advisory para sa ${diseaseList}. Isipin mo muna: ano ang ibig sabihin ng findings at severity para sa bukid na ito, ` +
      "at ano ang pinaka-praktikal na gagawin ng magsasaka ngayong linggo, ayon sa yugto ng tanim at kalagayan ng bukid.",
    rules: [
      "Taglish, natural, diretso. Walang 'Paalala', walang disclaimer tungkol sa AI o verification; ipinapakita na iyon ng website.",
      "summary: 2-4 pangungusap: ano ang nakita, gaano kalala (gamitin ang severity at SES), at bakit mahalaga ngayon.",
      "actions: 3-6 na hakbang, bawat isa nagsisimula sa pandiwa at kongkreto (ano, saan, kailan).",
      "watch_for: 0-3 senyales na dapat bantayan sa susunod na mga araw.",
      "Lagyan ng [S#] ang pahayag na galing sa source. Gamitin LANG ang numbered sources na ibinigay.",
      "Huwag magbigay ng pangalan ng kemikal o dosis kung hindi ito nakasulat sa isang source; kung meron, banggitin ang [S#].",
      "title: maikli, hal. 'BLB sa Brgy. X: katamtaman ang tama'.",
      "Isaalang-alang ang weather kung may epekto ito: hal. kung uulan sa loob ng 24 oras, huwag mag-spray bago umulan at linisin ang kanal; " +
        "kung mahalumigmig nang matagal o mahangin, sabihin kung bakit ito nagpapabilis ng sakit. Banggitin ang oras o dami (hal. 'mga 12 mm na ulan bukas ng hapon') " +
        "at i-cite ang OpenWeather source. Kung walang weather data o walang epekto, huwag itong pilitin.",
    ],
    findings, what_the_model_saw: observations,
    sources: sources.map(({ n, title, publisher, excerpt }) => ({ n, title, publisher, excerpt })),
    return: "JSON {title, summary, actions: string[], watch_for: string[]}",
  };
  const messages: unknown[] = [{ role: "system", content: system }, { role: "user", content: JSON.stringify(ask) }];
  let checked = validateDraft(await chat(base, key, model, messages, 75_000), sources.length);
  if (!checked.ok) {
    messages.push({ role: "assistant", content: JSON.stringify(checked.draft) },
      { role: "user", content: `Ayusin ito at ibalik ang buong JSON: ${checked.problems.join("; ")}` });
    checked = validateDraft(await chat(base, key, model, messages, 75_000), sources.length);
  }
  if (!checked.ok) throw new Error(`Advisory failed validation: ${checked.problems.join("; ").slice(0, 300)}`);
  const used = sources.filter((source) => checked.draft.cited.includes(source.n));
  return { ...checked.draft, sources: used.length ? used : sources.slice(0, 3), observations, queries, model, mode: "ollama" };
}
