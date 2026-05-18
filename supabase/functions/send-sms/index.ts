// Send SMS via SMS Gate API.
// Two calling shapes supported:
//   { advisory_id }          → fetches phone + message from advisory
//   { phone, body }          → free-form (still admin-only)
//
// Respects notification_preferences.sms_enabled — silently drops the send
// (returns ok:true skipped:true) so the admin doesn't see a hard error when
// the farmer has opted out.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { rateLimit } from "../_shared/ratelimit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMS_GATE_USER = Deno.env.get("SMS_GATE_USER") ?? "";
const SMS_GATE_PASS = Deno.env.get("SMS_GATE_PASS") ?? "";

interface BodyAdvisory {
  advisory_id: string;
  phone?: never;
  body?: never;
}
interface BodyFree {
  advisory_id?: never;
  phone: string;
  body: string;
}
type Body = BodyAdvisory | BodyFree;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  const auth = req.headers.get("authorization");
  if (!auth) return jsonResponse({ error: "missing authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return jsonResponse({ error: "invalid session" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (profile?.role !== "admin") return jsonResponse({ error: "admin only" }, 403);

  if (!SMS_GATE_USER || !SMS_GATE_PASS)
    return jsonResponse({ error: "sms gateway not configured" }, 500);

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  // Resolve {phone, text, advisory_id} from either shape
  let phone: string;
  let text: string;
  let advisoryId: string | null = null;

  if ("advisory_id" in payload && payload.advisory_id) {
    advisoryId = payload.advisory_id;
    const { data: advisory, error: aErr } = await admin
      .from("advisories")
      .select("id, sms_text, severity, farmer_id, state")
      .eq("id", advisoryId)
      .single();
    if (aErr || !advisory) return jsonResponse({ error: "advisory not found" }, 404);
    if (!advisory.sms_text)
      return jsonResponse({ error: "advisory has no sms_text — generate first" }, 400);
    if (!advisory.farmer_id)
      return jsonResponse({ error: "advisory has no linked farmer" }, 400);

    const { data: farmer } = await admin
      .from("profiles")
      .select("phone")
      .eq("id", advisory.farmer_id)
      .single();
    if (!farmer?.phone)
      return jsonResponse({ error: "farmer has no phone" }, 400);

    // Notification prefs
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("sms_enabled, critical_alerts")
      .eq("farmer_id", advisory.farmer_id)
      .maybeSingle();
    const smsEnabled = prefs?.sms_enabled ?? true;
    const criticalOnly = prefs?.critical_alerts ?? true;

    if (!smsEnabled) {
      await admin
        .from("advisories")
        .update({ sms_status: "failed", sms_error: "farmer opted out of SMS" })
        .eq("id", advisoryId);
      return jsonResponse({ ok: true, skipped: true, reason: "farmer opted out" });
    }
    if (criticalOnly && advisory.severity !== "high") {
      await admin
        .from("advisories")
        .update({ sms_status: "failed", sms_error: "below critical threshold" })
        .eq("id", advisoryId);
      return jsonResponse({ ok: true, skipped: true, reason: "below critical threshold" });
    }

    phone = farmer.phone;
    text = advisory.sms_text;
  } else if ("phone" in payload && payload.phone && payload.body) {
    phone = payload.phone;
    text = payload.body;
  } else {
    return jsonResponse({ error: "advisory_id OR (phone+body) required" }, 400);
  }

  if (text.length > 320) return jsonResponse({ error: "message too long (>320)" }, 400);
  if (!/^\+639\d{9}$/.test(phone))
    return jsonResponse({ error: "phone must be +639XXXXXXXXX" }, 400);

  // Rate limits
  if (!(await rateLimit(`sms:phone:${phone}`, 5)))
    return jsonResponse({ error: "rate limit (5/hour per phone)" }, 429);
  if (!(await rateLimit("sms:global", 200)))
    return jsonResponse({ error: "rate limit (200/day global)" }, 429);

  const basic = btoa(`${SMS_GATE_USER}:${SMS_GATE_PASS}`);
  let providerJson: unknown = null;
  let ok = false;
  let httpStatus = 0;
  let errorBody: string | null = null;

  try {
    const res = await fetch("https://api.sms-gate.app/3rdparty/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${basic}`,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers: [phone],
        withDeliveryReport: false,
      }),
    });
    httpStatus = res.status;
    if (res.ok) {
      providerJson = await res.json().catch(() => null);
      ok = true;
    } else {
      errorBody = await res.text();
    }
  } catch (e) {
    errorBody = e instanceof Error ? e.message : String(e);
  }

  if (advisoryId) {
    await admin
      .from("advisories")
      .update(
        ok
          ? {
              sms_status: "sent",
              sms_sent_at: new Date().toISOString(),
              sms_error: null,
              state: "sent",
            }
          : {
              sms_status: "failed",
              sms_error: errorBody?.slice(0, 500) ?? `http ${httpStatus}`,
            }
      )
      .eq("id", advisoryId);
  }

  // Audit
  await admin.from("audit_events").insert({
    actor_id: userData.user.id,
    action: ok ? "sms.sent" : "sms.failed",
    target_table: advisoryId ? "advisories" : null,
    target_id: advisoryId,
    meta: { phone, ok, http: httpStatus, error: errorBody?.slice(0, 200) ?? null },
  });

  if (!ok)
    return jsonResponse(
      { error: "send failed", http: httpStatus, detail: errorBody?.slice(0, 500) },
      502
    );

  return jsonResponse({ ok: true, provider: providerJson });
});
