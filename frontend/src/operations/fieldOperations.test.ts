import { describe, expect, it } from "vitest";
import { FieldOperationError, registrationErrorMessage } from "./fieldOperations";
import { getBulletinTourSteps } from "./Assistant";

describe("farmer-facing registration errors", () => {
  it("translates stable server codes instead of showing the generic invoke error", () => {
    const error = new FieldOperationError({
      error: "Verified phone required",
      code: "PHONE_VERIFICATION_REQUIRED",
      request_id: "request-1",
    }, 403);
    expect(registrationErrorMessage(error)).toContain("ma-verify muna ang mobile number");
    expect(registrationErrorMessage(error)).not.toContain("non-2xx");
    expect(error.requestId).toBe("request-1");
  });

  it("keeps conflict, invalid-location, and pilot-limit guidance distinct", () => {
    expect(registrationErrorMessage(new FieldOperationError({ error: "x", code: "CONTACT_CONFLICT" }))).toContain("ibang account");
    expect(registrationErrorMessage(new FieldOperationError({ error: "x", code: "INVALID_LOCATION" }))).toContain("Region II");
    expect(registrationErrorMessage(new FieldOperationError({ error: "x", code: "PILOT_LIMIT_REACHED" }))).toContain("pilot");
  });
});

describe("Bulletin walkthrough copy", () => {
  it("does not invent post actions when the live bulletin is empty", () => {
    const steps = getBulletinTourSteps(false, false);
    expect(steps).toHaveLength(3);
    expect(steps[1].text).toContain("Walang sample post");
    expect(steps[1].text).not.toContain("i-save");
    expect(steps[2].text).toContain("SMS Registration");
  });

  it("uses preference wording for a registered subscriber", () => {
    expect(getBulletinTourSteps(true, true)[2].text).toContain("SMS Preferences");
  });
});
