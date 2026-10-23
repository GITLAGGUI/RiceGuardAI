import { describe, expect, it, vi } from "vitest";
import { allowedResearchUrl, citedCandidates, createOpenAiAdvisory } from "../../../supabase/functions/_shared/openai-advisory";

const guidance = [
  { id: "blb-approved", disease: "BLB" as const, title: "BLB guidance", version: "1", reference: "approved", guidance: {} },
  { id: "brown-approved", disease: "Brown Spot" as const, title: "Brown Spot guidance", version: "1", reference: "approved", guidance: {} },
];
const draft = { summary: "Needs field inspection", recommended_actions: [
  { text: "Inspect BLB symptoms", source_id: "blb-approved" },
  { text: "Inspect Brown Spot symptoms", source_id: "brown-approved" },
], limitations: ["Model proposals are not a diagnosis"], source_ids: ["blb-approved", "brown-approved"] };
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });

describe("optional OpenAI advisory adapter", () => {
  it("accepts only allowlisted HTTPS citation annotations", () => {
    expect(allowedResearchUrl("https://www.philrice.gov.ph/article")).toBe(true);
    expect(allowedResearchUrl("https://philrice.gov.ph.evil.example/article")).toBe(false);
    expect(allowedResearchUrl("http://philrice.gov.ph/article")).toBe(false);
    const refs = citedCandidates({ output: [{ type: "message", content: [{ annotations: [
      { type: "url_citation", url: "https://www.philrice.gov.ph/article", title: "PhilRice" },
      { type: "url_citation", url: "https://evil.example/article", title: "Fake" },
    ] }] }] }, "2026-09-28T00:00:00Z");
    expect(refs).toHaveLength(1);
    expect(refs[0].status).toBe("candidate_requires_specialist_review");
  });
  it("requires a search tool and excludes candidate links from the actionable draft", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ output: [{ type: "message", content: [{ annotations: [
        { type: "url_citation", url: "https://www.philrice.gov.ph/article", title: "PhilRice" },
      ] }] }] }))
      .mockResolvedValueOnce(response({ output_text: JSON.stringify(draft) }));
    const result = await createOpenAiAdvisory({ apiKey: "test-only", model: "test-model", facts: { approximate_location: "Isabela" },
      diseases: ["BLB", "Brown Spot"], guidance, weather: null, webResearch: true, fetcher: fetcher as unknown as typeof fetch });
    expect(result.research_candidates).toHaveLength(1);
    expect(result.source_ids).toEqual(["blb-approved", "brown-approved"]);
    const searchBody = JSON.parse(fetcher.mock.calls[0][1].body);
    const draftBody = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(searchBody.tool_choice).toBe("required");
    expect(searchBody.store).toBe(false);
    expect(JSON.stringify(draftBody)).not.toContain("https://www.philrice.gov.ph/article");
  });
  it("rejects invented action sources", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ output_text: JSON.stringify({ ...draft,
      recommended_actions: [{ text: "Apply an unapproved product", source_id: "fabricated" }],
    }) }));
    await expect(createOpenAiAdvisory({ apiKey: "test-only", model: "test-model", facts: {}, diseases: ["BLB", "Brown Spot"],
      guidance, weather: null, webResearch: false, fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(/unsourced action/);
  });
});
