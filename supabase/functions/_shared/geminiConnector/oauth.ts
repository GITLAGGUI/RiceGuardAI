import { z } from "zod";
import type {
  ConnectorDeps,
  ConnectorScope,
  GrantContext,
} from "./contracts.ts";
import { scopes } from "./contracts.ts";
import {
  assertConnectorOwner,
  ConnectorError,
  hash,
  json,
  LIMITS,
  pkce,
  readBody,
  requireSameOrigin,
  validGoogleRedirect,
} from "./policy.ts";

const text = (value: unknown, max = 2048) =>
  z.string().min(1).max(max).parse(value);
const secret = (value: unknown) =>
  z.string().regex(/^[A-Za-z0-9_.~-]{32,160}$/).parse(value);
function selectedScopes(raw: string) {
  const chosen = raw.trim().split(/\s+/);
  if (
    !chosen.length ||
    chosen.some((s) => !scopes.includes(s as ConnectorScope)) ||
    new Set(chosen).size !== chosen.length
  ) throw new ConnectorError("invalid_scope");
  return chosen as ConnectorScope[];
}
async function rate(deps: ConnectorDeps, bucket: string, max: number) {
  const r = await deps.store.execute({
    op: "rate_limit",
    input: {
      bucket_hash: await hash(bucket),
      window_seconds: 60,
      max_requests: max,
    },
  });
  if (!r.allowed) {
    throw new ConnectorError(
      "rate_limited",
      429,
      "Please wait before retrying",
    );
  }
}
function bearer(req: Request) {
  const match = req.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/);
  if (!match) throw new ConnectorError("unauthorized", 401);
  return match[1];
}
export async function requireGrant(
  req: Request,
  scope: ConnectorScope,
  deps: ConnectorDeps,
): Promise<GrantContext> {
  const token = bearer(req);
  if (!/^rgmcp_[A-Za-z0-9_-]{43}$/.test(token) || !deps.ownerId) {
    throw new ConnectorError("unauthorized", 401);
  }
  let ctx: GrantContext;
  try {
    ctx = await deps.store.execute({
      op: "access_context",
      input: {
        access_hash: await hash(token),
        resource: deps.origin + "/api/advisory-mcp",
      },
    });
  } catch {
    throw new ConnectorError("unauthorized", 401);
  }
  if (
    ctx.owner_id !== deps.ownerId ||
    Date.parse(ctx.expires_at) <= deps.now().getTime()
  ) throw new ConnectorError("unauthorized", 401);
  if (!ctx.scopes.includes(scope)) {
    throw new ConnectorError("insufficient_scope", 403);
  }
  await rate(
    deps,
    "grant:" + ctx.grant_id,
    scope === "advisory:submit" ? 20 : 120,
  );
  return ctx;
}
async function owner(req: Request, deps: ConnectorDeps) {
  requireSameOrigin(req, deps.origin);
  let admin;
  try {
    admin = await deps.verifyAdmin(bearer(req));
  } catch {
    throw new ConnectorError(
      "access_denied",
      403,
      "Owner sign-in and MFA required",
    );
  }
  assertConnectorOwner(admin, deps.ownerId);
  await rate(deps, "owner:" + admin.id, 20);
  return admin;
}
function routeOf(req: Request) {
  return new URL(req.url).pathname.split(/\/(?:advisory-oauth|oauth)\//)[1] ||
    "";
}
export async function handleOAuth(
  req: Request,
  deps: ConnectorDeps,
): Promise<Response> {
  const route = routeOf(req), url = new URL(req.url), now = deps.now();
  const after = (seconds: number) =>
    new Date(now.getTime() + seconds * 1000).toISOString();
  if (route === "authorize") {
    if (req.method !== "GET") {
      throw new ConnectorError("method_not_allowed", 405);
    }
    const p = url.searchParams;
    for (const key of p.keys()) {
      if (p.getAll(key).length !== 1) {
        throw new ConnectorError("invalid_request");
      }
    }
    if (
      p.get("response_type") !== "code" ||
      p.get("code_challenge_method") !== "S256" ||
      p.get("resource") !== deps.origin + "/api/advisory-mcp"
    ) throw new ConnectorError("invalid_request");
    const redirect = text(p.get("redirect_uri"));
    if (!validGoogleRedirect(redirect)) {
      throw new ConnectorError("invalid_request");
    }
    const challenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(
      p.get("code_challenge"),
    );
    await rate(deps, "authorize", 60);
    const pending = await deps.store.execute({
      op: "create_request",
      input: {
        request_id: crypto.randomUUID(),
        client_id: text(p.get("client_id"), 200),
        redirect_uri: redirect,
        resource: deps.origin + "/api/advisory-mcp",
        scopes: selectedScopes(p.get("scope") || scopes.join(" ")),
        state: text(p.get("state")),
        challenge,
        expires_at: after(LIMITS.codeSeconds),
      },
    });
    return new Response(null, {
      status: 303,
      headers: {
        Location: deps.origin + "/admin/connect/gemini?request=" +
          encodeURIComponent(pending.request_id),
        "Cache-Control": "no-store",
      },
    });
  }
  if (req.method !== "POST") {
    throw new ConnectorError("method_not_allowed", 405);
  }
  if (route.startsWith("owner/")) {
    const admin = await owner(req, deps);
    const raw = JSON.parse(await readBody(req)), action = route.slice(6);
    if (action === "register-client") {
      const p = z.object({
        client_name: z.string().trim().min(1).max(100),
        redirect_uri: z.string().max(2048).refine(validGoogleRedirect),
      }).strict().parse(raw);
      const clientId = "rg_advisory_" + deps.randomToken(),
        clientSecret = deps.randomToken();
      const result = await deps.store.execute({
        op: "register_client",
        input: {
          owner_id: admin.id,
          client_id: clientId,
          client_name: p.client_name,
          redirect_uri: p.redirect_uri,
          secret_hash: await hash(clientSecret),
        },
      });
      return json({ ...result, client_secret: clientSecret }, 201);
    }
    if (action === "preview") {
      const p = z.object({ request_id: z.uuid() }).strict().parse(raw);
      return json(
        await deps.store.execute({
          op: "preview_consent",
          input: { ...p, owner_id: admin.id },
        }),
      );
    }
    if (action === "consent") {
      const p = z.object({
        request_id: z.uuid(),
        decision: z.enum(["allow", "deny"]),
        survey_ids: z.array(z.uuid()).max(20),
        allow_images: z.boolean(),
      }).strict().parse(raw);
      if (p.decision === "allow" && !p.survey_ids.length) {
        throw new ConnectorError(
          "invalid_request",
          400,
          "Select the evidence you want to share",
        );
      }
      const code = deps.randomToken();
      const result = await deps.store.execute({
        op: "complete_consent",
        input: {
          ...p,
          owner_id: admin.id,
          code_hash: p.decision === "allow" ? await hash(code) : null,
          code_expires_at: after(LIMITS.codeSeconds),
          grant_expires_at: after(LIMITS.grantSeconds),
        },
      });
      if (!validGoogleRedirect(result.redirect_uri)) {
        throw new ConnectorError("invalid_redirect");
      }
      const redirect = new URL(result.redirect_uri);
      redirect.searchParams.set("state", result.state);
      redirect.searchParams.set("iss", deps.origin);
      if (result.allowed) redirect.searchParams.set("code", code);
      else redirect.searchParams.set("error", "access_denied");
      return json({ redirect_uri: redirect.href });
    }
    if (action === "grants") {
      z.object({}).strict().parse(raw);
      return json(
        await deps.store.execute({
          op: "owner_grants",
          input: { owner_id: admin.id },
        }),
      );
    }
    if (action === "revoke") {
      const p = z.object({ grant_id: z.uuid() }).strict().parse(raw);
      return json(
        await deps.store.execute({
          op: "revoke",
          input: { mode: "owner", owner_id: admin.id, ...p },
        }),
      );
    }
    throw new ConnectorError("not_found", 404);
  }
  if (route !== "token" && route !== "revoke") {
    throw new ConnectorError("not_found", 404);
  }
  if (
    !req.headers.get("content-type")?.startsWith(
      "application/x-www-form-urlencoded",
    )
  ) throw new ConnectorError("invalid_request");
  const p = new URLSearchParams(await readBody(req));
  for (const key of p.keys()) {
    if (p.getAll(key).length !== 1) {
      throw new ConnectorError("invalid_request");
    }
  }
  const client_id = text(p.get("client_id"), 200),
    client_secret_hash = await hash(secret(p.get("client_secret")));
  await rate(deps, "token:" + client_id, 20);
  if (route === "revoke") {
    return json(
      await deps.store.execute({
        op: "revoke",
        input: {
          mode: "client",
          client_id,
          client_secret_hash,
          token_hash: await hash(text(p.get("token"), 256)),
        },
      }),
    );
  }
  if (p.get("resource") !== deps.origin + "/api/advisory-mcp") {
    throw new ConnectorError("invalid_target");
  }
  const access = "rgmcp_" + deps.randomToken(),
    refresh = "rgr_" + deps.randomToken();
  const common = {
    client_id,
    client_secret_hash,
    resource: deps.origin + "/api/advisory-mcp",
    access_hash: await hash(access),
    refresh_hash: await hash(refresh),
    access_expires_at: after(LIMITS.accessSeconds),
  };
  let grant;
  if (p.get("grant_type") === "authorization_code") {
    const redirect = text(p.get("redirect_uri"));
    if (!validGoogleRedirect(redirect)) {
      throw new ConnectorError("invalid_request");
    }
    const verifier = z.string().regex(/^[-._~A-Za-z0-9]{43,128}$/).parse(
      p.get("code_verifier"),
    );
    grant = await deps.store.execute({
      op: "exchange_code",
      input: {
        ...common,
        code_hash: await hash(secret(p.get("code"))),
        challenge: await pkce(verifier),
        redirect_uri: redirect,
      },
    });
  } else if (p.get("grant_type") === "refresh_token") {
    grant = await deps.store.execute({
      op: "rotate_refresh",
      input: {
        ...common,
        old_refresh_hash: await hash(secret(p.get("refresh_token"))),
      },
    });
  } else throw new ConnectorError("unsupported_grant_type");
  const expires = Math.min(
    LIMITS.accessSeconds,
    Math.floor((Date.parse(grant.grant_expires_at) - now.getTime()) / 1000),
  );
  if (!Number.isFinite(expires) || expires <= 0) {
    throw new ConnectorError("invalid_grant");
  }
  return json({
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: expires,
    scope: grant.scopes.join(" "),
  });
}
