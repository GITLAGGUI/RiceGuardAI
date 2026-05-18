// Supabase Auth → Send SMS Hook
// Routes OTP delivery through SMS Gate API instead of Supabase's default providers.
//
// Configure in Studio: Authentication → Hooks → Send SMS hook → URL =
//   https://<project>.supabase.co/functions/v1/auth-sms-hook

import { handleCors, jsonResponse } from "../_shared/cors.ts";

interface HookPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
}

const SMS_GATE_USER = Deno.env.get("SMS_GATE_USER") ?? "";
const SMS_GATE_PASS = Deno.env.get("SMS_GATE_PASS") ?? "";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  if (!SMS_GATE_USER || !SMS_GATE_PASS) {
    console.error("[auth-sms-hook] missing SMS_GATE_USER / SMS_GATE_PASS env");
    return jsonResponse({ error: "sms gateway not configured" }, 500);
  }

  const rawBody = await req.text();
  console.log("[auth-sms-hook] incoming body:", rawBody);

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch (e) {
    console.error("[auth-sms-hook] invalid json", e);
    return jsonResponse({ error: "invalid json" }, 400);
  }

  let phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    console.error("[auth-sms-hook] missing phone or otp", { hasPhone: !!phone, hasOtp: !!otp });
    return jsonResponse({ error: "missing phone or otp" }, 400);
  }

  // Normalize: Supabase may send "639XXXXXXXXX" without the leading "+"
  if (!phone.startsWith("+")) phone = `+${phone}`;

  const text = `RiceGuard: Iyong code ay ${otp}. Wag ibahagi. (5 min)`;

  const basic = btoa(`${SMS_GATE_USER}:${SMS_GATE_PASS}`);
  let res: Response;
  try {
    res = await fetch("https://api.sms-gate.app/3rdparty/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers: [phone],
        withDeliveryReport: false,
      }),
    });
  } catch (e) {
    console.error("[auth-sms-hook] fetch threw", e);
    return jsonResponse({ error: "sms gateway unreachable", detail: String(e) }, 502);
  }

  const respBody = await res.text();
  console.log("[auth-sms-hook] sms gate response", res.status, respBody);

  if (!res.ok) {
    return jsonResponse(
      { error: "sms send failed", upstream_status: res.status, upstream_body: respBody },
      502,
    );
  }

  return jsonResponse({ ok: true });
});
