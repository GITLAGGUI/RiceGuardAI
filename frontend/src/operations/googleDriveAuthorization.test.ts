import { describe, expect, it } from "vitest";
import { googleDriveApiFailure, googleOAuthFailure } from "../../../supabase/functions/_shared/googleDriveAuthorization.ts";
import { FieldOperationError, isNonRetryableDriveAuthorizationFailure, uploadOperationMessage } from "./fieldOperations";

describe("Google Drive upload recovery", () => {
  it("reports expired grants separately from broken OAuth configuration", () => {
    expect(googleOAuthFailure("invalid_grant", 400).code).toBe("DRIVE_REAUTH_REQUIRED");
    expect(googleOAuthFailure("invalid_client", 401).code).toBe("DRIVE_CONFIGURATION_ERROR");
  });

  it("recognizes Drive folder access and temporary provider failures", () => {
    expect(googleDriveApiFailure(403, "insufficientFilePermissions").code).toBe("DRIVE_FOLDER_ACCESS");
    expect(googleOAuthFailure("temporarily_unavailable", 503).code).toBe("DRIVE_TEMPORARY_ERROR");
  });

  it("stops the batch for permanent connection failures and keeps guidance actionable", () => {
    const error = new FieldOperationError({ error: "authorization expired", code: "DRIVE_REAUTH_REQUIRED" }, 503);
    expect(isNonRetryableDriveAuthorizationFailure(error)).toBe(true);
    expect(uploadOperationMessage(error)).toContain("Nananatili rito ang napiling files");
    expect(isNonRetryableDriveAuthorizationFailure(new Error("network timeout"))).toBe(false);
  });
});
