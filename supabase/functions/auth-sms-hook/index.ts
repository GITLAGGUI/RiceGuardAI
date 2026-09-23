// Supabase Auth → Send SMS Hook
// Routes OTP delivery through SMS Gate API instead of Supabase's default providers.
//
// Configure in Studio: Authentication → Hooks → Send SMS hook → URL =
//   https://<project>.supabase.co/functions/v1/auth-sms-hook

import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { Webhook } from "npm:standardwebhooks@1.0.0";

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
  const hookSecrets = (Deno.env.get("SEND_SMS_HOOK_SECRETS") ?? "")
    .split("|")
    .filter((secret) => /^v1,whsec_[A-Za-z0-9+/=]{32,88}$/.test(secret))
    .map((secret) => secret.replace(/^v1,whsec_/, ""));
  if (hookSecrets.length === 0)
    return jsonResponse(
      { error: "SMS hook verification is not configured" },
      503,
    );
  const headers = Object.fromEntries(req.headers);
  let verified = false;
  for (const secret of hookSecrets) {
    try {
      new Webhook(secret).verify(rawBody, headers);
      verified = true;
      break;
    } catch {
      // During rotation Auth can sign with either configured secret.
    }
  }
  if (!verified) {
    return jsonResponse({ error: "Invalid hook signature" }, 401);
  }

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
    console.error("[auth-sms-hook] missing phone or otp", {
      hasPhone: !!phone,
      hasOtp: !!otp,
    });
    return jsonResponse({ error: "missing phone or otp" }, 400);
  }

  // Normalize: Supabase may send "639XXXXXXXXX" without the leading "+"
  if (!phone.startsWith("+")) phone = `+${phone}`;
  if (!/^\+639\d{9}$/.test(phone) || !/^\d{6,8}$/.test(otp))
    return jsonResponse(
      { error: "Invalid OTP destination or code format" },
      400,
    );

  const text = `RiceGuard: Iyong code ay ${otp}. Wag ibahagi. (5 min)`;

  const basic = btoa(`${SMS_GATE_USER}:${SMS_GATE_PASS}`);
  let res: Response;
  try {
    res = await fetch("https://api.sms-gate.app/3rdparty/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        id: req.headers.get("webhook-id") || crypto.randomUUID(),
        textMessage: { text },
        phoneNumbers: [phone],
        ttl: 300,
        withDeliveryReport: true,
      }),
    });
  } catch (e) {
    console.error("[auth-sms-hook] fetch threw", e);
    return jsonResponse({ error: "sms gateway unreachable" }, 502);
  }

  await res.body?.cancel();

  if (!res.ok) {
    return jsonResponse(
      { error: "sms send failed", upstream_status: res.status },
      502,
    );
  }

  return jsonResponse({ ok: true });
});
