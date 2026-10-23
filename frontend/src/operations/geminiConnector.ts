import { supabase } from "@/lib/supabase";

type OwnerAction = "register-client" | "preview" | "consent" | "grants" | "revoke";
export type ConnectorScope = "evidence:read" | "advisory:submit";
export interface ConsentPreview {
  app_name: string;
  scopes: ConnectorScope[];
  expires_at: string;
  eligible_surveys: { id: string; label: string }[];
}
export interface ConnectorGrant {
  id: string;
  app_name: string;
  scopes: ConnectorScope[];
  allow_images: boolean;
  expires_at: string;
  revoked_at: string | null;
  survey_ids: string[];
}
export class ConnectorOwnerError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
    this.name = "ConnectorOwnerError";
  }
}

export async function connectorOwnerAction<T>(action: OwnerAction, input: unknown): Promise<T> {
  if (!["register-client", "preview", "consent", "grants", "revoke"].includes(action)) {
    throw new Error("Unknown connector owner action.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sign in with your administrator account first.");
  const response = await fetch(`/api/advisory-oauth/owner/${action}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(input),
  });
  let payload: T & { error?: string; message?: string };
  try {
    payload = await response.json();
  } catch {
    throw new Error("The connector returned an invalid response. Please try again later.");
  }
  if (!response.ok || payload?.error) {
    throw new ConnectorOwnerError(
      payload?.message || "The connector owner action failed.",
      payload?.error || "owner_action_failed",
      response.status,
    );
  }
  return payload;
}

// The server also enforces equality with the client's exact registered URI.
export function googleConnectorCallback(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid Google callback URL."); }
  if (url.protocol !== "https:" || url.hostname !== "oauth-redirect.googleusercontent.com" ||
      url.port || url.username || url.password || url.hash || !url.pathname.startsWith("/r/") || url.pathname === "/r/") {
    throw new Error("The connector returned an unapproved Google callback URL.");
  }
  return url.href;
}

export function safeAdminReturnPath(value: unknown): string {
  const fallback = "/admin/overview";
  if (typeof value !== "string" || value.length > 2048 || /[\\\s#]/.test(value)) return fallback;
  const known = ["overview", "surveys", "surveys/new", "review", "map", "advisories", "farmers", "sms", "model", "settings"];
  if (known.some((path) => value === `/admin/${path}`)) return value;
  const match = /^\/admin\/connect\/gemini\?request=([A-Za-z0-9_-]{16,128})$/.exec(value);
  return match ? `/admin/connect/gemini?request=${match[1]}` : fallback;
}
