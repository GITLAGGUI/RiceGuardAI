import { z } from "zod";
export type { ConnectorStore, StoreOperation, StoreResult } from "./store.ts";

export const scopes = ["evidence:read", "advisory:submit"] as const;
export type ConnectorScope = typeof scopes[number];
export type RevisionKey = {
  survey_id: string;
  job_id: string;
  result_revision: number;
};
export type VerifiedAdmin = {
  id: string;
  role: "admin";
  is_active: true;
  aal: "aal2";
};
export type GrantContext = {
  grant_id: string;
  owner_id: string;
  scopes: ConnectorScope[];
  allow_images: boolean;
  expires_at: string;
};
const text = (max: number) => z.string().trim().min(1).max(max);
export const revisionSchema = z.object({
  survey_id: z.uuid(),
  job_id: z.uuid(),
  result_revision: z.number().int().positive(),
});
export const submissionSchema = revisionSchema.extend({
  evidence_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  summary: text(3000),
  recommended_actions: z.array(text(600)).min(1).max(8),
  limitations: z.array(text(600)).min(1).max(8),
  source_ids: z.array(z.uuid()).min(1).max(20),
  research_citations: z.array(
    z.object({
      title: text(200),
      url: z.url().max(2048).refine((value) => {
        const u = new URL(value);
        return u.protocol === "https:" && !u.username && !u.password;
      }),
      supporting_claim: text(600),
      retrieved_at: z.iso.datetime({ offset: true }),
    }).strict(),
  ).max(10),
  model_self_reported: text(100).optional(),
}).strict();
export type AdvisorySubmission = z.infer<typeof submissionSchema>;
export function parseSubmission(
  raw: unknown,
  now = new Date(),
): AdvisorySubmission {
  const value = submissionSchema.parse(raw);
  if (
    value.research_citations.some((c) =>
      Date.parse(c.retrieved_at) > now.getTime() + 300_000
    )
  ) throw new Error("Future source retrieval time is invalid");
  return value;
}
export type SubmissionReceipt = {
  submission_id: string;
  status: "stored_private";
  duplicate: boolean;
  public_post_created: false;
  sms_enqueued: false;
};
export type EvidencePacket = RevisionKey & {
  schema_version: "riceguard.gemini.evidence.v1";
  evidence_sha256: string;
  evidence_binding_sha256: string;
  approximate_location: string;
  result_type: "machine_prediction_unverified";
  severity: string;
  models: Record<string, unknown>;
  findings: Record<string, unknown>[];
  context: Record<string, unknown>;
  guidance: Record<string, unknown>[];
  limitations: string[];
  images_status: "not_permitted" | "unavailable" | "available";
  image_hashes: string[];
  image_delivery?: "paged";
  visual_catalogue?: import("./visualMedia.ts").VisualCatalogue;
  media_scope?: {
    photos: number;
    excluded_videos: number;
    video_analysis: false;
  };
};
export type EvidenceImage = {
  mimeType: "image/jpeg" | "image/png";
  data: string;
  sha256: string;
};
export interface EvidenceMediaReader {
  read(context: GrantContext, key: RevisionKey): Promise<EvidenceImage[]>;
}
export type ConnectorDeps = {
  store: import("./store.ts").ConnectorStore;
  verifyAdmin: (jwt: string) => Promise<VerifiedAdmin>;
  media: EvidenceMediaReader;
  /** Optional until the private catalogue schema and storage are commissioned. */
  visual?: import("./visualMedia.ts").VisualMediaReader;
  events?: {
    resolve: (
      context: GrantContext,
      eventId: string,
    ) => Promise<import("./readyEvents.ts").ReadyEvent>;
  };
  now: () => Date;
  randomToken: () => string;
  ownerId: string;
  origin: string;
};
