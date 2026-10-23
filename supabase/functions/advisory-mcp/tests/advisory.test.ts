import assert from "node:assert/strict";
import { submitAdvisory } from "../../_shared/geminiConnector/advisory.ts";
import { readEvidence } from "../../_shared/geminiConnector/evidence.ts";
import type {
  ConnectorDeps,
  GrantContext,
} from "../../_shared/geminiConnector/contracts.ts";
const key = {
  survey_id: "11111111-0000-4000-8000-000000000001",
  job_id: "33333333-0000-4000-8000-000000000001",
  result_revision: 1,
};
const source = "77777777-0000-4000-8000-000000000001";
const ctx: GrantContext = {
  grant_id: "g",
  owner_id: "o",
  scopes: ["evidence:read", "advisory:submit"],
  allow_images: false,
  expires_at: "2026-11-01T00:00:00Z",
};
const internal = {
  revision: {
    ...key,
    revision: 1,
    manifest: {
      assets: [{
        kind: "image",
        diseases: [{
          disease: "BLB",
          status: "detected",
          predicted_pixels: 10,
          mask_meaning: "disease_region",
        }],
      }],
    },
    blb_model_version: "fixture",
    brown_spot_model_version: "fixture",
  },
  job: {},
  survey: {},
  guidance: [{
    id: source,
    disease: "BLB",
    title: "Controlled reference",
    version: "1",
    source_reference: "https://www.philrice.gov.ph/",
    guidance: {
      recommended_actions: ["Test only."],
      limitations: ["Fixture."],
    },
  }],
  evidence_binding_sha256: "b".repeat(64),
};
function deps(): ConnectorDeps {
  return {
    origin: "https://riceguardai.dev",
    ownerId: "o",
    now: () => new Date("2026-10-23T00:00:00Z"),
    randomToken: () => "",
    verifyAdmin: async () => {
      throw new Error();
    },
    media: { read: async () => [] },
    store: {
      execute: async ({ op, input }) => {
        if (op === "read_evidence") return internal;
        if (op === "save_submission" || op === "save_visual_submission") {
          assert.equal(input.evidence_binding_sha256, "b".repeat(64));
          return {
            submission_id: "receipt",
            status: "stored_private",
            duplicate: false,
            public_post_created: false,
            sms_enqueued: false,
          };
        }
        throw new Error("No publishing/SMS operations allowed");
      },
    } as ConnectorDeps["store"],
  };
}
Deno.test("stores only a bound private advisory; stale digest and invented sources fail", async () => {
  const d = deps(), { packet } = await readEvidence(ctx, key, d);
  const execute = d.store.execute.bind(d.store);
  d.store.execute = (async (operation) => {
    if (operation.op === "save_submission") {
      assert.ok(
        operation.input.payload.limitations.includes(
          "AI-generated; hindi pa na-review ng agricultural specialist.",
        ),
      );
    }
    return execute(operation);
  }) as typeof d.store.execute;
  const raw = {
    ...key,
    evidence_sha256: packet.evidence_sha256,
    idempotency_key: "controlled-advisory-01",
    summary: "Controlled fixture only.",
    recommended_actions: ["Inspect the fixture only."],
    limitations: ["AI-generated; hindi pa na-review ng specialist."],
    source_ids: [source],
    research_citations: [],
  };
  assert.equal((await submitAdvisory(ctx, raw, d)).status, "stored_private");
  assert.equal(
    (await submitAdvisory(ctx, {
      ...raw,
      limitations: Array.from({ length: 8 }, (_, i) => "Limitation " + i),
    }, d)).status,
    "stored_private",
  );
  await assert.rejects(() =>
    submitAdvisory(ctx, { ...raw, evidence_sha256: "0".repeat(64) }, d)
  );
  await assert.rejects(() =>
    submitAdvisory(ctx, {
      ...raw,
      source_ids: ["88888888-0000-4000-8000-000000000001"],
    }, d)
  );
});
Deno.test("visual saving requires server-recorded delivery of the current complete catalogue", async () => {
  const d = deps(), visualCtx = { ...ctx, allow_images: true };
  let allowed = false;
  d.visual = {
    catalogue: async () => ({
      catalogue_sha256: "d".repeat(64),
      expected_images: 2,
      images: [],
    }),
    read: async () => {
      throw new Error("not requested");
    },
    assertDelivered: async (_ctx, key) => {
      assert.equal(key.catalogue_sha256, "d".repeat(64));
      if (!allowed) throw new Error("Missing served images");
    },
  };
  const { packet } = await readEvidence(visualCtx, key, d);
  const raw = {
    ...key,
    evidence_sha256: packet.evidence_sha256,
    idempotency_key: "visual-fixture-only-01",
    summary: "Controlled fixture only.",
    recommended_actions: ["Inspect the fixture only."],
    limitations: ["Fixture."],
    source_ids: [source],
    research_citations: [],
  };
  await assert.rejects(() => submitAdvisory(visualCtx, raw, d));
  allowed = true;
  const execute = d.store.execute.bind(d.store);
  d.store.execute = (async (operation) => {
    if (operation.op !== "read_evidence") {
      assert.equal(operation.op, "save_visual_submission");
      assert.equal(operation.input.catalogue_sha256, "d".repeat(64));
      assert.equal(operation.input.policy_version, "visual-v1");
    }
    return execute(operation);
  }) as typeof d.store.execute;
  assert.equal(
    (await submitAdvisory(visualCtx, raw, d)).status,
    "stored_private",
  );
});
