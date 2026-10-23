// Local only: --allow-net=127.0.0.1 --allow-run=node. No deployment or live Supabase.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import type { ConnectorDeps } from "../../_shared/geminiConnector/contracts.ts";
import { createConnectorStore } from "../../_shared/geminiConnector/store.ts";
import { createConnectorHandler } from "../../_shared/geminiConnector/server.ts";
import { pkce, randomToken } from "../../_shared/geminiConnector/policy.ts";
import { requireGrant } from "../../_shared/geminiConnector/oauth.ts";

const origin = "https://riceguardai.dev";
const resource = origin + "/api/advisory-mcp";
const ownerId = "aaaaaaaa-0000-4000-8000-000000000001";
const key = {
  survey_id: "11111111-0000-4000-8000-000000000001",
  job_id: "22222222-0000-4000-8000-000000000001",
  result_revision: 1,
};
const sourceId = "33333333-0000-4000-8000-000000000001";
const callback =
  "https://oauth-redirect.googleusercontent.com/r/synthetic-riceguard-connector";

async function startBridge() {
  const script = fileURLToPath(
    new URL(
      "../../../../frontend/qa/gemini-connector-smoke-server.mjs",
      import.meta.url,
    ),
  );
  const child = new Deno.Command("node", {
    args: [script, "--fixture-server"],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ready = await Promise.race([
      (async () => {
        let line = "";
        while (!line.includes("\n") && line.length < 2048) {
          const part = await reader.read();
          if (part.done) {
            throw new Error("Synthetic bridge exited before readiness");
          }
          line += new TextDecoder().decode(part.value);
        }
        const data = JSON.parse(line.split("\n")[0]);
        const url = new URL(data.url);
        assert.equal(url.hostname, "127.0.0.1");
        assert.equal(url.protocol, "http:");
        return url.origin;
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Synthetic bridge readiness timed out")),
          45000,
        );
      }),
    ]);
    reader.releaseLock();
    return {
      url: ready,
      close: async () => {
        try {
          child.kill("SIGTERM");
        } catch { /* Already stopped. */ }
        await child.output();
      },
    };
  } catch (error) {
    await reader.cancel();
    reader.releaseLock();
    try {
      child.kill("SIGTERM");
    } catch { /* Already stopped. */ }
    await child.output();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type FixtureState = {
  protected_rows: Record<string, unknown[]>;
  submissions: {
    id: string;
    grant_id: string;
    survey_id: string;
    job_id: string;
    result_revision: number;
    configured_task_model: string | null;
  }[];
  operations: string[];
};
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}
function toolData(body: unknown) {
  const message = object(body);
  assert.equal(message.error, undefined);
  const result = object(message.result);
  assert.notEqual(result.isError, true);
  if (result.structuredContent) return object(result.structuredContent);
  assert.ok(Array.isArray(result.content));
  const item = result.content.find((part: JsonObject) => part.type === "text");
  assert.ok(item && typeof item.text === "string");
  return object(JSON.parse(item.text));
}

Deno.test("real private PostgreSQL round trip through OAuth and MCP handlers", async () => {
  const bridge = await startBridge();
  try {
    const state = async (): Promise<FixtureState> => {
      const response = await fetch(bridge.url + "/test-state");
      assert.equal(response.status, 200);
      return response.json();
    };
    const before = await state();
    const deps: ConnectorDeps = {
      origin,
      ownerId,
      now: () => new Date(),
      randomToken,
      // This replaces Supabase identity verification only for this synthetic test.
      // It is not evidence of working live login, token validation, AAL2 or Gemini consent.
      verifyAdmin: async (jwt) => {
        if (jwt !== "synthetic-owner-session") {
          throw new Error("Synthetic owner required");
        }
        return { id: ownerId, role: "admin", is_active: true, aal: "aal2" };
      },
      media: { read: async () => [] },
      store: createConnectorStore({
        rpc: async (_name, args) => {
          const response = await fetch(bridge.url + "/rpc", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(args),
          });
          assert.equal(response.status, 200);
          return response.json();
        },
      }),
    };
    const handler = createConnectorHandler(deps);
    const owner = async (action: string, input: unknown) =>
      handler(
        new Request(origin + "/api/advisory-oauth/owner/" + action, {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-owner-session",
            origin,
            "content-type": "application/json",
          },
          body: JSON.stringify(input),
        }),
      );
    const registered = await owner("register-client", {
      client_name: "RiceGuardAI Advisory synthetic fixture",
      redirect_uri: callback,
    });
    assert.equal(registered.status, 201);
    const client = await registered.json();
    assert.equal(typeof client.client_secret, "string");
    const verifier = randomToken();
    const authorize = await handler(
      new Request(
        origin + "/api/advisory-oauth/authorize?" + new URLSearchParams({
          response_type: "code",
          client_id: client.client_id,
          redirect_uri: callback,
          resource,
          scope: "evidence:read advisory:submit",
          state: "synthetic-round-trip-state",
          code_challenge_method: "S256",
          code_challenge: await pkce(verifier),
        }),
      ),
    );
    assert.equal(authorize.status, 303);
    const requestId = new URL(authorize.headers.get("location")!).searchParams
      .get("request");
    assert.ok(requestId);
    const preview = await owner("preview", { request_id: requestId });
    assert.equal(preview.status, 200);
    const consentPreview = await preview.json();
    assert.deepEqual(consentPreview.scopes, [
      "evidence:read",
      "advisory:submit",
    ]);
    assert.ok(
      consentPreview.eligible_surveys.some((survey: { id: string }) =>
        survey.id === key.survey_id
      ),
    );
    assert.equal((await state()).submissions.length, 0);
    const consent = await owner("consent", {
      request_id: requestId,
      decision: "allow",
      survey_ids: [key.survey_id],
      allow_images: false,
    });
    assert.equal(consent.status, 200);
    const redirect = new URL((await consent.json()).redirect_uri);
    assert.equal(
      redirect.origin,
      "https://oauth-redirect.googleusercontent.com",
    );
    assert.equal(
      redirect.searchParams.get("state"),
      "synthetic-round-trip-state",
    );
    assert.equal(redirect.searchParams.get("iss"), origin);
    const code = redirect.searchParams.get("code");
    assert.ok(code);
    const tokenResponse = await handler(
      new Request(origin + "/api/advisory-oauth/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          client_secret: client.client_secret,
          code,
          code_verifier: verifier,
          redirect_uri: callback,
          resource,
        }),
      }),
    );
    assert.equal(tokenResponse.status, 200);
    const token = await tokenResponse.json();
    assert.match(token.access_token, /^rgmcp_[A-Za-z0-9_-]{43}$/);
    const bearerRequest = () =>
      new Request(resource, {
        headers: { authorization: "Bearer " + token.access_token },
      });
    const context = await requireGrant(bearerRequest(), "evidence:read", deps);
    assert.equal(context.owner_id, ownerId);
    assert.equal(context.allow_images, false);
    let id = 0;
    const rpc = async (method: string, params: unknown) => {
      const response = await handler(
        new Request(resource, {
          method: "POST",
          headers: {
            authorization: "Bearer " + token.access_token,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-03-26",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        }),
      );
      assert.equal(response.status, 200);
      return response.json();
    };
    const initialized = object(
      await rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "synthetic-riceguard-db-round-trip", version: "1" },
      }),
    );
    assert.equal(object(initialized.result).protocolVersion, "2025-03-26");
    const tools = object(object(await rpc("tools/list", {})).result).tools;
    assert.ok(Array.isArray(tools));
    assert.deepEqual(tools.map((tool) => object(tool).name).sort(), [
      "advisory_queue_summary",
      "get_advisory_evidence",
      "list_ready_evidence",
      "submit_advisory",
    ]);
    const summary = toolData(
      await rpc("tools/call", {
        name: "advisory_queue_summary",
        arguments: {},
      }),
    );
    assert.equal(summary.ready, 1);
    const read = toolData(
      await rpc("tools/call", {
        name: "get_advisory_evidence",
        arguments: key,
      }),
    );
    const packet = object(read.packet ?? read);
    assert.equal(packet.schema_version, "riceguard.gemini.evidence.v1");
    assert.equal(packet.survey_id, key.survey_id);
    assert.equal(packet.images_status, "not_permitted");
    assert.match(String(packet.evidence_sha256), /^[a-f0-9]{64}$/);
    const submission = {
      ...key,
      evidence_sha256: packet.evidence_sha256,
      idempotency_key: "synthetic-handler-round-trip-01",
      summary:
        "Synthetic test lang: kailangan pa ng aktuwal na field inspection.",
      recommended_actions: [
        "Synthetic fixture only; ipa-review muna sa agricultural specialist.",
      ],
      limitations: [
        "AI-generated; hindi pa na-review ng agricultural specialist.",
      ],
      source_ids: [sourceId],
      research_citations: [],
    };
    const saved = toolData(
      await rpc("tools/call", {
        name: "submit_advisory",
        arguments: submission,
      }),
    );
    assert.equal(saved.status, "stored_private");
    assert.equal(saved.duplicate, false);
    assert.equal(saved.public_post_created, false);
    assert.equal(saved.sms_enqueued, false);
    const repeated = toolData(
      await rpc("tools/call", {
        name: "submit_advisory",
        arguments: submission,
      }),
    );
    assert.equal(repeated.submission_id, saved.submission_id);
    assert.equal(repeated.duplicate, true);
    const after = await state();
    assert.equal(after.submissions.length, 1);
    assert.equal(after.submissions[0].id, saved.submission_id);
    assert.equal(after.submissions[0].survey_id, key.survey_id);
    assert.equal(after.submissions[0].configured_task_model, null);
    assert.deepEqual(after.protected_rows, before.protected_rows);
    assert.ok(after.operations.includes("exchange_code"));
    assert.ok(after.operations.includes("read_evidence"));
    assert.ok(after.operations.includes("save_submission"));
    const revoked = await owner("revoke", { grant_id: context.grant_id });
    assert.equal(revoked.status, 200);
    await assert.rejects(() =>
      requireGrant(bearerRequest(), "evidence:read", deps)
    );
    const denied = await handler(
      new Request(resource, {
        method: "POST",
        headers: {
          authorization: "Bearer " + token.access_token,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 100,
          method: "tools/list",
          params: {},
        }),
      }),
    );
    assert.equal(denied.status, 401);
    await denied.body?.cancel();
    assert.deepEqual((await state()).protected_rows, before.protected_rows);
  } finally {
    await bridge.close();
  }
});
