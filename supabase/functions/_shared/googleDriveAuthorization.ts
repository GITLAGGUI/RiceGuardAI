export type GoogleDriveFailureCode =
  | "DRIVE_REAUTH_REQUIRED"
  | "DRIVE_CONFIGURATION_ERROR"
  | "DRIVE_FOLDER_ACCESS"
  | "DRIVE_TEMPORARY_ERROR";

export type GoogleDriveFailure = {
  code: GoogleDriveFailureCode;
  message: string;
  status: number;
};

export function googleOAuthFailure(error: unknown, status: number): GoogleDriveFailure {
  const code = String(error || "");
  if (code === "invalid_grant") {
    return {
      code: "DRIVE_REAUTH_REQUIRED",
      message: "Google Drive authorization expired or was revoked. Reconnect the existing Google account, then retry the selected files.",
      status: 503,
    };
  }
  if (code === "invalid_client" || code === "unauthorized_client" || code === "missing_configuration" || status === 400) {
    return {
      code: "DRIVE_CONFIGURATION_ERROR",
      message: "Google Drive OAuth configuration is invalid. An administrator must check the configured OAuth client and authorization grant.",
      status: 503,
    };
  }
  if (status === 429 || status >= 500) {
    return {
      code: "DRIVE_TEMPORARY_ERROR",
      message: "Google Drive authorization is temporarily unavailable. Retry the selected files in a moment.",
      status: 503,
    };
  }
  return {
    code: "DRIVE_CONFIGURATION_ERROR",
    message: "Google Drive authorization could not be verified. An administrator must check its OAuth configuration.",
    status: 503,
  };
}

export function googleDriveApiFailure(status: number, reason = ""): GoogleDriveFailure {
  if (status === 401) {
    return {
      code: "DRIVE_REAUTH_REQUIRED",
      message: "Google Drive rejected its access grant. Reconnect the existing Google account, then retry the selected files.",
      status: 503,
    };
  }
  if (status === 403 || status === 404 || /notFound|insufficientFilePermissions|appNotAuthorizedToFile/i.test(reason)) {
    return {
      code: "DRIVE_FOLDER_ACCESS",
      message: "RiceGuardAI cannot access its configured private Google Drive folder. An administrator must restore that folder's access.",
      status: 503,
    };
  }
  if (status === 429 || status >= 500) {
    return {
      code: "DRIVE_TEMPORARY_ERROR",
      message: "Google Drive is temporarily unavailable. Retry the selected files in a moment.",
      status: 503,
    };
  }
  return {
    code: "DRIVE_CONFIGURATION_ERROR",
    message: "Google Drive rejected the upload configuration. An administrator must check the private folder and OAuth scope.",
    status: 503,
  };
}
