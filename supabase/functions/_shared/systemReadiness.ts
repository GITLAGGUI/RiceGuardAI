export interface InferenceConfiguration {
  pathway: "pinned_kaggle";
  status: "configured" | "disabled" | "configuration_required";
  upload_enabled: boolean;
  dispatch_enabled: boolean;
  callback_enabled: boolean;
  dispatcher_configured: boolean;
  workflow_sha256: string;
  verification: "configuration_only";
}

export function inferenceConfiguration(
  flags: { upload: boolean; dispatch: boolean; callback: boolean; dispatcher: boolean },
  workflowHash: string,
): InferenceConfiguration {
  return {
    pathway: "pinned_kaggle",
    status: !flags.upload || !flags.dispatch || !flags.callback ? "disabled"
      : flags.dispatcher ? "configured" : "configuration_required",
    upload_enabled: flags.upload,
    dispatch_enabled: flags.dispatch,
    callback_enabled: flags.callback,
    dispatcher_configured: flags.dispatcher,
    workflow_sha256: workflowHash,
    verification: "configuration_only",
  };
}

export function inferenceConfigurationLabel(value?: InferenceConfiguration | null): string {
  if (!value) return "Status unavailable";
  return value.status === "configured" ? "Upload and dispatch configured"
    : value.status === "disabled" ? "Processing disabled" : "Configuration required";
}
