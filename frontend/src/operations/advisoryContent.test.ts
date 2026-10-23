import { describe, expect, it } from "vitest";
import { advisoryActionSteps, publicCoordinateLink, smsAdvisoryMessage } from "./advisoryPresentation";
import { advisoryPreview } from "./advisoryContent";
describe("farmer-readable bulletin and SMS", () => {
  it("separates numbered inline, paragraph and bullet actions", () => {
    expect(advisoryActionSteps("1. Check leaves. 2. Inspect water. 3. Contact the specialist.")).toEqual(["Check leaves.", "Inspect water.", "Contact the specialist."]);
    expect(advisoryActionSteps("- Check leaves.\n\n• Inspect water.")).toEqual(["Check leaves.", "Inspect water."]);
    expect(advisoryActionSteps("Check leaves.\nInspect water.")).toHaveLength(2);
  });
  it("offers expand/collapse only when content exceeds the preview", () => {
    expect(advisoryPreview("Brief summary", "Short action").expandable).toBe(false);
    expect(advisoryPreview("Long summary ".repeat(40), "1. A\n2. B\n3. C")).toMatchObject({ expandable: true, actions: ["A", "B"] });
  });
  it("requires public location approval and shares approximate coordinates only", () => {
    expect(publicCoordinateLink({ lat: 17.427315, lng: 121.764351 })).toBeNull();
    expect(publicCoordinateLink({ lat: 17.427315, lng: 121.764351, public_location_approved: true })).toBe("https://www.google.com/maps?q=17.43,121.76");
    expect(publicCoordinateLink({ lat: null, lng: 121, public_location_approved: true })).toBeNull();
  });
  it("preserves both links and opt-out with long SMS action text", () => {
    const sms = smsAdvisoryMessage({ disease: "BLB", action: "1. Check leaves.\n2. Inspect water. ".repeat(40), slug: "a", lat: 17.427315, lng: 121.764351, public_location_approved: true }, "https://riceguardai.dev/advisories/a", true);
    expect(sms).toContain("\n- Check leaves.");
    expect(sms).toContain("Map (approximate): https://www.google.com/maps?q=17.43,121.76");
    expect(sms).not.toContain("17.427315");
    expect(sms).toContain("Details: https://riceguardai.dev/advisories/a\nReply STOP");
    expect(sms.length).toBeLessThanOrEqual(620);
  });
});
