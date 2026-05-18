// Weekly digest — sends one SMS to each farmer with weekly_summary=true
// summarizing detections in their barangay over the last 7 days.
//
// Designed to be invoked by pg_cron Sundays 06:00 Asia/Manila:
//   select cron.schedule(
//     'rg-weekly-digest',
//     '0 22 * * 6',  -- UTC Saturday 22:00 = Sun 06:00 Asia/Manila
//     $$ select net.http_post(
//          url := 'https://<project>.functions.supabase.co/weekly-digest',
//          headers := jsonb_build_object(
//            'authorization', 'Bearer <service_role_key>',
//            'content-type','application/json'
//          ),
//          body := '{}'::jsonb
//        ) $$
//   );

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handleCors, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMS_GATE_USER = Deno.env.get("SMS_GATE_USER") ?? "";
const SMS_GATE_PASS = Deno.env.get("SMS_GATE_PASS") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Allow either service_role (from pg_cron) or a shared CRON_SECRET header
  const auth = req.headers.get("authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const isServiceRole = auth.includes(SUPABASE_SERVICE_KEY);
  const isCron = CRON_SECRET && cronHeader === CRON_SECRET;
  if (!isServiceRole && !isCron) return jsonResponse({ error: "forbidden" }, 403);

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Farmers opted into weekly summary
  const { data: farmers, error: fErr } = await admin
    .from("notification_preferences")
    .select(
      "farmer_id, profiles!inner(id, phone, full_name, barangay, municipality, lat, lng, is_active)"
    )
    .eq("weekly_summary", true)
    .eq("sms_enabled", true);
  if (fErr) return jsonResponse({ error: fErr.message }, 500);

  type FarmerRow = {
    farmer_id: string;
    profiles: {
      id: string;
      phone: string;
      full_name: string | null;
      barangay: string | null;
      municipality: string | null;
      lat: number | null;
      lng: number | null;
      is_active: boolean;
    };
  };
  const list = (farmers ?? []) as unknown as FarmerRow[];

  let sent = 0;
  let skipped = 0;
  const errors: Array<{ farmer_id: string; reason: string }> = [];

  for (const row of list) {
    const f = row.profiles;
    if (!f || !f.is_active || !f.phone) {
      skipped++;
      continue;
    }

    // Count detections nearby (10 km radius) within the last 7 days
    let count = 0;
    let highest = "low";
    if (f.lat != null && f.lng != null) {
      const { data: nearby } = await admin.rpc("find_nearby_detections", {
        p_lat: f.lat,
        p_lng: f.lng,
        p_radius_km: 10,
        p_since: since,
      });
      const arr = (nearby ?? []) as Array<{ severity: string }>;
      count = arr.length;
      if (arr.some((d) => d.severity === "high")) highest = "high";
      else if (arr.some((d) => d.severity === "medium")) highest = "medium";
    }

    if (count === 0) {
      skipped++;
      continue;
    }

    const name = f.full_name?.split(" ")[0] ?? "Magsasaka";
    const loc = f.barangay ?? f.municipality ?? "iyong lugar";
    const text = `[RiceGuard] Kumusta ${name}. Sa nakaraang linggo, ${count} detection sa palibot ng ${loc}. Pinakamataas: ${highest}. Tingnan ang app para sa detalye.`;

    const basic = btoa(`${SMS_GATE_USER}:${SMS_GATE_PASS}`);
    try {
      const res = await fetch("https://api.sms-gate.app/3rdparty/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${basic}`,
        },
        body: JSON.stringify({
          textMessage: { text: text.slice(0, 280) },
          phoneNumbers: [f.phone],
          withDeliveryReport: false,
        }),
      });
      if (res.ok) sent++;
      else errors.push({ farmer_id: f.id, reason: `sms ${res.status}` });
    } catch (e) {
      errors.push({ farmer_id: f.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  await admin.from("audit_events").insert({
    actor_id: null,
    action: "digest.weekly",
    meta: { sent, skipped, errors: errors.length, candidates: list.length },
  });

  return jsonResponse({ ok: true, sent, skipped, errors });
});
