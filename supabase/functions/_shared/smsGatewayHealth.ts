// Android SMS Gate health from two independent signals:
//  1. the SMS Gate cloud's device record (`lastSeen`, updated when the phone talks to the cloud), and
//  2. webhooks the phone itself sent us (`system:ping` heartbeats and every sms:* report).
// The phone is "connected" when either signal is recent. An idle phone may not contact the
// cloud for a while, so a cloud-only check used to report "offline" while the app was running.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

export type SmsGatewayState = "connected" | "offline" | "credentials_present" | "configuration_required" | "error";
export interface SmsGatewayHealth {
  state: SmsGatewayState;
  checked_at: string;
  cloud_last_seen: string | null;
  last_webhook_at: string | null;
  last_webhook_kind: string | null;
  last_failure_reason: string | null;
  last_failure_at: string | null;
  device_name: string | null;
}

export const ONLINE_WINDOW_MS = 15 * 60_000;

const env = (name: string) => Deno.env.get(name) || "";

export async function smsGatewayHealth(db: SupabaseClient): Promise<SmsGatewayHealth> {
  const health: SmsGatewayHealth = {
    state: "offline", checked_at: new Date().toISOString(), cloud_last_seen: null,
    last_webhook_at: null, last_webhook_kind: null, last_failure_reason: null, last_failure_at: null, device_name: null,
  };
  const [cloud, webhook, failure] = await Promise.all([
    cloudDevice(),
    db.from("rg_events").select("kind,created_at").or("kind.like.sms:%,kind.eq.system:ping")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("rg_recipients").select("error,updated_at").eq("status", "failed").not("error", "is", null)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (webhook.data) {
    health.last_webhook_at = webhook.data.created_at;
    health.last_webhook_kind = webhook.data.kind;
  }
  if (failure.data) {
    health.last_failure_reason = String(failure.data.error).slice(0, 200);
    health.last_failure_at = failure.data.updated_at;
  }
  health.cloud_last_seen = cloud.lastSeen;
  health.device_name = cloud.name;
  const recent = (iso: string | null) => Boolean(iso) && Date.now() - Date.parse(iso!) < ONLINE_WINDOW_MS;
  if (recent(health.cloud_last_seen) || recent(health.last_webhook_at)) health.state = "connected";
  else if (cloud.state !== "offline") health.state = cloud.state;
  return health;
}

async function cloudDevice(): Promise<{ state: SmsGatewayState; lastSeen: string | null; name: string | null }> {
  const user = env("SMS_GATE_USER");
  const pass = env("SMS_GATE_PASS");
  if (!user || !pass) {
    return { state: env("SMS_GATE_TOKEN") ? "credentials_present" : "configuration_required", lastSeen: null, name: null };
  }
  try {
    const response = await fetch("https://api.sms-gate.app/3rdparty/v1/devices", {
      headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 401 || response.status === 403) return { state: "error", lastSeen: null, name: null };
    if (!response.ok) return { state: "offline", lastSeen: null, name: null };
    const devices = await response.json();
    if (!Array.isArray(devices)) return { state: "credentials_present", lastSeen: null, name: null };
    const wanted = env("SMS_GATE_DEVICE_ID");
    const device = devices
      .filter((item) => !wanted || item.id === wanted)
      .sort((a, b) => Date.parse(String(b.lastSeen || 0)) - Date.parse(String(a.lastSeen || 0)))[0];
    const seen = Date.parse(String(device?.lastSeen || ""));
    return { state: "offline", lastSeen: Number.isFinite(seen) ? new Date(seen).toISOString() : null,
      name: device?.name ? String(device.name).slice(0, 60) : null };
  } catch {
    return { state: "offline", lastSeen: null, name: null };
  }
}

/** Ask SMS Gate to send `system:ping` heartbeats to our webhook (the app's ping interval must be on). */
export async function registerPingWebhook(webhookUrl: string) {
  const user = env("SMS_GATE_USER");
  const pass = env("SMS_GATE_PASS");
  if (!user || !pass) throw new Error("SMS Gate cloud credentials are not configured");
  const auth = `Basic ${btoa(`${user}:${pass}`)}`;
  const listed = await fetch("https://api.sms-gate.app/3rdparty/v1/webhooks", {
    headers: { Authorization: auth }, signal: AbortSignal.timeout(8_000),
  });
  if (!listed.ok) throw new Error(`SMS Gate webhooks returned ${listed.status}`);
  const hooks = await listed.json() as Array<{ event?: string; url?: string }>;
  if (hooks.some((hook) => hook.event === "system:ping")) return { registered: true, existing: true };
  const created = await fetch("https://api.sms-gate.app/3rdparty/v1/webhooks", {
    method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ event: "system:ping", url: webhookUrl, ...(env("SMS_GATE_DEVICE_ID") ? { deviceId: env("SMS_GATE_DEVICE_ID") } : {}) }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!created.ok) throw new Error(`SMS Gate rejected the ping webhook (${created.status})`);
  return { registered: true, existing: false };
}
