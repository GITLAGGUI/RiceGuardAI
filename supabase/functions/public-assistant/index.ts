import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const allowedOrigin = Deno.env.get("APP_ORIGIN") || "http://localhost:5173";
const baseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  Vary: "Origin",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: baseHeaders });
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map((part) => part.toString(16).padStart(2, "0")).join("");

type AssistantAnswer = {
  intro: string;
  sections: Array<{ heading?: string; body?: string; bullets?: string[] }>;
  closing?: string;
};

function cleanAnswer(value: unknown): AssistantAnswer {
  const raw = value as Record<string, unknown>;
  const intro = String(raw?.intro || "Narito ang maikling sagot.").slice(0, 500);
  const sections = Array.isArray(raw?.sections) ? raw.sections.slice(0, 5).map((entry) => {
    const section = entry as Record<string, unknown>;
    return {
      heading: section.heading ? String(section.heading).slice(0, 120) : undefined,
      body: section.body ? String(section.body).slice(0, 900) : undefined,
      bullets: Array.isArray(section.bullets) ? section.bullets.slice(0, 6).map((item) => String(item).slice(0, 300)) : undefined,
    };
  }).filter((section) => section.heading || section.body || section.bullets?.length) : [];
  if (!sections.length) sections.push({ body: "Pakilinaw ang tanong para mas makatulong ako." });
  return { intro, sections, closing: raw?.closing ? String(raw.closing).slice(0, 500) : undefined };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (req.headers.get("origin") && req.headers.get("origin") !== allowedOrigin) return reply({ error: "Origin not allowed" }, 403);
  const key = Deno.env.get("OLLAMA_API_KEY");
  if (!key) return reply({ error: "Hindi pa available ang RiceGuardAI Assistant." }, 503);

  try {
    const requestText = await req.text();
    if (requestText.length > 12_000) return reply({ error: "Masyadong mahaba ang mensahe." }, 413);
    const payload = JSON.parse(requestText);
    const message = String(payload.message || "").trim();
    if (!message || message.length > 600) return reply({ error: "Maglagay ng mensaheng hanggang 600 characters." }, 400);

    // Keep only a one-way request fingerprint. Raw IP addresses are never stored.
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const fingerprint = await hash(`${Deno.env.get("CRON_SECRET") || "riceguard"}:${forwarded}`);
    const windowStart = new Date(Math.floor(Date.now() / 600_000) * 600_000).toISOString();
    const rateKey = `assistant:${fingerprint}`;
    const current = await db.from("rate_limits").select("count").eq("key", rateKey).eq("window_start", windowStart).maybeSingle();
    if (current.error) throw new Error("Rate limit check failed");
    const count = Number(current.data?.count || 0);
    if (count >= 15) return reply({ error: "Marami nang tanong mula sa device na ito. Subukan muli pagkalipas ng ilang minuto." }, 429);
    const limited = await db.from("rate_limits").upsert({ key: rateKey, window_start: windowStart, count: count + 1 }, { onConflict: "key,window_start" });
    if (limited.error) throw new Error("Rate limit update failed");

    const history = Array.isArray(payload.conversation) ? payload.conversation.slice(-6).flatMap((entry: unknown) => {
      const item = entry as Record<string, unknown>;
      const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
      const content = String(item.content || "").slice(0, 800);
      return role && content ? [{ role, content }] : [];
    }) : [];
    const response = await fetch(`${Deno.env.get("OLLAMA_BASE_URL") || "https://ollama.com/api"}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        model: "gemma4:31b-cloud",
        stream: false,
        format: "json",
        options: { temperature: 0.25, top_p: 0.85, num_predict: 850 },
        messages: [
          {
            role: "system",
            content: "Ikaw ang RiceGuardAI Assistant para sa mga magsasaka sa Region II, Philippines. Sumagot sa natural, simple, at magalang na Tagalog o Taglish ayon sa wika ng user. Saklaw: RiceGuardAI Field Bulletin, Monitoring Map, SMS alerts, drone-image workflow, Bacterial Leaf Blight (BLB), at Brown Spot. Huwag mag-imbento ng diagnosis, kasalukuyang field result, severity, pesticide, dosage, o lokasyon. Ipaliwanag na reviewed advisories lamang ang official at agriculture specialist ang dapat kumumpirma. Huwag gumamit ng Markdown, asterisks, hash headings, o raw formatting characters. Return valid JSON only: {\"intro\":string,\"sections\":[{\"heading\":string optional,\"body\":string optional,\"bullets\":[string] optional}],\"closing\":string optional}. Maikli, malinaw, farmer-friendly.",
          },
          ...history,
          { role: "user", content: message },
        ],
      }),
    });
    if (!response.ok) return reply({ error: "Hindi makakonekta sa assistant provider ngayon." }, 502);
    const provider = await response.json();
    const text = String(provider?.message?.content || provider?.response || "").replace(/^```json\s*|\s*```$/g, "").trim();
    return reply({ answer: cleanAnswer(JSON.parse(text)), model: "gemma4:31b-cloud" });
  } catch (error) {
    console.error("[public-assistant]", error instanceof Error ? error.message : error);
    return reply({ error: "Hindi makasagot ang assistant ngayon. Pakisubukan muli." }, 500);
  }
});
