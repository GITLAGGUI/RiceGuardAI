import type {
  AdvisorySubmission,
  ConnectorScope,
  GrantContext,
  RevisionKey,
  SubmissionReceipt,
} from "./contracts.ts";
import { ConnectorError } from "./policy.ts";

type ClientCredentials = { client_id: string; client_secret_hash: string };
type Cursor = { created_at: string; id: string };
export type InternalEvidence = {
  revision: Record<string, unknown> & {
    survey_id: string;
    job_id: string;
    revision: number;
    manifest: unknown;
  };
  job: Record<string, unknown>;
  survey: Record<string, unknown>;
  guidance: Record<string, unknown>[];
  evidence_binding_sha256: string;
};
export type StoreInputMap = {
  register_client: {
    owner_id: string;
    client_id: string;
    client_name: string;
    redirect_uri: string;
    secret_hash: string;
  };
  create_request: {
    request_id: string;
    client_id: string;
    redirect_uri: string;
    resource: string;
    scopes: ConnectorScope[];
    state: string;
    challenge: string;
    expires_at: string;
  };
  preview_consent: { request_id: string; owner_id: string };
  complete_consent: {
    request_id: string;
    owner_id: string;
    decision: "allow" | "deny";
    survey_ids: string[];
    allow_images: boolean;
    code_hash: string | null;
    code_expires_at: string;
    grant_expires_at: string;
  };
  exchange_code: ClientCredentials & {
    code_hash: string;
    challenge: string;
    redirect_uri: string;
    resource: string;
    access_hash: string;
    refresh_hash: string;
    access_expires_at: string;
  };
  rotate_refresh: ClientCredentials & {
    old_refresh_hash: string;
    resource: string;
    access_hash: string;
    refresh_hash: string;
    access_expires_at: string;
  };
  access_context: { access_hash: string; resource: string };
  revoke:
    | { mode: "owner"; owner_id: string; grant_id: string }
    | (ClientCredentials & { mode: "client"; token_hash: string });
  owner_grants: { owner_id: string };
  queue_summary: { grant_id: string };
  list_evidence: { grant_id: string; limit: number; after: Cursor | null };
  read_evidence: RevisionKey & { grant_id: string };
  read_visual_catalogue: RevisionKey & { grant_id: string };
  record_visual_delivery: RevisionKey & {
    grant_id: string;
    catalogue_sha256: string;
    image_ids: string[];
  };
  assert_visual_delivery: RevisionKey & {
    grant_id: string;
    catalogue_sha256: string;
  };
  resolve_ready_event: { grant_id: string; event_id: string };
  save_submission: RevisionKey & {
    grant_id: string;
    evidence_sha256: string;
    evidence_binding_sha256: string;
    idempotency_key: string;
    payload_sha256: string;
    payload: AdvisorySubmission;
  };
  save_visual_submission: StoreInputMap["save_submission"] & {
    catalogue_sha256: string;
    policy_version: "visual-v1";
  };
  rate_limit: {
    bucket_hash: string;
    window_seconds: number;
    max_requests: number;
  };
};
type ClientMetadata = {
  client_id: string;
  client_name: string;
  redirect_uri: string;
  scopes: ConnectorScope[];
};
type GrantTokens = {
  grant_id: string;
  scopes: ConnectorScope[];
  grant_expires_at: string;
};
export type StoreOutputMap = {
  register_client: ClientMetadata;
  create_request: ClientMetadata & { request_id: string; expires_at: string };
  preview_consent: {
    app_name: string;
    scopes: ConnectorScope[];
    expires_at: string;
    eligible_surveys: { id: string; label: string }[];
  };
  complete_consent: {
    redirect_uri: string;
    state: string;
    grant_id: string | null;
    allowed: boolean;
  };
  exchange_code: GrantTokens;
  rotate_refresh: GrantTokens;
  access_context: GrantContext;
  revoke: { revoked: true };
  owner_grants: {
    grants: {
      id: string;
      app_name: string;
      scopes: ConnectorScope[];
      allow_images: boolean;
      expires_at: string;
      revoked_at: string | null;
      survey_ids: string[];
    }[];
  };
  queue_summary: {
    ready: number;
    awaiting: number;
    returned: number;
    checked_at: string;
  };
  list_evidence: { revisions: (RevisionKey & Cursor)[]; next: Cursor | null };
  read_evidence: InternalEvidence;
  read_visual_catalogue: {
    catalogue: unknown;
    catalogue_sha256: string | null;
  };
  record_visual_delivery: { recorded: true };
  assert_visual_delivery: { complete: true };
  resolve_ready_event: Record<string, unknown>;
  save_submission: SubmissionReceipt;
  save_visual_submission: SubmissionReceipt;
  rate_limit: { allowed: boolean; retry_after_seconds: number };
};
export type StoreOperation = {
  [Op in keyof StoreInputMap]: { op: Op; input: StoreInputMap[Op] };
}[keyof StoreInputMap];
export type StoreResult = {
  [Op in keyof StoreOutputMap]: { op: Op; result: StoreOutputMap[Op] };
}[keyof StoreOutputMap];
export interface ConnectorStore {
  execute<Op extends StoreOperation>(
    operation: Op,
  ): Promise<StoreOutputMap[Op["op"]]>;
}
type RpcClient = {
  rpc(
    name:
      | "rg_mcp_store"
      | "rg_mcp_visual_store"
      | "rg_mcp_event_store"
      | "rg_mcp_visual_submission_store",
    args: { p_operation: string; p_input: unknown },
  ): PromiseLike<
    { data: unknown; error: { message?: string; code?: string } | null }
  >;
};

/** Only a server-held service-role client belongs here. No SQL/table input is accepted. */
export function createConnectorStore(client: RpcClient): ConnectorStore {
  return {
    async execute<Op extends StoreOperation>(
      operation: Op,
    ): Promise<StoreOutputMap[Op["op"]]> {
      const visualOperation = {
        read_visual_catalogue: "read_catalogue",
        record_visual_delivery: "record_delivery",
        assert_visual_delivery: "assert_delivery",
      }[
        operation.op as
          | "read_visual_catalogue"
          | "record_visual_delivery"
          | "assert_visual_delivery"
      ];
      const eventOperation = operation.op === "resolve_ready_event"
        ? "resolve_event"
        : undefined;
      const visualSubmission = operation.op === "save_visual_submission";
      const { data, error } = await client.rpc(
        visualSubmission
          ? "rg_mcp_visual_submission_store"
          : visualOperation
          ? "rg_mcp_visual_store"
          : eventOperation
          ? "rg_mcp_event_store"
          : "rg_mcp_store",
        {
          p_operation: visualSubmission
            ? "save_submission"
            : visualOperation ?? eventOperation ?? operation.op,
          p_input: operation.input,
        },
      );
      // Do not relay raw database details or payloads into OAuth/MCP responses.
      if (error) {
        throw new ConnectorError(
          "store_denied",
          400,
          "Connector operation denied",
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new ConnectorError("store_unavailable", 503);
      }
      // Reuse revocation is committed by SQL before this sentinel becomes an error.
      if ("error" in data) throw new ConnectorError(String(data.error), 400);
      return data as StoreOutputMap[Op["op"]];
    },
  };
}
