import assert from "node:assert/strict";
import { createConnectorStore } from "../../_shared/geminiConnector/store.ts";
import type { StoreInputMap } from "../../_shared/geminiConnector/store.ts";

const input: StoreInputMap["save_visual_submission"] = {
  grant_id: "fixture-grant",
  survey_id: "11111111-0000-4000-8000-000000000001",
  job_id: "22222222-0000-4000-8000-000000000001",
  result_revision: 1,
  evidence_sha256: "a".repeat(64),
  evidence_binding_sha256: "b".repeat(64),
  catalogue_sha256: "c".repeat(64),
  policy_version: "visual-v1",
  idempotency_key: "fixture-caller-key-01",
  payload_sha256: "d".repeat(64),
  payload: {
    survey_id: "11111111-0000-4000-8000-000000000001",
    job_id: "22222222-0000-4000-8000-000000000001",
    result_revision: 1,
    evidence_sha256: "a".repeat(64),
    idempotency_key: "fixture-caller-key-01",
    summary: "Fixture.",
    recommended_actions: ["Inspect fixture."],
    limitations: ["Fixture only."],
    source_ids: ["33333333-0000-4000-8000-000000000001"],
    research_citations: [],
  },
};
const receipt = {
  submission_id: "stable-receipt",
  status: "stored_private" as const,
  duplicate: true,
  public_post_created: false as const,
  sms_enqueued: false as const,
};
Deno.test("visual saves reach the atomic wrapper while legacy saves keep the manual RPC", async () => {
  const calls: { name: string; op: string }[] = [];
  const store = createConnectorStore({
    rpc: (name, args) => {
      calls.push({ name, op: args.p_operation });
      assert.deepEqual(args.p_input, input);
      return Promise.resolve({ data: receipt, error: null });
    },
  });
  assert.deepEqual(
    await store.execute({ op: "save_visual_submission", input }),
    receipt,
  );
  assert.deepEqual(
    await store.execute({ op: "save_submission", input }),
    receipt,
  );
  assert.deepEqual(calls, [
    { name: "rg_mcp_visual_submission_store", op: "save_submission" },
    { name: "rg_mcp_store", op: "save_submission" },
  ]);
});
Deno.test("visual submission failures never expose database details", async () => {
  const store = createConnectorStore({
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { message: "private owner payload" },
      }),
  });
  await assert.rejects(
    () => store.execute({ op: "save_visual_submission", input }),
    (error: Error) => error.message === "Connector operation denied",
  );
});
