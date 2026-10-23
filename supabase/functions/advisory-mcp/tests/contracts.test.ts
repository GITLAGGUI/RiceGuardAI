import assert from "node:assert/strict";
import { parseSubmission } from "../../_shared/geminiConnector/contracts.ts";
import {
  assertConnectorOwner,
  connectorMetadata,
  productionOrigin,
} from "../../_shared/geminiConnector/policy.ts";

const now = new Date("2026-10-23T00:00:00Z");
const owner = "aaaaaaaa-0000-4000-8000-000000000001";
const valid = {
  survey_id: "11111111-0000-4000-8000-000000000001",
  job_id: "33333333-0000-4000-8000-000000000001",
  result_revision: 1,
  evidence_sha256: "a".repeat(64),
  idempotency_key: "fixture-submission-01",
  summary: "Controlled connection fixture. Hindi ito tunay na payo sa palayan.",
  recommended_actions: ["Check the controlled fixture only."],
  limitations: ["Hindi pa ito na-review ng specialist."],
  source_ids: ["77777777-0000-4000-8000-000000000001"],
  research_citations: [{
    title: "Reference fixture",
    url: "https://www.philrice.gov.ph/",
    supporting_claim: "Reference used only for connection testing.",
    retrieved_at: "2026-10-23T00:00:00Z",
  }],
};
Deno.test("submission keeps valid private revision binding and normalized wording", () => {
  const saved = parseSubmission(
    { ...valid, summary: "  Test fixture.  " },
    now,
  );
  assert.equal(saved.summary, "Test fixture.");
  assert.equal(saved.result_revision, 1);
  assert.equal(saved.evidence_sha256, "a".repeat(64));
});
Deno.test("malformed, missing, oversized and unknown submission fields fail closed", () => {
  for (
    const change of [
      { result_revision: 0 },
      { evidence_sha256: "fake" },
      { source_ids: [] },
      { unexpected_private_field: "secret" },
      { summary: "x".repeat(3001) },
      { recommended_actions: [] },
      { survey_id: "../../contacts" },
      { idempotency_key: "short" },
    ]
  ) {
    assert.throws(() => parseSubmission({ ...valid, ...change }, now));
  }
});
Deno.test("research rejects insecure URL and future retrieval beyond five minutes", () => {
  for (
    const change of [
      { url: "http://unsafe.invalid/" },
      { url: "https://user:password@example.com/" },
      { retrieved_at: "2026-10-23T00:05:01Z" },
      { supporting_claim: "x".repeat(601) },
    ]
  ) {
    assert.throws(() =>
      parseSubmission({
        ...valid,
        research_citations: [{ ...valid.research_citations[0], ...change }],
      }, now)
    );
  }
});
Deno.test("only a configured active MFA owner can approve connector access", () => {
  const admin = {
    id: owner,
    role: "admin" as const,
    is_active: true as const,
    aal: "aal2" as const,
  };
  assert.doesNotThrow(() => assertConnectorOwner(admin, owner));
  for (
    const change of [
      { aal: "aal1" },
      { is_active: false },
      { role: "farmer" },
      { id: valid.survey_id },
    ]
  ) {
    assert.throws(() =>
      assertConnectorOwner({ ...admin, ...change } as never, owner)
    );
  }
  assert.throws(() => assertConnectorOwner(admin, ""));
});
Deno.test("fixed secure origin produces resource-bound OAuth discovery", () => {
  assert.throws(() => productionOrigin("http://riceguardai.dev"));
  assert.throws(() => productionOrigin("https://user:secret@riceguardai.dev"));
  const meta = connectorMetadata("https://riceguardai.dev");
  assert.equal(
    meta.resource.resource,
    "https://riceguardai.dev/api/advisory-mcp",
  );
  assert.equal(
    meta.authorization.token_endpoint,
    "https://riceguardai.dev/api/advisory-oauth/token",
  );
  assert.deepEqual(meta.authorization.code_challenge_methods_supported, [
    "S256",
  ]);
  assert.equal("registration_endpoint" in meta.authorization, false);
});
