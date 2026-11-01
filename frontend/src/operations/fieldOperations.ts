import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "@/lib/supabase";

export type FieldOperationErrorCode =
  | "AUTH_REQUIRED"
  | "PHONE_VERIFICATION_REQUIRED"
  | "INVALID_LOCATION"
  | "CONTACT_CONFLICT"
  | "PILOT_LIMIT_REACHED"
  | "DRIVE_REAUTH_REQUIRED"
  | "DRIVE_CONFIGURATION_ERROR"
  | "DRIVE_FOLDER_ACCESS"
  | "DRIVE_TEMPORARY_ERROR"
  | "VALIDATION_ERROR";

export type FieldOperationErrorPayload = {
  error?: string;
  code?: FieldOperationErrorCode;
  request_id?: string;
};

export class FieldOperationError extends Error {
  readonly code?: FieldOperationErrorCode;
  readonly requestId?: string;
  readonly status?: number;

  constructor(payload: FieldOperationErrorPayload, status?: number) {
    super(payload.error || "Operation failed");
    this.name = "FieldOperationError";
    this.code = payload.code;
    this.requestId = payload.request_id;
    this.status = status;
  }
}

export function isNonRetryableDriveAuthorizationFailure(error: unknown): boolean {
  return error instanceof FieldOperationError && [
    "DRIVE_REAUTH_REQUIRED",
    "DRIVE_CONFIGURATION_ERROR",
    "DRIVE_FOLDER_ACCESS",
  ].includes(error.code || "");
}

export function uploadOperationMessage(error: unknown): string {
  if (!(error instanceof FieldOperationError))
    return error instanceof Error ? error.message : "Hindi nakumpleto ang upload.";
  switch (error.code) {
    case "DRIVE_REAUTH_REQUIRED":
      return "Expired o na-revoke ang Google Drive authorization. Kailangang i-reconnect ng admin ang kasalukuyang Google account. Nananatili rito ang napiling files; subukan ulit pagkatapos ma-reconnect.";
    case "DRIVE_CONFIGURATION_ERROR":
      return "May mali sa Google Drive OAuth configuration. Kailangang ipa-check sa admin ang OAuth client at authorization grant. Nananatili rito ang napiling files.";
    case "DRIVE_FOLDER_ACCESS":
      return "Hindi ma-access ng RiceGuardAI ang naka-configure na private Drive folder. Kailangang ibalik ng admin ang folder access. Nananatili rito ang napiling files.";
    case "DRIVE_TEMPORARY_ERROR":
      return "Pansamantalang hindi ma-contact ang Google Drive. Nananatili rito ang napiling files; subukan ulit mamaya.";
    default:
      return error.message;
  }
}

export function registrationErrorMessage(error: unknown): string {
  if (error instanceof FieldOperationError) {
    switch (error.code) {
      case "AUTH_REQUIRED":
        return "Nag-expire o nawawala ang verification session. I-verify muli ang inyong mobile number.";
      case "PHONE_VERIFICATION_REQUIRED":
        return "Kailangang ma-verify muna ang mobile number bago i-save ang registration.";
      case "INVALID_LOCATION":
        return "Hindi valid ang napiling barangay. Pumili muli mula sa kasalukuyang listahan ng Region II.";
      case "CONTACT_CONFLICT":
        return "Nakarehistro na ang numerong ito sa ibang account. Makipag-ugnayan sa RiceGuardAI administrator para maayos ito.";
      case "PILOT_LIMIT_REACHED":
        return "Puno na ang kasalukuyang SMS pilot. Hindi muna makapagdagdag ng bagong numero.";
      case "VALIDATION_ERROR":
        return "Pakisuri ang pangalan, lokasyon, at pahintulot bago muling i-save.";
    }
  }
  const message = error instanceof Error ? error.message : "Hindi nakumpleto ang request.";
  if (/expired|invalid.*session|jwt/i.test(message)) {
    return "Nag-expire ang verification session. I-verify muli ang inyong mobile number.";
  }
  return message;
}

async function responsePayload(error: unknown): Promise<FieldOperationErrorPayload | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    return (await context.clone().json()) as FieldOperationErrorPayload;
  } catch {
    return null;
  }
}

export async function fieldOperation(
  action: string,
  payload: unknown = {},
  client: SupabaseClient = supabase,
) {
  if (!supabaseConfigured) {
    throw new FieldOperationError({ error: "Supabase is not configured. No live changes were made." });
  }
  const { data, error } = await client.functions.invoke("field-operations", {
    body: { action, payload },
  });
  if (!error && !data?.error) return data;

  const parsed = data?.error
    ? (data as FieldOperationErrorPayload)
    : await responsePayload(error);
  if (parsed?.error) {
    const status = (error as { context?: Response } | null)?.context?.status;
    throw new FieldOperationError(parsed, status);
  }
  throw new FieldOperationError({
    error: (error as Error | null)?.message || "Operation failed",
  });
}
