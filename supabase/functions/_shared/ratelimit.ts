import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";

const SERVICE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SERVICE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

/**
 * Returns true if the caller is allowed to proceed; false if rate-limited.
 * Buckets are per-hour (window_start = top of hour).
 */
export async function rateLimit(key: string, max: number): Promise<boolean> {
  const now = new Date();
  const window = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      0,
      0
    )
  ).toISOString();

  const { data: existing } = await admin
    .from("rate_limits")
    .select("count")
    .eq("key", key)
    .eq("window_start", window)
    .maybeSingle();

  const next = (existing?.count ?? 0) + 1;
  if (next > max) return false;

  await admin
    .from("rate_limits")
    .upsert({ key, window_start: window, count: next }, { onConflict: "key,window_start" });

  return true;
}
