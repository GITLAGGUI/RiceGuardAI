// GABAY: Koneksyon ng browser sa Supabase (database + auth). Kinukuha ang URL at anon key sa frontend/.env.local.
// Para lumipat sa local database (Docker), palitan ang VITE_SUPABASE_URL at VITE_SUPABASE_ANON_KEY doon. Tingnan ang docs/DEBUGGING_GUIDE.md.
import { createClient } from "@supabase/supabase-js";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(configuredUrl && configuredAnonKey);

// GABAY: Local debugging lang. Kapag `npm run dev:local` at local Docker database ang gamit, hindi na hihingi ng MFA
// (authenticator app) ang admin login. Hindi ito gagana sa production: kailangang dev mode, localhost na URL at
// VITE_LOCAL_SKIP_MFA=true (isinusulat ng scripts/local-db-env.mjs sa .env.localdb).
export const localSkipMfa =
  import.meta.env.DEV &&
  import.meta.env.VITE_LOCAL_SKIP_MFA === "true" &&
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(configuredUrl ?? "");

// Public research pages must remain viewable before deployment credentials are
// attached. Protected routes still require a real Supabase project; this local
// placeholder only prevents the public site from crashing at module import.
const url = configuredUrl || "http://127.0.0.1:54321";
const anonKey = configuredAnonKey || "riceguard-public-preview";

if (!supabaseConfigured && import.meta.env.DEV) {
  console.info(
    "RiceGuard public preview: Supabase is not configured; authenticated features are unavailable."
  );
}

// NOTE: untyped client for now. Run `npm run gen:types` after linking the
// project to generate src/types/database.ts, then re-add the generic.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Farmer SMS verification must not replace an administrator's email/MFA
// session in the same browser. This client intentionally has a separate auth
// storage namespace and never consumes email-login callbacks from the URL.
export const subscriberSupabase = createClient(url, anonKey, {
  auth: {
    storageKey: "riceguard-subscriber-auth-v1",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
