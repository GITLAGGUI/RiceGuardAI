import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { createNotifierHandler } from "../_shared/geminiConnector/notifier.ts";
import { notifyReadyEvent } from "../_shared/geminiConnector/notice.ts";
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const rpc = (name: string, args: { p_operation: string; p_input: unknown }) =>
  admin.rpc(name, args);
Deno.serve(createNotifierHandler({
  enabled: Deno.env.get("RG_GEMINI_NOTICE_ENABLED") === "true",
  secret: Deno.env.get("CRON_SECRET") || "",
  list: async () => {
    const { data, error } = await admin.rpc("rg_mcp_notice_candidates");
    if (error) throw new Error("Unavailable notice candidates");
    return data;
  },
  notify: (id) =>
    notifyReadyEvent(id, {
      endpoint: Deno.env.get("RG_GEMINI_NOTICE_URL") || "",
      secret: Deno.env.get("RG_GEMINI_NOTICE_HMAC_SECRET") || "",
      rpc,
      now: () => new Date(),
      randomUUID: () => crypto.randomUUID(),
    }),
}));
