import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createOpenAiAdvisory, type ResearchCandidate } from "../_shared/openai-advisory.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const origin = Deno.env.get("APP_ORIGIN") || "http://localhost:5173";
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const OLLAMA_KEY = Deno.env.get("OLLAMA_API_KEY");
const OLLAMA_URL = Deno.env.get("OLLAMA_BASE_URL") || "https://ollama.com/api";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL") || "gemma4:31b-cloud";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5.6";
const OPENAI_ENABLED = Deno.env.get("ADVISORY_OPENAI_ENABLED") === "true";
const WEB_RESEARCH_ENABLED = Deno.env.get("ADVISORY_WEB_RESEARCH_ENABLED") === "true";

// Reuse the deployed, cached weather endpoint and send rounded coordinates only.
// If any part fails, return null; a draft must never invent current field weather.
async function approximateWeather(lat: unknown, lng: unknown): Promise<Record<string, unknown> | null> {
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  const safeLat = Math.round(Number(lat) * 100) / 100;
  const safeLng = Math.round(Number(lng) * 100) / 100;
  if (Math.abs(safeLat) > 90 || Math.abs(safeLng) > 180) return null;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return null;
  try {
    const response = await fetch(
      url + "/functions/v1/weather?lat=" + encodeURIComponent(safeLat) + "&lng=" + encodeURIComponent(safeLng),
      { headers: { Authorization: "Bearer " + key, apikey: key }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const now = Date.now();
    const obs = Number(payload.current?.dt);
    const current = Number.isFinite(obs) && obs * 1000 <= now + 600_000 && obs * 1000 >= now - 3 * 3600_000
      ? {
          observed_at: new Date(obs * 1000).toISOString(),
          temperature_c: payload.current.main?.temp ?? null,
          humidity_pct: payload.current.main?.humidity ?? null,
          wind_m_s: payload.current.wind?.speed ?? null,
          rain_1h_mm: payload.current.rain?.["1h"] ?? null,
        }
      : null;
    const forecast = (Array.isArray(payload.forecast5) ? payload.forecast5 : [])
      .filter((step: { dt?: number }) => Number.isFinite(step.dt) && Number(step.dt) * 1000 > now && Number(step.dt) * 1000 <= now + 72 * 3600_000)
      .slice(0, 24)
      .map((step: { dt: number; main?: { temp?: number; humidity?: number }; wind?: { speed?: number }; pop?: number; rain?: { "3h"?: number } }) => ({
        forecast_at: new Date(step.dt * 1000).toISOString(),
        temperature_c: step.main?.temp ?? null,
        humidity_pct: step.main?.humidity ?? null,
        wind_m_s: step.wind?.speed ?? null,
        precipitation_probability: step.pop ?? null,
        rain_3h_mm: step.rain?.["3h"] ?? null,
      }));
    if (!current && !forecast.length) return null;
    return {
      provider: "OpenWeather", spatial_limit: "Rounded nearby weather point, not a field sensor",
      units: "metric", retrieved_at: new Date().toISOString(),
      current_observation: current, forecast_3hour_intervals: forecast,
      disease_risk_calibrated: false,
    };
  } catch {
    return null;
  }
}
const assuranceLevel = (token: string) => {
  try {
    const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "="))).aal as string;
  } catch { return null; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== origin) return reply({ error: "Origin not allowed" }, 403);
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return reply({ error: "Authentication required" }, 401);
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) return reply({ error: "Invalid session" }, 401);
  const profile = await admin.from("profiles").select("role,is_active").eq("id", auth.data.user.id).single();
  if (profile.data?.role !== "admin" || !profile.data?.is_active) return reply({ error: "Active admin role required" }, 403);
  if (assuranceLevel(token) !== "aal2") return reply({ error: "Administrator MFA verification required" }, 403);

  try {
    const input = await req.json();
    const bulletinId = String(input.bulletin_id || "");
    const bulletin = await admin.from("rg_bulletins").select("id,survey_id,disease,location,result_revision,advisory_revision,status").eq("id", bulletinId).single();
    if (bulletin.error || !bulletin.data) return reply({ error: "Advisory draft not found" }, 404);
    if (bulletin.data.status === "published") return reply({ error: "Create a correction revision before regenerating published advice" }, 409);
    const survey = await admin.from("rg_surveys")
      .select("status,approved_result_revision,lat,lng").eq("id", bulletin.data.survey_id).single();
    if (survey.error || !survey.data || survey.data.status !== "Reviewed" ||
        survey.data.approved_result_revision !== bulletin.data.result_revision) {
      return reply({ error: "Approve the exact reviewed survey result before generating an advisory" }, 409);
    }
    const result = await admin.from("rg_result_revisions").select("manifest,blb_coverage,brown_spot_affected_leaf_coverage,severity_status,severity_label,warnings").eq("survey_id", bulletin.data.survey_id).eq("revision", bulletin.data.result_revision).single();
    if (result.error || !result.data) return reply({ error: "Validated result revision not found" }, 409);
    const sources = await admin.from("rg_advisory_sources").select("id,title,version,guidance,source_reference").eq("disease", bulletin.data.disease).eq("active", true).order("approved_at", { ascending: false });
    if (sources.error) throw new Error(sources.error.message);
    if (!sources.data?.length) return reply({ error: "Agriculture-specialist guidance must be reviewed and activated before an advisory can be drafted" }, 409);

    const facts = {
      disease: bulletin.data.disease,
      approximate_location: bulletin.data.location,
      result_revision: bulletin.data.result_revision,
      measurements: bulletin.data.disease === "BLB"
        ? { name: "predicted disease-region coverage", value: result.data.blb_coverage }
        : { name: "predicted affected-leaf coverage", value: result.data.brown_spot_affected_leaf_coverage },
      severity: result.data.severity_status === "calibrated" ? result.data.severity_label : "Severity not yet calibrated",
      quality_warnings: result.data.warnings,
    };
    const approved = sources.data.map((source) => ({ id: source.id, title: source.title, version: source.version, reference: source.source_reference, guidance: source.guidance }));

    let draft: { summary: string; recommended_actions: string[]; limitations: string[]; source_ids: string[] } | null = null;
    let mode: "openai" | "ollama" | "expert_template" = "expert_template";
    let researchCandidates: ResearchCandidate[] = [];
    let researchStatus = "disabled";
    let openAiUnavailable = false;
    let weather: Record<string, unknown> | null = null;
    if (OPENAI_ENABLED && OPENAI_KEY) {
      try {
        weather = await approximateWeather(survey.data.lat, survey.data.lng);
        const generated = await createOpenAiAdvisory({
          apiKey: OPENAI_KEY,
          model: OPENAI_MODEL,
          facts,
          guidance: approved,
          weather,
          enableWebResearch: WEB_RESEARCH_ENABLED,
        });
        draft = {
          summary: generated.summary,
          recommended_actions: generated.recommended_actions,
          limitations: generated.limitations,
          source_ids: generated.source_ids,
        };
        researchCandidates = generated.research_candidates;
        researchStatus = generated.research_status;
        mode = "openai";
      } catch {
        // Preserve existing reviewed-guidance flow if the optional provider is unavailable.
        // Never silently claim that fresh weather or recent research was verified.
        openAiUnavailable = true;
        weather = null;
      }
    }
    if (!draft && OLLAMA_KEY) {
      const response = await fetch(`${OLLAMA_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          format: "json",
          options: { temperature: 0.15, top_p: 0.85, num_predict: 900 },
          messages: [
            { role: "system", content: "Create a cautious Filipino/English rice field advisory using only the supplied approved guidance and validated findings. Never invent a diagnosis, pesticide, dosage, severity, source, or field-wide claim. Return JSON only with keys summary (string), recommended_actions (array of strings), limitations (array of strings), source_ids (array chosen only from supplied source ids)." },
            { role: "user", content: JSON.stringify({ validated_findings: facts, approved_guidance: approved }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Advisory provider returned ${response.status}`);
      const payload = await response.json();
      const raw = String(payload?.message?.content || payload?.response || "").replace(/^```json|```$/g, "").trim();
      draft = JSON.parse(raw);
      mode = "ollama";
    }
    if (!draft) {
      const template = sources.data[0].guidance as Record<string, unknown>;
      draft = {
        summary: String(template.summary || `${bulletin.data.disease} model candidates require field verification.`),
        recommended_actions: Array.isArray(template.recommended_actions) ? template.recommended_actions.map(String) : [],
        limitations: Array.isArray(template.limitations) ? template.limitations.map(String) : ["Visual model output does not independently confirm a diagnosis."],
        source_ids: [sources.data[0].id],
      };
      mode = "expert_template";
    }
    if (openAiUnavailable) {
      draft.limitations.push("OpenAI provider unavailable; this draft uses approved guidance only and does not assert current web research or field weather.");
    }
    if (!draft.summary?.trim() || !Array.isArray(draft.recommended_actions) || !draft.recommended_actions.length || !Array.isArray(draft.limitations))
      throw new Error("Advisory provider returned an invalid structured draft");
    const allowedIds = new Set(sources.data.map((source) => source.id));
    const sourceIds = [...new Set((draft.source_ids || []).filter((id) => allowedIds.has(id)))];
    if (!sourceIds.length) throw new Error("Advisory draft did not retain an approved source reference");
    const nextRevision = bulletin.data.advisory_revision + 1;
    const updated = await admin.from("rg_bulletins").update({
      body: draft.summary.trim(),
      action: draft.recommended_actions.map((item, index) => `${index + 1}. ${String(item).trim()}`).join("\n"),
      limitations: draft.limitations.map(String).join("\n"),
      advisory_source_ids: sourceIds,
      advisory_revision: nextRevision,
      recipient_preview_hash: null,
      reviewer: null,
      reviewer_id: null,
      updated_at: new Date().toISOString(),
    }).eq("id", bulletinId).eq("advisory_revision", bulletin.data.advisory_revision).select("id").maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    if (!updated.data) return reply({ error: "Advisory changed during generation; review the latest revision and retry" }, 409);
    await admin.from("rg_events").insert({
      kind: "advisory-draft-generated",
      entity_id: bulletinId,
      actor_id: auth.data.user.id,
      detail: {
        mode,
        model: mode === "ollama" ? OLLAMA_MODEL : mode === "openai" ? OPENAI_MODEL : null,
        result_revision: bulletin.data.result_revision,
        advisory_revision: nextRevision,
        source_ids: sourceIds,
        weather_observed_at: (weather?.current_observation as { observed_at?: string } | undefined)?.observed_at || null,
        research_status: researchStatus,
        research_candidates: researchCandidates,
        provider_fallback: openAiUnavailable,
      },
    });
    return reply({ bulletin_id: bulletinId, advisory_revision: nextRevision, generation_mode: mode });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message.slice(0, 400) : "Advisory generation failed" }, 400);
  }
});
