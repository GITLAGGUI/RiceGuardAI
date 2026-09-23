import { createClient } from "@supabase/supabase-js";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const configuredAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(configuredUrl && configuredAnonKey);

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
