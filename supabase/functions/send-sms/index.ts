import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const gatewayUrl = Deno.env.get("SMS_GATE_URL") || "https://api.sms-gate.app/3rdparty/v1/messages";
const gatewayToken = Deno.env.get("SMS_GATE_TOKEN");
const gatewayUser = Deno.env.get("SMS_GATE_USER");
const gatewayPass = Deno.env.get("SMS_GATE_PASS");

function quietHours() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return hour >= 20 || hour < 6;
}
function nextSixAm() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayOffset = Number(value.hour) >= 20 ? 1 : 0;
  const localMidnightUtc = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day) + dayOffset, 22, 0, 0); // 06:00 Asia/Manila
  return new Date(localMidnightUtc).toISOString();
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);
  if ((!gatewayToken && !(gatewayUser && gatewayPass)) || !gatewayUrl) return json({ error: "SMS Gate is not configured; queued messages were preserved" }, 503);
  if (quietHours()) {
    const resume = nextSixAm();
    await db.from("rg_recipients").update({ not_before: resume }).eq("status", "queued").lt("not_before", resume);
    return json({ status: "quiet_hours", resume_at: resume });
  }
  const recipients = await db.from("rg_recipients").select("id,campaign_id,contact_id,phone,attempts,client_message_id,rg_campaigns!inner(id,bulletin_id,rg_bulletins!inner(title,disease,location,action,slug,status))").eq("status", "queued").lte("not_before", new Date().toISOString()).order("created_at").limit(25);
  if (recipients.error) return json({ error: recipients.error.message }, 500);
  const report = { accepted: 0, suppressed: 0, failed: 0, unknown: 0 };
  for (const recipient of recipients.data || []) {
    const contact = await db.from("rg_contacts").select("consent,verified").eq("id", recipient.contact_id).single();
    if (!contact.data?.consent || !contact.data?.verified) {
      await db.from("rg_recipients").update({ status: "suppressed", error: "Consent or phone verification no longer active" }).eq("id", recipient.id);
      report.suppressed++;
      continue;
    }
    const bulletin = recipient.rg_campaigns.rg_bulletins;
    if (bulletin.status !== "published") {
      await db.from("rg_recipients").update({ status: "suppressed", error: "Publication is no longer active" }).eq("id", recipient.id);
      report.suppressed++;
      continue;
    }
    const publicUrl = `${Deno.env.get("APP_ORIGIN") || "https://riceguardai.dev"}/advisories/${bulletin.slug}`;
    const inboundOptOutEnabled = Boolean(
      Deno.env.get("SMS_GATE_WEBHOOK_SECRET") || Deno.env.get("SMS_GATE_WEBHOOK_TOKEN"),
    );
    const stopText = inboundOptOutEnabled ? " Reply STOP to opt out." : " Manage alerts on the RiceGuardAI website.";
    const message = `RiceGuardAI: Reviewed ${bulletin.disease} advisory near ${bulletin.location}. ${bulletin.action} Details: ${publicUrl}.${stopText}`.slice(0, 620);
    const authorization = gatewayToken ? `Bearer ${gatewayToken}` : `Basic ${btoa(`${gatewayUser}:${gatewayPass}`)}`;
    try {
      const response = await fetch(gatewayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({
          id: recipient.client_message_id,
          textMessage: { text: message },
          phoneNumbers: [recipient.phone],
          ttl: 3600,
          withDeliveryReport: true,
        }),
      });
      const provider = await response.json().catch(() => ({}));
      if (response.ok) {
        const messageId = provider.id || provider.messageId || provider.messages?.[0]?.id || null;
        await db.from("rg_recipients").update({ status: "accepted", message_id: messageId, accepted_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(), attempts: recipient.attempts + 1, error: null }).eq("id", recipient.id).eq("status", "queued");
        report.accepted++;
      } else if (response.status === 409) {
        await db.from("rg_recipients").update({ status: "unknown", attempts: recipient.attempts + 1, last_attempt_at: new Date().toISOString(), error: "Gateway reported a duplicate message ID; verify provider status before retry" }).eq("id", recipient.id);
        report.unknown++;
      } else if (response.status >= 500 && recipient.attempts < 3) {
        await db.from("rg_recipients").update({ attempts: recipient.attempts + 1, last_attempt_at: new Date().toISOString(), not_before: new Date(Date.now() + 15 * 60_000).toISOString(), error: `Gateway unavailable (${response.status})` }).eq("id", recipient.id);
        report.failed++;
      } else {
        await db.from("rg_recipients").update({ status: "failed", attempts: recipient.attempts + 1, last_attempt_at: new Date().toISOString(), error: `Gateway rejected request (${response.status})` }).eq("id", recipient.id);
        report.failed++;
      }
    } catch (error) {
      await db.from("rg_recipients").update({ status: "unknown", attempts: recipient.attempts + 1, last_attempt_at: new Date().toISOString(), error: `Send outcome uncertain: ${error instanceof Error ? error.message.slice(0, 180) : "network error"}` }).eq("id", recipient.id);
      report.unknown++;
    }
  }
  return json(report);
});
