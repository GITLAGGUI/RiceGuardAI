// Compose a draft advisory in one atomic call:
//   1. Read detection + farmer
//   2. Optionally fetch weather for the detection coords
//   3. Call ai-advisor (mode=field) for advice_text
//   4. Call ai-advisor (mode=sms)   for sms_text
//   5. INSERT into advisories (state='draft', ai_generated=true)
//
// Returns the new advisory id so the frontend can route to /admin/advisories/:id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { KB, diseaseContext, type Disease, type Severity } from "../_shared/knowledge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY") ?? "";
const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL") ?? "https://ollama.com/api";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL") ?? "gemma4:31b-cloud";
const OPENWEATHER_KEY = Deno.env.get("OPENWEATHER_API_KEY") ?? "";

interface Body {
  detection_id: string;
  farmer_id: string;
  /** If true, skip the AI call and use the canonical KB fallback. Default false. */
  skip_ai?: boolean;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  // Auth
  const auth = req.headers.get("authorization");
  if (!auth) return jsonResponse({ error: "missing authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return jsonResponse({ error: "invalid session" }, 401);

  // Admin role check
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: caller } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (caller?.role !== "admin") return jsonResponse({ error: "admin only" }, 403);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  const { detection_id, farmer_id, skip_ai = false } = body;
  if (!detection_id || !farmer_id)
    return jsonResponse({ error: "detection_id + farmer_id required" }, 400);

  // Load detection
  const { data: detection, error: detErr } = await admin
    .from("disease_detections")
    .select("id, disease, severity, lat, lng, location_text")
    .eq("id", detection_id)
    .single();
  if (detErr || !detection)
    return jsonResponse({ error: "detection not found" }, 404);

  // Load farmer profile (used for location string + later send-sms)
  const { data: farmer, error: fErr } = await admin
    .from("profiles")
    .select("id, full_name, barangay, municipality")
    .eq("id", farmer_id)
    .single();
  if (fErr || !farmer) return jsonResponse({ error: "farmer not found" }, 404);

  const disease = detection.disease as Disease;
  const severity = detection.severity as Severity;
  const location =
    detection.location_text ||
    [farmer.barangay, farmer.municipality].filter(Boolean).join(", ") ||
    "iyong bukid";

  // Optional: weather snapshot for prompt context
  let weatherSummary: string | null = null;
  if (OPENWEATHER_KEY && Number.isFinite(detection.lat)) {
    try {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${detection.lat}&lon=${detection.lng}&appid=${OPENWEATHER_KEY}&units=metric`,
        { signal: AbortSignal.timeout(5_000) }
      );
      if (res.ok) {
        const w = await res.json();
        const desc = w?.weather?.[0]?.description ?? "";
        const temp = Math.round(w?.main?.temp ?? 0);
        const hum = w?.main?.humidity ?? 0;
        weatherSummary = `${temp}°C, ${hum}% humidity, ${desc}`;
      }
    } catch (e) {
      console.warn("[generate-advisory] weather fetch failed", e);
    }
  }

  // Generate field advisory + SMS
  let advice_text: string;
  let sms_text: string;
  let model_used = "fallback";

  if (skip_ai || !OLLAMA_API_KEY) {
    advice_text = KB[disease].severity_actions[severity]
      .map((a, i) => `${i + 1}. ${a}`)
      .join("\n");
    sms_text = canonSms(disease, severity, location);
  } else {
    try {
      const [field, sms] = await Promise.all([
        callOllama("field", disease, severity, location, weatherSummary),
        callOllama("sms", disease, severity, location, weatherSummary),
      ]);
      advice_text = field;
      sms_text = sms;
      model_used = OLLAMA_MODEL;
    } catch (e) {
      console.error("[generate-advisory] ollama failed", e);
      advice_text = KB[disease].severity_actions[severity]
        .map((a, i) => `${i + 1}. ${a}`)
        .join("\n");
      sms_text = canonSms(disease, severity, location);
    }
  }

  // Insert advisory
  const { data: inserted, error: insErr } = await admin
    .from("advisories")
    .insert({
      detection_id,
      farmer_id,
      admin_id: userData.user.id,
      disease,
      severity,
      advice_text,
      sms_text,
      ai_generated: model_used !== "fallback",
      ai_model: model_used,
      state: "draft",
    })
    .select("id")
    .single();
  if (insErr || !inserted)
    return jsonResponse({ error: "insert failed", detail: insErr?.message }, 500);

  // Audit
  await admin.from("audit_events").insert({
    actor_id: userData.user.id,
    action: "advisory.generate",
    target_table: "advisories",
    target_id: inserted.id,
    meta: { detection_id, farmer_id, model: model_used },
  });

  return jsonResponse({
    advisory_id: inserted.id,
    model: model_used,
    advice_preview: advice_text.slice(0, 120),
  });
});

async function callOllama(
  mode: "field" | "sms",
  disease: Disease,
  severity: Severity,
  location: string,
  weather: string | null
): Promise<string> {
  const ctx = [diseaseContext(disease, severity), `LOKASYON: ${location}`];
  if (weather) ctx.push(`PANAHON: ${weather}`);

  const sys =
    mode === "field"
      ? "Magsulat ng 4–5 numbered Tagalog steps na imperative voice, base sa knowledge base. Walang AI disclaimer, walang emoji, plain text."
      : "Magsulat ng MAIKLI na SMS (max 240 chars) sa Tagalog para sa magsasaka. Walang numbered list, plain text.";

  const res = await fetch(`${OLLAMA_BASE_URL}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OLLAMA_API_KEY}`,
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: ctx.join("\n") },
      ],
      stream: false,
      options: {
        temperature: mode === "field" ? 0.3 : 0.45,
        num_predict: mode === "field" ? 520 : 320,
        top_p: 0.9,
      },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  let text = (data?.message?.content ?? data?.response ?? "").trim();
  if (mode === "sms") {
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 280) text = text.slice(0, 277) + "...";
  }
  return text || "—";
}

function canonSms(disease: Disease, severity: Severity, location: string): string {
  const p = KB[disease];
  const action = p.severity_actions[severity][0];
  const msg = `[RiceGuard] ALERTO: ${p.name_tl} sa ${location} (${severity}). ${action} Sundin ang PhilRice guidelines.`;
  return msg.length > 280 ? msg.slice(0, 277) + "..." : msg;
}
