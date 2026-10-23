import assert from "node:assert/strict";
import { handleAdvisoryMedia } from "../../_shared/geminiConnector/completion.ts";
const job = {
  id: "11111111-0000-4000-8000-000000000001",
  survey_id: "22222222-0000-4000-8000-000000000001",
  run_id: "rg-synthetic1234",
  provider: "kaggle_yolo26",
  result_manifest: { schema_version: "riceguard.result.v2" },
};
const catalogue = {
  schema_version: "riceguard.advisory.catalogue.v1",
  policy_version: "visual-v1",
  survey_id: job.survey_id,
  job_id: job.id,
  result_revision: 1,
  entries: ["original", "combined"].map((variant) => ({
    source_asset_id: "33333333-0000-4000-8000-000000000001",
    image_index: 1,
    variant,
    source_sha256: "a".repeat(64),
    path:
      `website-inference/v2/jobs/${job.run_id}/outputs/advisory-media/visual-v1/33333333-0000-4000-8000-000000000001/${variant}.jpg`,
    sha256: "b".repeat(64),
    bytes: 123,
    width: 100,
    height: 80,
    quality: 85,
  })),
};
function fixture(failVerify = false) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      rpc: async (
        name: string,
        args: { p_operation: string; p_input: unknown },
      ) => {
        calls.push(args.p_operation);
        if (args.p_operation === "validate_catalogue") {
          return {
            data: { valid: true },
            error: null,
          };
        }
        if (args.p_operation === "save_catalogue") {
          return {
            data: {
              stored: true,
              duplicate: false,
              catalogue_sha256: "c".repeat(64),
            },
            error: null,
          };
        }
        if (name === "rg_mcp_event_store") {
          return {
            data: {
              event_id: null,
              status: "awaiting_authorization",
              duplicate: false,
            },
            error: null,
          };
        }
        throw new Error("unexpected");
      },
      control: async (
        payload: { action: string; artifacts: Record<string, unknown> },
      ) => {
        calls.push(payload.action);
        if (payload.action === "verify-pinned-artifacts") {
          return {
            verified: !failVerify,
            artifact_count: Object.keys(payload.artifacts).length,
          };
        }
        return {
          private_uploads: Object.fromEntries(
            Object.keys(payload.artifacts).map(
              (p) => [p, "https://storage.example.test/private"],
            ),
          ),
        };
      },
    },
  };
}
Deno.test("prepare validates current source before requesting any private PUT URL", async () => {
  const f = fixture();
  const result = await handleAdvisoryMedia("prepare-advisory-media", job, {
    catalogue,
  }, f.deps);
  assert.equal(Object.keys(result.private_uploads as object).length, 2);
  assert.deepEqual(f.calls, ["validate_catalogue", "signed-pinned-uploads"]);
});
Deno.test("completion independently verifies storage before private save and readiness event", async () => {
  const f = fixture();
  const result = await handleAdvisoryMedia("complete-advisory-media", job, {
    catalogue,
  }, f.deps);
  assert.equal(result.stored, true);
  assert.deepEqual(f.calls, [
    "validate_catalogue",
    "verify-pinned-artifacts",
    "save_catalogue",
    "enqueue_ready",
  ]);
});
Deno.test("bad proof never saves catalogue or enqueues an event", async () => {
  const f = fixture(true);
  await assert.rejects(() =>
    handleAdvisoryMedia("complete-advisory-media", job, { catalogue }, f.deps)
  );
  assert.deepEqual(f.calls, ["validate_catalogue", "verify-pinned-artifacts"]);
});
Deno.test("optional event notification follows private persistence and cannot fail completed inference", async () => {
  const eventId = "55555555-0000-4000-8000-000000000001";
  const f = fixture();
  const original = f.deps.rpc;
  const deps = {
    ...f.deps,
    rpc: async (
      name: string,
      args: { p_operation: string; p_input: unknown },
    ) =>
      args.p_operation === "enqueue_ready"
        ? (f.calls.push(args.p_operation), {
          data: { event_id: eventId, status: "pending", duplicate: false },
          error: null,
        })
        : original(name, args),
    notify: async (id: string) => {
      assert.equal(id, eventId);
      f.calls.push("notice");
      throw new Error("transport detail");
    },
  };
  const result = await handleAdvisoryMedia("complete-advisory-media", job, {
    catalogue,
  }, deps);
  assert.equal(result.stored, true);
  assert.deepEqual(result.notification, { status: "unavailable" });
  assert.deepEqual(f.calls, [
    "validate_catalogue",
    "verify-pinned-artifacts",
    "save_catalogue",
    "enqueue_ready",
    "notice",
  ]);
  const g = fixture();
  let sent = false;
  await handleAdvisoryMedia("complete-advisory-media", job, { catalogue }, {
    ...g.deps,
    notify: async () => {
      sent = true;
      return { status: "notified" };
    },
  });
  assert.equal(sent, false);
});
Deno.test("foreign job, malformed receipt and incomplete native result never sign", async () => {
  for (
    const change of [{
      ...catalogue,
      job_id: "44444444-0000-4000-8000-000000000001",
    }, { ...catalogue, entries: [{ ...catalogue.entries[0], bytes: 786433 }] }]
  ) {
    const f = fixture();
    await assert.rejects(() =>
      handleAdvisoryMedia(
        "prepare-advisory-media",
        job,
        { catalogue: change },
        f.deps,
      )
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(() =>
    handleAdvisoryMedia(
      "prepare-advisory-media",
      { ...job, result_manifest: null },
      { catalogue },
      f.deps,
    )
  );
  assert.equal(f.calls.length, 0);
});
