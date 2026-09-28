import { createOpenAiAdvisory, extractCitedSources, isTrustedCandidateUrl } from "./openai-advisory.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const approvedSource = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Specialist-reviewed BLB guidance",
  version: "reviewed-v1",
  reference: "https://www.philrice.gov.ph/",
  guidance: { recommended_actions: ["Verify suspected symptoms in the field."] },
};

Deno.test("accepts official HTTPS candidate URLs but rejects lookalikes and credentials", () => {
  assert(isTrustedCandidateUrl("https://www.philrice.gov.ph/rice-diseases"), "official subdomain");
  assert(isTrustedCandidateUrl("https://pagasa.dost.gov.ph/agri-weather"), "PAGASA");
  assert(!isTrustedCandidateUrl("http://philrice.gov.ph/insecure"), "HTTP must be rejected");
  assert(!isTrustedCandidateUrl("https://philrice.gov.ph.evil.example/page"), "suffix spoofing");
  assert(!isTrustedCandidateUrl("https://attacker@philrice.gov.ph/page"), "URL credentials");
  assert(!isTrustedCandidateUrl("javascript:alert(1)"), "non-web URL");
});

Deno.test("candidate evidence is derived from URL annotations, not model-written text", () => {
  const candidates = extractCitedSources({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: "Model output mentions https://example.com but only annotations count.",
        annotations: [
          { type: "url_citation", url: "https://philrice.gov.ph/sample", title: "Sample" },
          { type: "url_citation", url: "https://philrice.gov.ph/sample", title: "Duplicate" },
          { type: "url_citation", url: "https://example.com/unsafe", title: "Untrusted" },
        ],
      }],
    }],
  });
  assert(candidates.length === 1, "only one unique official cited URL should remain");
  assert(candidates[0].approval_status === "candidate", "new links cannot become reviewed guidance");
  assert(candidates[0].published_at === null, "publication date cannot be invented");
});

Deno.test("OpenAI drafts reject recommended actions without an approved source ID", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({
          summary: "BLB requires field verification.",
          recommended_actions: [{ text: "Apply an unsourced treatment.", source_id: "made-up-id" }],
          limitations: [],
          source_ids: [approvedSource.id],
        }),
      }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    let rejected = false;
    try {
      await createOpenAiAdvisory({
        apiKey: "test-key", model: "test-model", enableWebResearch: false,
        facts: { disease: "BLB", approximate_location: "Isabela" },
        guidance: [approvedSource], weather: null,
      });
    } catch (error) {
      rejected = String(error).includes("Unapproved or unsourced action");
    }
    assert(rejected, "unsourced action must be rejected before storage");
  } finally {
    globalThis.fetch = oldFetch;
  }
});

Deno.test("OpenAI drafts retain per-action reviewed source IDs", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify({
          summary: "Possible BLB symptoms should be checked in the field.",
          recommended_actions: [{ text: "Record and verify leaf symptoms.", source_id: approvedSource.id }],
          limitations: ["Model predictions are not a confirmed diagnosis."],
          source_ids: [approvedSource.id],
        }),
      }],
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const result = await createOpenAiAdvisory({
      apiKey: "test-key", model: "test-model", enableWebResearch: false,
      facts: { disease: "BLB", approximate_location: "Isabela" },
      guidance: [approvedSource], weather: null,
    });
    assert(result.source_ids.length === 1 && result.source_ids[0] === approvedSource.id, "reviewed source retained");
    assert(result.recommended_actions.length === 1, "one grounded action");
    assert(result.research_status === "disabled", "web search off unless explicitly enabled");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
