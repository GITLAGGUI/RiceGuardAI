import { describe, expect, it } from "vitest";
import { inferenceConfiguration, inferenceConfigurationLabel } from "../../../supabase/functions/_shared/systemReadiness";

describe("honest inference configuration", () => {
  const enabled = { upload: true, dispatch: true, callback: true, dispatcher: true };
  it("does not claim execution health from credentials", () => {
    const result = inferenceConfiguration(enabled,"verified-workflow-hash");
    expect(result.status).toBe("configured");
    expect(result.verification).toBe("configuration_only");
    expect(inferenceConfigurationLabel(result)).toBe("Upload and dispatch configured");
  });
  it.each(["upload", "dispatch", "callback"] as const)("fails closed when %s is disabled", key => {
    expect(inferenceConfiguration({ ...enabled, [key]: false },"hash").status).toBe("disabled");
  });
  it("requires dispatcher configuration", () => {
    expect(inferenceConfiguration({...enabled,dispatcher:false},"hash").status).toBe("configuration_required");
  });
  it("does not turn missing status into ready", () => {
    expect(inferenceConfigurationLabel(null)).toBe("Status unavailable");
  });
});
