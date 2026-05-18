// AI advisory generator via Ollama Cloud (gemma4:31b-cloud).
//
// Two modes:
//   - "field": 4-5 numbered steps, ~520 tokens, Tagalog field advisory
//   - "sms":   2-3 short lines, hard-trimmed to 280 chars, SMS-ready
//
// Uses the structured knowledge base in _shared/knowledge.ts so the model never
// hallucinates dose or chemical names — those facts come from the KB, the model
// just composes the Tagalog around them.

import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/ratelimit.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { KB, diseaseContext, type Disease, type Severity } from "../_shared/knowledge.ts";

const OLLAMA_API_KEY = Deno.env.get("OLLAMA_API_KEY") ?? "";
const OLLAMA_BASE_URL = Deno.env.get("OLLAMA_BASE_URL") ?? "https://ollama.com/api";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL") ?? "gemma4:31b-cloud";
const OLLAMA_TIMEOUT_MS = 15_000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

type Mode = "field" | "sms";

interface Body {
  mode: Mode;
  disease: Disease;
  severity: Severity;
  location?: string;
  weather?: string;
}

const FIELD_SYSTEM_PROMPT = `Ikaw ay isang rice expert para sa Region II (Isabela at Cagayan), Pilipinas, na kasanayan sa PhilRice + DA Region II guidelines.
Magsulat ng payo sa MALINAW na Tagalog/Taglish. Maging praktikal — para sa smallholder farmer na hindi tech-savvy.

RULES (mahigpit):
- Output: EKSAKTONG 4–5 numbered steps na nasa imperative voice.
- Sundin ang REKOMENDADONG AKSYON sa context — wag mag-improvise ng chemical o dose.
- Banggitin ang specific chemical at dose mula sa CHEMICAL OPTIONS — hindi generic.
- Huwag banggitin ang weather kung walang ibinigay na weather context.
- Iwasan ang teknikal na termino; gamit ang halimbawa ng farmer (e.g., "tabo" hindi "10 mL").
- Wag banggitin ang pagiging AI o LLM.
- Wag mag-disclaimer; basta i-deliver lang ang aksyon.
- Walang emoji. Walang bold/italic — plain text.`;

const SMS_SYSTEM_PROMPT = `Ikaw ay isang rice expert. Magsulat ng MAIKLI na SMS para sa magsasaka.

FORMAT:
[RiceGuard] ALERTO: <sakit> sa <lokasyon>.
<isa-dalawang aksyon — imperative, max 2 sentence>
Severity: <low/medium/high>.

RULES:
- Maximum 240 characters lahat-lahat (mag-iiwan ng space para sa overhead).
- 2–3 maikling linya.
- Walang numbered list — flow lang.
- Plain text — walang emoji.
- Practical, "Gawin mo ito ngayon" energy.
- Wag mag-disclaimer.`;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization");
  if (!auth) return jsonResponse({ error: "missing authorization" }, 401);

  // Verify session
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return jsonResponse({ error: "invalid session" }, 401);

  const ok = await rateLimit(`ai:${userData.user.id}`, 30);
  if (!ok) return jsonResponse({ error: "rate limit (30/hour/user)" }, 429);

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  const { mode, disease, severity, location, weather } = payload;
  if (!mode || !disease || !severity)
    return jsonResponse({ error: "mode + disease + severity required" }, 400);
  if (!KB[disease]) return jsonResponse({ error: "unknown disease" }, 400);
  if (!["low", "medium", "high"].includes(severity))
    return jsonResponse({ error: "unknown severity" }, 400);

  const sysPrompt = mode === "field" ? FIELD_SYSTEM_PROMPT : SMS_SYSTEM_PROMPT;
  const kbContext = diseaseContext(disease, severity);
  const ctx = [
    kbContext,
    location ? `\nLOKASYON: ${location}` : "",
    weather ? `\nPANAHON NGAYON: ${weather}` : "",
  ].join("");

  const userPrompt =
    mode === "field"
      ? `Magsulat ng 4–5 numbered steps. Konteksto:\n${ctx}`
      : `Magsulat ng SMS na 2–3 maikling linya (max 240 chars). Konteksto:\n${ctx}`;

  if (!OLLAMA_API_KEY) {
    return jsonResponse({
      text: fallbackText(mode, disease, severity, location),
      tokens: 0,
      model: "fallback",
      warning: "OLLAMA_API_KEY not set — using KB fallback",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OLLAMA_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        options: {
          temperature: mode === "field" ? 0.3 : 0.45,
          num_predict: mode === "field" ? 520 : 320,
          top_p: 0.9,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[ai-advisor] ollama error", res.status, errText);
      return jsonResponse({
        text: fallbackText(mode, disease, severity, location),
        tokens: 0,
        model: "fallback",
        warning: `ollama ${res.status}: ${errText.slice(0, 200)}`,
      });
    }

    const data = await res.json();
    let text = (data?.message?.content ?? data?.response ?? "").trim();
    if (mode === "sms") {
      text = text.replace(/\s+/g, " ").trim();
      if (text.length > 280) text = text.slice(0, 277) + "...";
    }
    if (!text) text = fallbackText(mode, disease, severity, location);

    return jsonResponse({
      text,
      tokens: data?.eval_count ?? 0,
      model: OLLAMA_MODEL,
    });
  } catch (err) {
    console.error("[ai-advisor] error", err);
    return jsonResponse({
      text: fallbackText(mode, disease, severity, location),
      tokens: 0,
      model: "fallback",
      warning: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
});

function fallbackText(
  mode: Mode,
  disease: Disease,
  severity: Severity,
  location?: string
): string {
  const p = KB[disease];
  if (mode === "sms") {
    const action = p.severity_actions[severity][0];
    const loc = location ? ` sa ${location}` : "";
    const msg = `[RiceGuard] ALERTO: ${p.name_tl}${loc} (${severity}). ${action} Sundin ang PhilRice guidelines.`;
    return msg.length > 280 ? msg.slice(0, 277) + "..." : msg;
  }
  // Field mode — use the canonical KB action list directly
  return p.severity_actions[severity].map((a, i) => `${i + 1}. ${a}`).join("\n");
}
