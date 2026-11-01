import { describe, expect, it } from "vitest";
import { googleDriveApiFailure, googleOAuthFailure } from "./googleDriveAuthorization.ts";

describe("Google Drive authorization diagnostics", () => {
  it("distinguishes expired grants from OAuth client configuration errors", () => {
    expect(googleOAuthFailure("invalid_grant", 400).code).toBe("DRIVE_REAUTH_REQUIRED");
    expect(googleOAuthFailure("invalid_client", 401).code).toBe("DRIVE_CONFIGURATION_ERROR");
  });

  it("marks provider throttling and outages retryable", () => {
    expect(googleOAuthFailure("temporarily_unavailable", 503).code).toBe("DRIVE_TEMPORARY_ERROR");
    expect(googleDriveApiFailure(429).code).toBe("DRIVE_TEMPORARY_ERROR");
  });

  it("separates folder permission failures from expired authorization", () => {
    expect(googleDriveApiFailure(403, "insufficientFilePermissions").code).toBe("DRIVE_FOLDER_ACCESS");
    expect(googleDriveApiFailure(401).code).toBe("DRIVE_REAUTH_REQUIRED");
  });

  it("never returns provider descriptions that could contain sensitive details", () => {
    const message = googleOAuthFailure("invalid_grant", 400).message;
    expect(message).not.toContain("refresh_token");
    expect(message).not.toContain("secret");
  });
});
