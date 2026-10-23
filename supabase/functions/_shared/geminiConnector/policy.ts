import type { VerifiedAdmin } from "./contracts.ts";
export const LIMITS = {
  body: 32768,
  page: 20,
  codeSeconds: 300,
  accessSeconds: 3600,
  grantSeconds: 30 * 86400,
  imageBytes: 1048576,
  imageCount: 2,
} as const;
export class ConnectorError extends Error {
  constructor(public code: string, public status = 400, message = code) {
    super(message);
    this.name = "ConnectorError";
  }
}
export function productionOrigin(value: string): string {
  const u = new URL(value);
  if (
    u.protocol !== "https:" || u.username || u.password || u.port || u.search ||
    u.hash || u.pathname !== "/"
  ) throw new ConnectorError("invalid_origin");
  return u.origin;
}
export function connectorMetadata(value: string) {
  const origin = productionOrigin(value),
    resource = origin + "/api/advisory-mcp";
  return {
    resource: {
      resource,
      resource_name: "RiceGuardAI Advisory",
      authorization_servers: [origin],
      scopes_supported: ["evidence:read", "advisory:submit"],
      bearer_methods_supported: ["header"],
    },
    authorization: {
      issuer: origin,
      authorization_endpoint: origin + "/api/advisory-oauth/authorize",
      token_endpoint: origin + "/api/advisory-oauth/token",
      revocation_endpoint: origin + "/api/advisory-oauth/revoke",
      scopes_supported: ["evidence:read", "advisory:submit"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    },
  };
}
export function assertConnectorOwner(
  admin: VerifiedAdmin,
  ownerId: string,
): void {
  if (
    !ownerId || admin.id !== ownerId || admin.role !== "admin" ||
    !admin.is_active || admin.aal !== "aal2"
  ) {
    throw new ConnectorError(
      "access_denied",
      403,
      "Active connector owner and MFA required",
    );
  }
}
export function validGoogleRedirect(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      u.hostname === "oauth-redirect.googleusercontent.com" &&
      u.pathname.startsWith("/r/") && !u.port && !u.username && !u.password &&
      !u.hash && value.length <= 2048;
  } catch {
    return false;
  }
}
export function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });
}
export async function readBody(req: Request): Promise<string> {
  if (Number(req.headers.get("content-length")) > LIMITS.body) {
    throw new ConnectorError("payload_too_large", 413);
  }
  const reader = req.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIMITS.body) {
        await reader.cancel();
        throw new ConnectorError("payload_too_large", 413);
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function hash(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
export async function pkce(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
export function requireSameOrigin(req: Request, origin: string) {
  if (req.headers.get("origin") !== origin) {
    throw new ConnectorError(
      "access_denied",
      403,
      "Use the RiceGuardAI consent page",
    );
  }
}
