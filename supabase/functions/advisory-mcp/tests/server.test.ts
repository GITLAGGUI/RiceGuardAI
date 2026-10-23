import assert from "node:assert/strict";
import { createConnectorHandler } from "../../_shared/geminiConnector/server.ts";
import type { ConnectorDeps } from "../../_shared/geminiConnector/contracts.ts";
const origin = "https://riceguardai.dev";
const deps: ConnectorDeps = {
  origin,
  ownerId: "owner",
  now: () => new Date("2026-10-23T00:00:00Z"),
  randomToken: () => "a".repeat(43),
  verifyAdmin: async () => {
    throw new Error("no owner");
  },
  media: { read: async () => [] },
  store: {
    execute: async ({ op }) => {
      if (op === "access_context") {
        return {
          grant_id: "g",
          owner_id: "owner",
          scopes: ["evidence:read", "advisory:submit"],
          allow_images: false,
          expires_at: "2026-10-24T00:00:00Z",
        };
      }
      if (op === "rate_limit") return { allowed: true, retry_after_seconds: 0 };
      if (op === "queue_summary") {
        return {
          ready: 1,
          awaiting: 0,
          returned: 0,
          checked_at: "2026-10-23T00:00:00Z",
        };
      }
      throw new Error("Unexpected side effect");
    },
  } as ConnectorDeps["store"],
};
const handler = createConnectorHandler(deps);
const token = "rgmcp_" + "a".repeat(43);
async function rpc(method: string, params: unknown = {}, target = handler) {
  const res = await target(
    new Request(origin + "/api/advisory-mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  assert.equal(res.headers.get("cache-control"), "no-store");
  return res;
}
Deno.test("discovery is canonical JSON and anonymous MCP gets a real challenge", async () => {
  const meta = await handler(
    new Request(
      "https://untrusted.invalid/.well-known/oauth-protected-resource/api/advisory-mcp",
    ),
  );
  assert.equal((await meta.json()).resource, origin + "/api/advisory-mcp");
  const res = await handler(
    new Request(origin + "/api/advisory-mcp", { method: "POST", body: "{}" }),
  );
  assert.equal(res.status, 401);
  assert.ok(
    res.headers.get("www-authenticate")?.includes(
      origin + "/.well-known/oauth-protected-resource/api/advisory-mcp",
    ),
  );
  const unknown = await handler(new Request(origin + "/api/typo"));
  assert.equal(unknown.status, 404);
  assert.equal(
    unknown.headers.get("content-type")?.startsWith("application/json"),
    true,
  );
});
Deno.test("only four intended tools are advertised with honest write annotation", async () => {
  const res = await rpc("tools/list"), body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(
    body.result.tools.map((t: { name: string }) => t.name).sort(),
    [
      "advisory_queue_summary",
      "get_advisory_evidence",
      "list_ready_evidence",
      "submit_advisory",
    ].sort(),
  );
  assert.equal(
    body.result.tools.find((t: { name: string }) =>
      t.name === "submit_advisory"
    ).annotations.readOnlyHint,
    false,
  );
});
Deno.test("queue tool returns only the scoped summary and invalid origins/payloads fail", async () => {
  const res = await rpc("tools/call", {
      name: "advisory_queue_summary",
      arguments: {},
    }),
    body = await res.json();
  assert.equal(JSON.parse(body.result.content[0].text).ready, 1);
  const blocked = await handler(
    new Request(origin + "/api/advisory-mcp", {
      method: "POST",
      headers: { origin: "https://evil.invalid" },
      body: "{}",
    }),
  );
  assert.equal(blocked.status, 403);
  const oversized = await handler(
    new Request(origin + "/api/advisory-mcp", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
      body: "x".repeat(32769),
    }),
  );
  assert.equal(oversized.status, 413);
});
Deno.test("visual mode advertises one extra read-only batch tool without weakening write confirmation", async () => {
  const visual = {
    catalogue: async () => {
      throw new Error("not requested");
    },
    read: async () => {
      throw new Error("not requested");
    },
    assertDelivered: async () => {
      throw new Error("not requested");
    },
  };
  const target = createConnectorHandler({ ...deps, visual });
  const body = await (await rpc("tools/list", {}, target)).json();
  assert.equal(body.result.tools.length, 5);
  assert.equal(
    body.result.tools.find((t: { name: string }) =>
      t.name === "get_advisory_image_batch"
    ).annotations.readOnlyHint,
    true,
  );
  assert.equal(
    body.result.tools.find((t: { name: string }) =>
      t.name === "submit_advisory"
    ).annotations.readOnlyHint,
    false,
  );
});
Deno.test("event resolution is advertised only when separately configured and remains read-only", async () => {
  const target = createConnectorHandler({
    ...deps,
    events: {
      resolve: async () => {
        throw new Error("not requested");
      },
    },
  });
  const body = await (await rpc("tools/list", {}, target)).json();
  assert.equal(body.result.tools.length, 5);
  const tool = body.result.tools.find((t: { name: string }) =>
    t.name === "resolve_advisory_event"
  );
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(
    body.result.tools.find((t: { name: string }) =>
      t.name === "submit_advisory"
    ).annotations.readOnlyHint,
    false,
  );
});

Deno.test("image batches keep pagination and both labels in one text block before images", async () => {
  const key = {
    survey_id: "11111111-0000-4000-8000-000000000001",
    job_id: "33333333-0000-4000-8000-000000000001",
    result_revision: 1,
    catalogue_sha256: "a".repeat(64),
    offset: 0,
  };
  const images = (["original", "combined"] as const).map((variant) => ({
    image_id: `fixture:${variant}`,
    source_asset_id: "55555555-0000-4000-8000-000000000001",
    image_index: 1,
    variant,
    sha256: "b".repeat(64),
    width: 1,
    height: 1,
    mimeType: "image/jpeg" as const,
    data: "aW1hZ2U=",
  }));
  const target = createConnectorHandler({ ...deps, visual: {
    catalogue: async () => { throw new Error("not requested"); },
    assertDelivered: async () => { throw new Error("not requested"); },
    read: async () => ({ ...key, expected_images: 8, next_offset: 2, images }),
  } });
  const body = await (await rpc("tools/call", {
    name: "get_advisory_image_batch", arguments: key,
  }, target)).json();
  const content = body.result.content;
  assert.deepEqual(content.map((c: {type: string}) => c.type), ["text", "image", "image"]);
  const metadata = JSON.parse(content[0].text);
  assert.equal(metadata.next_offset, 2);
  assert.deepEqual(metadata.images.map((i: {variant: string}) => i.variant), ["original", "combined"]);
  assert.equal(metadata.images.some((i: Record<string, unknown>) => "data" in i), false);
  assert.equal(content[1].data, images[0].data);
  assert.equal(content[2].data, images[1].data);
});
