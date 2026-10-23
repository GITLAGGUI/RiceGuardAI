import assert from "node:assert/strict";
import { resolveReadyEvent } from "../../_shared/geminiConnector/readyEvents.ts";
import type {
  ConnectorStore,
  GrantContext,
} from "../../_shared/geminiConnector/contracts.ts";
const ctx: GrantContext = {
  grant_id: "g",
  owner_id: "o",
  allow_images: true,
  scopes: ["evidence:read"],
  expires_at: "2026-11-01T00:00:00Z",
};
const id = "11111111-0000-4000-8000-000000000001";
Deno.test("event hint resolves only through scoped persistence and private fields are not exported", async () => {
  const raw = {
    event_id: id,
    survey_id: id,
    job_id: id,
    result_revision: 1,
    policy_version: "visual-v1",
    catalogue_sha256: "a".repeat(64),
    status: "pending",
    private_path: "PRIVATE",
    phone: "PRIVATE",
  };
  const store = {
    execute: async (op: unknown) => {
      assert.deepEqual(op, {
        op: "resolve_ready_event",
        input: { grant_id: "g", event_id: id },
      });
      return raw;
    },
  } as unknown as ConnectorStore;
  assert.equal(
    JSON.stringify(await resolveReadyEvent(ctx, id, store)).includes("PRIVATE"),
    false,
  );
  await assert.rejects(() =>
    resolveReadyEvent({ ...ctx, allow_images: false }, id, store)
  );
  await assert.rejects(() =>
    resolveReadyEvent(ctx, "https://evil.invalid", store)
  );
});
