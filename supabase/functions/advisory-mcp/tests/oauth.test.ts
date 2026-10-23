import assert from "node:assert/strict";
import type { ConnectorDeps } from "../../_shared/geminiConnector/contracts.ts";
import {
  handleOAuth,
  requireGrant,
} from "../../_shared/geminiConnector/oauth.ts";
const origin = "https://riceguardai.dev",
  owner = "aaaaaaaa-0000-4000-8000-000000000001";
function fixture(
  run: (op: string, input: Record<string, unknown>) => unknown,
): ConnectorDeps {
  return {
    origin,
    ownerId: owner,
    now: () => new Date("2026-10-23T00:00:00Z"),
    randomToken: () => "a".repeat(43),
    media: { read: async () => [] },
    verifyAdmin: async (jwt) => {
      if (jwt !== "owner-jwt") throw new Error("unauthorized");
      return { id: owner, role: "admin", is_active: true, aal: "aal2" };
    },
    store: {
      execute: async ({ op, input }) =>
        op === "rate_limit"
          ? { allowed: true, retry_after_seconds: 0 }
          : await run(op, input),
    } as ConnectorDeps["store"],
  };
}
const callback =
  "https://oauth-redirect.googleusercontent.com/r/controlled-connector";
function authorize(overrides: Record<string, string> = {}) {
  return new Request(
    origin + "/api/advisory-oauth/authorize?" + new URLSearchParams({
      client_id: "fixture-client",
      redirect_uri: callback,
      resource: origin + "/api/advisory-mcp",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: "b".repeat(43),
      scope: "evidence:read advisory:submit",
      state: "fixture-state",
      ...overrides,
    }),
  );
}
Deno.test("authorize GET creates a pending request, never issues a grant", async () => {
  const deps = fixture((op, input) => {
    assert.equal(op, "create_request");
    return { ...input, client_name: "RiceGuardAI Advisory" };
  });
  const res = await handleOAuth(authorize(), deps);
  assert.equal(res.status, 303);
  assert.match(
    new URL(res.headers.get("location")!).searchParams.get("request")!,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
Deno.test("foreign callbacks, wrong resource and missing PKCE never reach persistence", async () => {
  const deps = fixture(() =>
    assert.fail("invalid authorization must not be persisted")
  );
  const changes: Record<string, string>[] = [
    { redirect_uri: "https://evil.invalid/" },
    { resource: "https://leadmaps.live/api/contact-mcp" },
    { code_challenge_method: "plain" },
    { scope: "contacts:read" },
  ];
  for (const change of changes) {
    await assert.rejects(() => handleOAuth(authorize(change), deps));
  }
});
Deno.test("owner consent requires verified session, same origin and explicit selection", async () => {
  const deps = fixture((op, input) => {
    assert.equal(op, "complete_consent");
    assert.equal(input.allow_images, false);
    return {
      redirect_uri: callback,
      state: "fixture-state",
      allowed: true,
      grant_id: "grant",
    };
  });
  const req = (token: string, headers: Record<string, string> = {}) =>
    new Request(origin + "/api/advisory-oauth/owner/consent", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        origin,
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        request_id: "aaaaaaaa-0000-4000-8000-000000000001",
        decision: "allow",
        survey_ids: ["11111111-0000-4000-8000-000000000001"],
        allow_images: false,
      }),
    });
  await assert.rejects(() => handleOAuth(req("not-owner"), deps));
  await assert.rejects(() =>
    handleOAuth(req("owner-jwt", { origin: "https://evil.invalid" }), deps)
  );
  const res = await handleOAuth(req("owner-jwt"), deps),
    body = await res.json();
  const redirect = new URL(body.redirect_uri);
  assert.equal(redirect.origin, "https://oauth-redirect.googleusercontent.com");
  assert.equal(redirect.searchParams.get("state"), "fixture-state");
  assert.equal(redirect.searchParams.get("iss"), origin);
  assert.ok(redirect.searchParams.get("code"));
  assert.equal(redirect.searchParams.get("access_token"), null);
});
Deno.test("token exchange returns opaque isolated credentials with a bounded TTL", async () => {
  const deps = fixture((op, input) => {
    assert.equal(op, "exchange_code");
    assert.match(String(input.code_hash), /^[a-f0-9]{64}$/);
    assert.equal(input.resource, origin + "/api/advisory-mcp");
    return {
      grant_id: "g",
      scopes: ["evidence:read"],
      grant_expires_at: "2026-10-23T00:10:00Z",
    };
  });
  const res = await handleOAuth(
    new Request(origin + "/api/advisory-oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: "fixture-client",
        client_secret: "s".repeat(43),
        grant_type: "authorization_code",
        code: "c".repeat(43),
        code_verifier: "v".repeat(43),
        resource: origin + "/api/advisory-mcp",
        redirect_uri: callback,
      }),
    }),
    deps,
  );
  const body = await res.json();
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.expires_in, 600);
  assert.match(body.access_token, /^rgmcp_/);
  assert.equal(body.scope, "evidence:read");
});
Deno.test("connector bearer cannot be substituted with an admin JWT or wrong scope", async () => {
  const deps = fixture((op) => {
    assert.equal(op, "access_context");
    return {
      grant_id: "g",
      owner_id: owner,
      scopes: ["evidence:read"],
      allow_images: false,
      expires_at: "2026-10-24T00:00:00Z",
    };
  });
  await assert.rejects(() =>
    requireGrant(
      new Request(origin, { headers: { authorization: "Bearer owner-jwt" } }),
      "evidence:read",
      deps,
    )
  );
  await assert.rejects(() =>
    requireGrant(
      new Request(origin, {
        headers: { authorization: "Bearer rgmcp_" + "a".repeat(43) },
      }),
      "advisory:submit",
      deps,
    )
  );
  const ctx = await requireGrant(
    new Request(origin, {
      headers: { authorization: "Bearer rgmcp_" + "a".repeat(43) },
    }),
    "evidence:read",
    deps,
  );
  assert.equal(ctx.owner_id, owner);
});
