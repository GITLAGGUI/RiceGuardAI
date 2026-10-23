import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { advisoryFacts, draftFromApprovedGuidance, guidanceForFieldContext, reviewedDiseaseScope, validateAdvisoryDraft, type AdvisoryDraft, type AdvisorySource } from "../_shared/advisoryEvidence.ts";
import { normalizeWeatherContext } from "../_shared/weatherContext.ts";
import { createOpenAiAdvisory, type ResearchCandidate } from "../_shared/openai-advisory.ts";
import { awsSettings, signedAwsPost } from "../_shared/awsSigV4.ts";
import { severitySuggestionInstruction, validatedSeveritySuggestions } from "../_shared/severityRecommendation.ts";

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
const WEATHER_CONTEXT_ENABLED = Deno.env.get("ADVISORY_WEATHER_CONTEXT_ENABLED") === "true";
const OPENAI_ENABLED = Deno.env.get("ADVISORY_OPENAI_ENABLED") === "true" &&
  Deno.env.get("ADVISORY_OPENAI_SPEND_APPROVED") === "true";
const WEB_RESEARCH_ENABLED = Deno.env.get("ADVISORY_WEB_RESEARCH_ENABLED") === "true";
const VISION_ENABLED = Deno.env.get("ADVISORY_VISION_ENABLED") === "true";
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
};
async function approvedVisionImages(surveyId: string, mediaApproved: boolean) {
  if (!VISION_ENABLED || !mediaApproved) return [] as string[];
  try {
    const job = await admin.from("rg_processing_jobs").select("id,run_id,provider,result_manifest")
      .eq("survey_id", surveyId).in("provider", ["aws", "kaggle_yolo26"]).eq("status", "Reviewed")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (job.error || !job.data || job.data.result_manifest?.schema_version !== "riceguard.result.v2") return [];
    const assets = (job.data.result_manifest.assets || []) as Array<Record<string, unknown>>;
    const paths = assets.filter((asset) => asset.kind === "image").flatMap((asset) => {
      const review = asset.review_paths as Record<string, unknown> | undefined;
      const path = review?.original || review?.combined;
      return typeof path === "string" ? [path] : [];
    }).slice(0, 1);
    if (!paths.length) return [];
    const signed = await signedAwsPost(JSON.stringify({
      action: job.data.provider === "aws" ? "signed-review" : "signed-pinned-review",
      job_id: job.data.id, run_id: job.data.run_id, paths,
    }), awsSettings());
    if (!signed.ok) return [];
    const urls = await signed.json() as Record<string, string>;
    const response = await fetch(urls[paths[0]], { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return [];
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 3 || bytes.length > 6_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return [];
    return [`data:image/jpeg;base64,${toBase64(bytes)}`];
  } catch {
    // Advisory drafting must remain available when temporary media signing,
    // download, or vision preparation is unavailable.
    return [];
  }
}
async function approvedNearbyWeather(lat: unknown, lng: unknown, locationApproved: boolean) {
  if (!WEATHER_CONTEXT_ENABLED || !locationApproved || typeof lat !== "number" || typeof lng !== "number" ||
    !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return null;
  try {
    const approximateLat = Math.round(lat * 100) / 100;
    const approximateLng = Math.round(lng * 100) / 100;
    const response = await fetch(`${url}/functions/v1/weather?lat=${encodeURIComponent(approximateLat)}&lng=${encodeURIComponent(approximateLng)}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return normalizeWeatherContext(await response.json(), Date.now());
  } catch { return null; }
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
    const modeRequest = input.mode === "refine" ? "refine" : "generate";
    const bulletin = await admin.from("rg_bulletins").select("id,survey_id,disease,diseases,location,result_revision,advisory_revision,status,public_location_approved,media_approved,body,action").eq("id", bulletinId).is("archived_at", null).single();
    if (bulletin.error || !bulletin.data) return reply({ error: "Advisory draft not found" }, 404);
    if (bulletin.data.status !== "draft") return reply({ error: "Create a correction revision before regenerating published advice" }, 409);
    const survey = await admin.from("rg_surveys").select("status,approved_result_revision,lat,lng,crop_stage,field_conditions").eq("id", bulletin.data.survey_id).single();
    if (survey.error || survey.data?.status !== "Reviewed" || survey.data.approved_result_revision !== bulletin.data.result_revision)
      return reply({ error: "Approve the exact survey result before generating an advisory" }, 409);
    const result = await admin.from("rg_result_revisions").select("manifest,blb_coverage,brown_spot_affected_leaf_coverage,severity_status,severity_label,warnings").eq("survey_id", bulletin.data.survey_id).eq("revision", bulletin.data.result_revision).single();
    if (result.error || !result.data) return reply({ error: "Validated result revision not found" }, 409);
    const diseases = reviewedDiseaseScope(bulletin.data, result.data);
    const sources = await admin.from("rg_advisory_sources").select("id,disease,title,version,guidance,source_reference").in("disease", diseases).eq("active", true).order("approved_at", { ascending: false });
    if (sources.error) throw new Error(sources.error.message);
    const fieldContext = { crop_stage: survey.data.crop_stage, field_conditions: survey.data.field_conditions };
    const approvedSources = guidanceForFieldContext((sources.data || []).map((source) => ({
      id: source.id, disease: source.disease, title: source.title, version: source.version,
      guidance: source.guidance, reference: source.source_reference,
    })) as AdvisorySource[], diseases, fieldContext);

    const facts = { ...advisoryFacts(bulletin.data, result.data, fieldContext),
      ...(modeRequest === "refine" ? { staff_edited_draft: { summary: bulletin.data.body, recommended_actions: bulletin.data.action },
        refinement_instruction: "Improve structure, clarity, specificity, and readability without dropping supported staff facts or adding unsupported claims." } : {}) };
    const approved = approvedSources.map((source) => ({ id: source.id, disease: source.disease, title: source.title, version: source.version, reference: source.reference, guidance: source.guidance }));
    const weather = await approvedNearbyWeather(survey.data.lat, survey.data.lng, bulletin.data.public_location_approved === true);
    const images = await approvedVisionImages(bulletin.data.survey_id, bulletin.data.media_approved === true);

    let draft: AdvisoryDraft | null = null;
    let mode: "openai" | "ollama" | "expert_template" = "expert_template";
    let researchCandidates: ResearchCandidate[] = [];
    let researchStatus = "disabled";
    let openAiUnavailable = false;
    let ollamaUnavailable = false;
    let visionImageCount = 0;
    let severitySuggestions = validatedSeveritySuggestions(null, diseases, false);
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const openAiModel = Deno.env.get("OPENAI_MODEL");
    if (OPENAI_ENABLED && openAiKey && openAiModel) {
      try {
        const generated = await createOpenAiAdvisory({ apiKey: openAiKey, model: openAiModel,
          facts, diseases, guidance: approvedSources, weather, images, webResearch: WEB_RESEARCH_ENABLED });
        draft = validateAdvisoryDraft(generated, approvedSources, diseases);
        severitySuggestions = generated.severity_recommendations;
        visionImageCount = images.length;
        researchCandidates = generated.research_candidates;
        researchStatus = generated.research_status;
        mode = "openai";
      } catch { openAiUnavailable = true; }
    }
    if (!draft && OLLAMA_KEY) {
      const requestOllama = async (requestImages: string[]) => {
        const response = await fetch(`${OLLAMA_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OLLAMA_KEY}` },
        signal: AbortSignal.timeout(requestImages.length ? 55_000 : 40_000),
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          format: "json",
          options: { temperature: 0.15, top_p: 0.85, num_predict: 1500 },
          messages: [
            { role: "system", content: severitySuggestionInstruction + " Return severity_recommendations as an array of {disease,category,reason} in addition to the advisory keys." },
            { role: "system", content: "Create a cautious Filipino/English rice field advisory for every accepted disease using only the supplied approved guidance, reviewed model findings, operator-reviewed field context, and nearby weather. Prioritize actions that fit this specific crop stage and field condition; do not repeat generic actions or mention flooding, nutrient stress, lodging, pests, or crop stage unless supplied. Each accepted disease must retain at least one approved source ID. Nearby weather is context, not a disease diagnosis or calibrated disease-risk score; distinguish observations from forecasts and omit missing values. Never invent a diagnosis, pesticide, dosage, calibrated severity measurement, source, or field-wide claim. Whole-leaf and disease-region masks are not lesion-area severity. Return JSON only with keys summary (string), recommended_actions (array of strings), limitations (array of strings), source_ids (array chosen only from supplied source ids), and the separate severity_recommendations array specified next." },
            { role: "user", content: JSON.stringify({ reviewed_findings: facts, approved_guidance: approved, nearby_weather: weather,
              image_instruction: requestImages.length ? "Use the attached original review image for visible field context and the separate qualitative severity suggestions. Never override accepted diseases or infer calibrated percentages or whole-field severity." : "No review image was supplied. Severity recommendations must be unknown." }),
              ...(requestImages.length ? { images: requestImages.map((item) => item.replace(/^data:image\/jpeg;base64,/, "")) } : {}) },
          ],
        }),
        });
        if (!response.ok) throw new Error(`Advisory provider returned ${response.status}`);
        const payload = await response.json();
        const raw = String(payload?.message?.content || payload?.response || "").replace(/^```json|```$/g, "").trim();
        const parsed = JSON.parse(raw);
        const validated = validateAdvisoryDraft(parsed, approvedSources, diseases);
        severitySuggestions = validatedSeveritySuggestions(parsed.severity_recommendations, diseases, requestImages.length > 0);
        return validated;
      };
      try {
        draft = await requestOllama(images);
        visionImageCount = images.length;
        mode = "ollama";
      } catch {
        try {
          draft = await requestOllama([]);
          visionImageCount = 0;
          mode = "ollama";
        } catch { ollamaUnavailable = true; }
      }
    }
    if (!draft) {
      if (modeRequest === "refine") return reply({ error: "The AI provider is unavailable, so the edited draft was left unchanged." }, 503);
      draft = validateAdvisoryDraft(draftFromApprovedGuidance(approvedSources, diseases, weather, fieldContext), approvedSources, diseases);
      mode = "expert_template";
    }
    if (openAiUnavailable && draft.limitations.length < 8)
      draft.limitations.push("OpenAI research or drafting was unavailable; this draft does not claim fresh web evidence.");
    if (ollamaUnavailable && draft.limitations.length < 8)
      draft.limitations.push("Cloud advisory drafting was unavailable; approved-source template guidance was used.");
    const sourceIds = draft.source_ids;
    const nextRevision = bulletin.data.advisory_revision + 1;
    const updated = await admin.from("rg_bulletins").update({
      body: draft.summary.trim(),
      action: draft.recommended_actions.map((item, index) => `${index + 1}. ${String(item).trim()}`).join("\n"),
      limitations: draft.limitations.map(String).join("\n"),
      advisory_source_ids: sourceIds,
      severity_recommendation: { basis: "ai_visual_suggestion", model_calibrated: false, scope: "attached_review_image_not_whole_field",
        result_revision: bulletin.data.result_revision, advisory_revision: nextRevision, image_count: visionImageCount,
        provider: mode, generated_at: new Date().toISOString(), diseases: severitySuggestions },
      advisory_revision: nextRevision,
      recipient_preview_hash: null,
      reviewer: null,
      reviewer_id: null,
      context_review_required: false,
      updated_at: new Date().toISOString(),
    }).eq("id", bulletinId).eq("status", "draft")
      .eq("result_revision", bulletin.data.result_revision)
      .eq("advisory_revision", bulletin.data.advisory_revision).select("id").maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    if (!updated.data) return reply({ error: "The advisory changed during generation; review the latest revision and retry" }, 409);
    await admin.from("rg_events").insert({
      kind: "advisory-draft-generated",
      entity_id: bulletinId,
      actor_id: auth.data.user.id,
      detail: { mode, model: mode === "ollama" ? OLLAMA_MODEL : mode === "openai" ? openAiModel : null,
        result_revision: bulletin.data.result_revision, advisory_revision: nextRevision, source_ids: sourceIds,
        weather_observed_at: (weather?.observation as { observed_at?: string } | null)?.observed_at || null,
        weather_status: weather ? "nearby_context" : "unavailable_or_disabled",
        research_status: researchStatus, research_candidates: researchCandidates,
        provider_fallback: { openai: openAiUnavailable, ollama: ollamaUnavailable },
        request_mode: modeRequest, vision_used: visionImageCount > 0, vision_image_count: visionImageCount },
    });
    return reply({ bulletin_id: bulletinId, advisory_revision: nextRevision, generation_mode: mode,
      vision_used: visionImageCount > 0, vision_image_count: visionImageCount });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message.slice(0, 400) : "Advisory generation failed" }, 400);
  }
});
