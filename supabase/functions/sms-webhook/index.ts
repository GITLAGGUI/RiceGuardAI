import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function signature(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < b.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function equalText(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < b.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function normalizePhone(value: unknown) {
  const phone = String(value || "").replace(/[\s()-]/g, "");
  const international = phone.startsWith("09") ? `+63${phone.slice(1)}` :
    phone.startsWith("639") ? `+${phone}` : phone;
  return /^\+639\d{9}$/.test(international) ? international : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("SMS_GATE_WEBHOOK_SECRET");
  const callbackToken = Deno.env.get("SMS_GATE_WEBHOOK_TOKEN");
  if (!secret && !callbackToken) return json({ error: "Webhook is not configured" }, 503);
  const raw = await req.text();
  if (raw.length > 20_000) return json({ error: "Payload too large" }, 413);
  const timestamp = req.headers.get("x-timestamp") || "";
  const signatureHeader = req.headers.get("x-signature") || "";
  const seconds = Number(timestamp);
  const signatureIsValid = Boolean(secret) && /^\d{10}$/.test(timestamp) &&
    Math.abs(Date.now() / 1000 - seconds) <= 300 &&
    equalHex(signatureHeader, await signature(secret!, raw + timestamp));
  // SMS Gate Cloud does not expose a configurable webhook signing key. A
  // high-entropy callback token keeps Cloud callbacks private, while the HMAC
  // path above remains available for self-hosted/local gateway callbacks.
  const suppliedToken = new URL(req.url).searchParams.get("token") || "";
  const tokenIsValid = Boolean(callbackToken) && equalText(suppliedToken, callbackToken!);
  if (!signatureIsValid && !tokenIsValid) {
    return json({ error: "Invalid signature" }, 401);
  }

  let event: { id?: string; event?: string; payload?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!event.id || !/^[\w-]{8,100}$/.test(event.id) || !event.payload || !event.event) {
    return json({ error: "Invalid event" }, 400);
  }
  const allowed = ["sms:received", "sms:sent", "sms:delivered", "sms:failed"];
  if (!allowed.includes(event.event)) return json({ accepted: true });
  const externalId = `sms-gate:${event.id}`;
  const previous = await db.from("rg_events").select("id").eq("external_id", externalId).maybeSingle();
  if (previous.error) return json({ error: "Could not check event" }, 500);
  if (previous.data) return json({ accepted: true, duplicate: true });
  async function recordEvent() {
    return db.from("rg_events").insert({
      external_id: externalId,
      kind: event.event,
      entity_id: String(event.payload?.messageId || "").slice(0, 100),
    });
  }

  if (event.event === "sms:received") {
    const phone = normalizePhone(event.payload.sender);
    const text = String(event.payload.message || "").trim().toUpperCase();
    if (phone && ["STOP", "UNSUBSCRIBE", "CANCEL"].includes(text)) {
      const contact = await db.from("rg_contacts").update({ consent: false })
        .eq("phone", phone).select("id").maybeSingle();
      if (contact.error) return json({ error: "Could not process opt-out" }, 500);
      if (contact.data?.id) {
        const consentEvent = await db.from("rg_consent_events").insert({
          contact_id: contact.data.id, consent: false, source: "sms-inbound-stop",
        });
        if (consentEvent.error) return json({ error: "Could not record opt-out" }, 500);
        const suppressed = await db.from("rg_recipients").update({
          status: "suppressed", error: "Opted out by inbound SMS",
        }).eq("contact_id", contact.data.id).eq("status", "queued");
        if (suppressed.error) return json({ error: "Could not suppress pending alerts" }, 500);
      }
    }
    const audit = await recordEvent();
    if (audit.error && audit.error.code !== "23505") return json({ error: "Could not record event" }, 500);
    return json({ accepted: true });
  }

  const messageId = String(event.payload.messageId || "");
  if (!messageId || messageId.length > 100) return json({ accepted: true });
  if (event.event === "sms:failed") {
    const result = await db.from("rg_recipients").update({
      status: "failed", error: String(event.payload.reason || "Gateway delivery failure").slice(0, 400),
    }).eq("message_id", messageId).in("status", ["accepted", "sent", "delivered"]);
    if (result.error) return json({ error: "Could not record delivery failure" }, 500);
  } else if (event.event === "sms:sent") {
    const result = await db.from("rg_recipients").update({ status: "sent" })
      .eq("message_id", messageId).eq("status", "accepted");
    if (result.error) return json({ error: "Could not update delivery state" }, 500);
  } else {
    // SMS Gate emits one delivered event per part. Confirm aggregate message
    // state before promoting the recipient to delivered.
    const user = Deno.env.get("SMS_GATE_USER");
    const pass = Deno.env.get("SMS_GATE_PASS");
    if (!user || !pass) return json({ error: "Gateway status unavailable" }, 503);
    try {
      const response = await fetch(`https://api.sms-gate.app/3rdparty/v1/messages/${encodeURIComponent(messageId)}`, {
        headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return json({ error: "Gateway status unavailable" }, 503);
      const message = await response.json();
      if (String(message.state || "").toLowerCase() === "delivered") {
        const result = await db.from("rg_recipients").update({
          status: "delivered", delivered_at: new Date().toISOString(), error: null,
        }).eq("message_id", messageId).in("status", ["accepted", "sent"]);
        if (result.error) return json({ error: "Could not update delivery state" }, 500);
      }
    } catch {
      return json({ error: "Gateway status unavailable" }, 503);
    }
  }
  const audit = await recordEvent();
  if (audit.error && audit.error.code !== "23505") return json({ error: "Could not record event" }, 500);
  return json({ accepted: true });
});
